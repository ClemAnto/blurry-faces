/**
 * Storage locale centralizzato su OPFS (Origin Private File System): i dati restano sul dispositivo.
 *
 * Ogni JSON salvato è "timbrato" con la versione dell'app che l'ha scritto e il momento della scrittura
 * (`performance.timeOrigin + performance.now()`: millisecondi epoch, confrontabili tra sessioni diverse).
 * In lettura si scartano e si cancellano i dati di versioni incompatibili o troppo vecchi.
 */

/** Versione dell'app che scrive i dati (tenere allineata a package.json). */
export const APP_VERSION = '1.1.1';
/** Versione minima i cui dati sono ancora leggibili da questa versione. */
export const MIN_COMPATIBLE_VERSION = '1.1.0';
/** Età massima dei dati salvati. */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface Stamped<T> {
	appVersion: string;
	savedAt: number;
	data: T;
}

export const nowMs = () => performance.timeOrigin + performance.now();

/** Confronto tra versioni semver semplici (x.y.z): negativo se a < b. */
export function compareVersions(a: string, b: string): number {
	const pa = a.split('.').map(n => parseInt(n, 10) || 0);
	const pb = b.split('.').map(n => parseInt(n, 10) || 0);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d) return d;
	}
	return 0;
}

export function stamp<T>(data: T, at = nowMs()): Stamped<T> {
	return { appVersion: APP_VERSION, savedAt: at, data };
}

/** Un dato salvato è valido se scritto da una versione compatibile, non dal futuro e non troppo vecchio. */
export function isValidStamp(value: unknown, at = nowMs()): value is Stamped<unknown> {
	if (!value || typeof value !== 'object') return false;
	const s = value as Partial<Stamped<unknown>>;
	if (typeof s.appVersion !== 'string' || typeof s.savedAt !== 'number' || !('data' in s)) return false;
	if (compareVersions(s.appVersion, MIN_COMPATIBLE_VERSION) < 0) return false;
	if (compareVersions(s.appVersion, APP_VERSION) > 0) return false;
	const age = at - s.savedAt;
	return age >= -60_000 && age <= MAX_AGE_MS;
}

export class LocalStore {
	constructor(private folder: string) { }

	static supported(): boolean {
		return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory
			&& typeof FileSystemFileHandle !== 'undefined' && 'createWritable' in FileSystemFileHandle.prototype;
	}

	private async dir(): Promise<FileSystemDirectoryHandle> {
		const root = await navigator.storage.getDirectory();
		return root.getDirectoryHandle(this.folder, { create: true });
	}

	async writeJson<T>(name: string, data: T): Promise<void> {
		await this.writeFile(name, new Blob([JSON.stringify(stamp(data))], { type: 'application/json' }));
	}

	/** Legge un JSON timbrato; se non è valido lo cancella e restituisce null. */
	async readJson<T>(name: string): Promise<Stamped<T> | null> {
		const file = await this.readFile(name);
		if (!file) return null;
		try {
			const value = JSON.parse(await file.text());
			if (isValidStamp(value)) return value as Stamped<T>;
		} catch {
			// JSON corrotto (es. scrittura interrotta): si scarta.
		}
		await this.delete(name);
		return null;
	}

	/** Scrive un file binario. Va sempre accompagnato da un JSON timbrato che ne decide la validità. */
	async writeFile(name: string, content: Blob | ReadableStream<Uint8Array>): Promise<void> {
		const handle = await (await this.dir()).getFileHandle(name, { create: true });
		const writable = await handle.createWritable();
		if (content instanceof Blob) {
			await writable.write(content);
			await writable.close();
		} else {
			await content.pipeTo(writable);
		}
	}

	async readFile(name: string): Promise<File | null> {
		try {
			const handle = await (await this.dir()).getFileHandle(name);
			return await handle.getFile();
		} catch {
			return null;
		}
	}

	async delete(name: string): Promise<void> {
		try {
			await (await this.dir()).removeEntry(name);
		} catch {
			// Già assente.
		}
	}

	async clear(): Promise<void> {
		try {
			const root = await navigator.storage.getDirectory();
			await root.removeEntry(this.folder, { recursive: true });
		} catch {
			// Già assente.
		}
	}
}
