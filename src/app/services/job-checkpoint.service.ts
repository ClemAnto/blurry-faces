import { Injectable } from '@angular/core';
import { Detection } from './face-tracking';
import { DetectorKind } from './face-detectors';
import { LocalStore, nowMs } from './local-store';

export interface FileIdentity {
	name: string;
	size: number;
	lastModified: number;
	type: string;
}

/** Stato salvato di un'elaborazione, sufficiente a riprenderla dall'ultimo fotogramma analizzato. */
export interface JobCheckpoint {
	file: FileIdentity;
	detector: DetectorKind;
	/** Durata del video in secondi e timestamp del primo fotogramma, per calcolare l'avanzamento. */
	duration: number;
	start: number;
	/** Timestamp e detection grezze dei fotogrammi già analizzati. */
	timestamps: number[];
	frames: Detection[][];
	analysisDone: boolean;
	/** True se una copia del video è salvata in locale (altrimenti va riselezionato). */
	hasVideoCopy: boolean;
}

const JOB_FILE = 'job.json';
const VIDEO_FILE = 'job-video';
/** Identità (timbrata con versione e data) del video copiato in VIDEO_FILE. */
const VIDEO_META = 'job-video.json';
/** Intervallo minimo tra due salvataggi del checkpoint durante l'analisi. */
const SAVE_INTERVAL_MS = 3000;

export const identityOf = (f: File): FileIdentity => ({ name: f.name, size: f.size, lastModified: f.lastModified, type: f.type });
export const sameFile = (a: FileIdentity, b: FileIdentity) =>
	a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

/**
 * Salva i progressi dell'elaborazione in corso (OPFS, sul dispositivo) così che possa essere ripresa dopo un
 * ricaricamento, una chiusura della tab o un crash. Se OPFS non è disponibile tutte le operazioni diventano no-op.
 *
 * Ciclo di vita: il checkpoint (job.json) si cancella a lavoro finito o annullato (`finish`). La copia del video
 * no, perché dopo una ripresa è proprio il file mostrato nella pagina: si elimina con `discard`, quando si inizia
 * un lavoro su un video diverso, o all'avvio se non c'è più nessun lavoro da riprendere.
 */
@Injectable({ providedIn: 'root' })
export class JobCheckpointService {

	private store = LocalStore.supported() ? new LocalStore('blurry-faces-job') : null;
	private lastSaveAt = 0;
	private saving: Promise<void> | null = null;

	get supported(): boolean {
		return !!this.store;
	}

	/** Inizia un nuovo lavoro: sostituisce quello precedente e salva una copia del video (o riusa quella esistente). */
	async begin(file: File, detector: DetectorKind): Promise<JobCheckpoint> {
		const identity = identityOf(file);
		const checkpoint: JobCheckpoint = {
			file: identity, detector, duration: 0, start: 0,
			timestamps: [], frames: [], analysisDone: false, hasVideoCopy: false,
		};
		if (!this.store) return checkpoint;

		if (await this.hasCopyOf(identity)) {
			// Stesso video già copiato (es. rielaborazione dopo una ripresa): il file in uso è proprio la copia.
			await this.store.delete(JOB_FILE);
			checkpoint.hasVideoCopy = true;
		} else {
			try {
				await this.store.clear();
				await this.store.writeFile(VIDEO_FILE, file.stream());
				await this.store.writeJson(VIDEO_META, identity);
				checkpoint.hasVideoCopy = true;
			} catch (err) {
				// Spazio insufficiente o scrittura non permessa: si potrà riprendere riselezionando il file.
				console.warn('[JOB] Copia locale del video non riuscita', err);
				await this.store.delete(VIDEO_FILE);
				await this.store.delete(VIDEO_META);
			}
		}
		await this.write(checkpoint);
		return checkpoint;
	}

	private async hasCopyOf(identity: FileIdentity): Promise<boolean> {
		const meta = await this.store!.readJson<FileIdentity>(VIDEO_META);
		if (!meta || !sameFile(meta.data, identity)) return false;
		const copy = await this.store!.readFile(VIDEO_FILE);
		return !!copy && copy.size === identity.size;
	}

	/** Salva il checkpoint, al massimo ogni SAVE_INTERVAL_MS (a meno di `force`) e mai due scritture insieme. */
	async save(checkpoint: JobCheckpoint, force = false): Promise<void> {
		if (!this.store) return;
		if (this.saving) {
			if (!force) return;
			await this.saving;
		}
		if (!force && nowMs() - this.lastSaveAt < SAVE_INTERVAL_MS) return;
		this.lastSaveAt = nowMs();
		this.saving = this.write(checkpoint).finally(() => this.saving = null);
		await this.saving;
	}

	/** Restituisce il lavoro interrotto, se valido (versione compatibile, non troppo vecchio). */
	async load(): Promise<{ checkpoint: JobCheckpoint; savedAt: number } | null> {
		if (!this.store) return null;
		const saved = await this.store.readJson<JobCheckpoint>(JOB_FILE);
		if (!saved) {
			// Nessun lavoro da riprendere: si elimina anche l'eventuale copia del video rimasta.
			await this.store.clear();
			return null;
		}
		return { checkpoint: saved.data, savedAt: saved.savedAt };
	}

	/** La copia locale del video, con nome e tipo originali. */
	async videoFile(checkpoint: JobCheckpoint): Promise<File | null> {
		if (!this.store || !checkpoint.hasVideoCopy) return null;
		const copy = await this.store.readFile(VIDEO_FILE);
		if (!copy || copy.size !== checkpoint.file.size) return null;
		return new File([copy], checkpoint.file.name, { type: checkpoint.file.type, lastModified: checkpoint.file.lastModified });
	}

	/** Lavoro concluso o annullato: niente più da riprendere, ma la copia del video resta finché è in uso. */
	async finish(): Promise<void> {
		if (this.saving) await this.saving;
		await this.store?.delete(JOB_FILE);
	}

	/** Elimina il lavoro interrotto e la copia del video. */
	async discard(): Promise<void> {
		if (this.saving) await this.saving;
		await this.store?.clear();
	}

	private async write(checkpoint: JobCheckpoint): Promise<void> {
		try {
			await this.store!.writeJson(JOB_FILE, checkpoint);
		} catch (err) {
			console.warn('[JOB] Salvataggio del checkpoint non riuscito', err);
		}
	}
}
