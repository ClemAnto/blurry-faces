import { Injectable, inject, signal } from '@angular/core';
import {
	ALL_FORMATS,
	BlobSource,
	BufferTarget,
	CanvasSink,
	Conversion,
	ConversionCanceledError,
	Input,
	InputVideoTrack,
	Mp4OutputFormat,
	Output,
	Quality,
	VideoSample,
} from 'mediabunny';
import {
	Box,
	Detection,
	computeMasks,
	defaultTrackingOptions,
	mergeDetections,
	nearestIndex,
	tileGrid,
} from './face-tracking';
import { DETECTORS, DetectorKind } from './face-detectors';
import { JobCheckpoint, JobCheckpointService } from './job-checkpoint.service';

export type ProcessingPhase = 'idle' | 'analysis' | 'render';

export interface ProcessedVideo {
	url: string;
	fileName: string;
	/** True se la traccia audio originale non è stata inclusa nel risultato. */
	audioDropped: boolean;
}

export class ProcessingCanceledError extends Error {
	constructor() {
		super('Elaborazione annullata');
	}
}

/** Lato massimo del frame usato per la detection: oltre, il frame viene ridotto prima dei tile. */
const MAX_DETECTION_SIDE = 1920;
/**
 * Combinato per default: sul video di prova SSD da solo lasciava scoperti volti chini e MediaPipe da solo ne perdeva
 * di più (4 e 36 su 470), insieme nessuno; costa circa il 15% di tempo in più di SSD.
 */
const DEFAULT_DETECTOR: DetectorKind = 'combined';
/** Celle in cui viene ridotto il volto, in larghezza: più sono poche, più l'oscuramento è forte. */
const ANONYMIZE_CELLS = 10;
/** Lato minimo di una cella in pixel: sui volti piccoli 10 celle sarebbero di 1–2 px e non oscurerebbero nulla. */
const MIN_CELL_PX = 5;
/** Raggi dell'ellisse rispetto a metà box. */
const ELLIPSE_SCALE = 1.2;
/** Quota della barra di avanzamento dedicata all'analisi (la più lenta). */
const ANALYSIS_WEIGHT = 0.8;
const PREVIEW_INTERVAL_MS = 250;
const PREVIEW_MAX_SIDE = 960;

interface Analysis {
	width: number;
	height: number;
	timestamps: number[];
	masks: Box[][];
}

@Injectable({ providedIn: 'root' })
export class VideoProcessingService {

	readonly modelsReady = signal(false);
	readonly phase = signal<ProcessingPhase>('idle');
	/** Avanzamento complessivo, 0–100. */
	readonly progress = signal(0);
	/** Anteprima dell'ultimo frame elaborato (data URL JPEG). */
	readonly preview = signal<string | null>(null);

	readonly detectorKind = signal<DetectorKind>(DEFAULT_DETECTOR);

	private canceled = false;
	private conversion: Conversion | null = null;
	private lastPreviewAt = 0;
	private jobs = inject(JobCheckpointService);

	setDetector(kind: DetectorKind): Promise<void> {
		this.detectorKind.set(kind);
		this.modelsReady.set(false);
		return this.loadModels();
	}

	async loadModels(): Promise<void> {
		const kind = this.detectorKind();
		await DETECTORS[kind].load();
		if (this.detectorKind() === kind) this.modelsReady.set(true);
	}

	cancel(): void {
		this.canceled = true;
		this.conversion?.cancel();
	}

	/** Avanzamento (0–100) di un lavoro salvato, per mostrarlo prima di riprenderlo. */
	static progressOf(checkpoint: JobCheckpoint): number {
		if (checkpoint.analysisDone) return Math.round(ANALYSIS_WEIGHT * 100);
		const last = checkpoint.timestamps[checkpoint.timestamps.length - 1];
		if (last === undefined || !checkpoint.duration) return 0;
		return Math.floor((last - checkpoint.start) / checkpoint.duration * ANALYSIS_WEIGHT * 100);
	}

	/**
	 * Oscura i volti del video in due passate: prima rileva i volti su tutti i frame e ne ricostruisce le tracce,
	 * poi decodifica di nuovo il video, oscura e ricodifica in MP4 copiando l'audio originale.
	 * Con `resume` riprende un lavoro interrotto dall'ultimo fotogramma analizzato.
	 */
	async blurFaces(file: File, resume?: JobCheckpoint): Promise<ProcessedVideo> {
		// Il Web Lock evita che Chrome congeli la tab in background durante l'elaborazione.
		const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
		return locks
			? locks.request('blurry-faces-elaborazione', () => this.run(file, resume))
			: this.run(file, resume);
	}

	private async run(file: File, resume?: JobCheckpoint): Promise<ProcessedVideo> {
		this.canceled = false;
		this.progress.set(resume ? VideoProcessingService.progressOf(resume) : 0);
		this.preview.set(null);
		if (resume && resume.detector !== this.detectorKind()) await this.setDetector(resume.detector);
		await this.loadModels();

		const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
		let finished = false;
		try {
			const videoTrack = await input.getPrimaryVideoTrack();
			if (!videoTrack) throw new Error('Il file non contiene una traccia video.');
			if (!(await videoTrack.canDecode())) throw new Error('Il formato video non è supportato da questo browser.');

			const checkpoint = resume ?? await this.jobs.begin(file, this.detectorKind());

			this.phase.set('analysis');
			const analysis = await this.analyze(input, videoTrack, checkpoint);

			this.phase.set('render');
			const result = await this.render(input, analysis, file.name, await targetBitrate(videoTrack));
			finished = true;
			return result;
		} catch (err) {
			if (err instanceof ConversionCanceledError || this.canceled) {
				finished = true;
				throw new ProcessingCanceledError();
			}
			throw err;
		} finally {
			this.conversion = null;
			this.phase.set('idle');
			input.dispose();
			// Lavoro concluso o annullato: niente da riprendere. Dopo un errore il checkpoint resta per riprovare.
			if (finished) await this.jobs.finish();
		}
	}

	// ---- Passata 1: detection e tracking ----

	private async analyze(input: Input, videoTrack: InputVideoTrack, checkpoint: JobCheckpoint): Promise<Analysis> {
		const width = videoTrack.displayWidth;
		const height = videoTrack.displayHeight;
		const start = await videoTrack.getFirstTimestamp();
		const duration = Math.max(0.001, (await input.computeDuration()) - start);
		checkpoint.start = start;
		checkpoint.duration = duration;

		const scale = Math.min(1, MAX_DETECTION_SIDE / Math.max(width, height));
		const [detCanvas, detCtx] = createCanvas(Math.round(width * scale), Math.round(height * scale));

		// Ripresa: si riparte dopo l'ultimo fotogramma già analizzato.
		const timestamps = checkpoint.timestamps;
		const frames = checkpoint.frames;
		const resumeAfter = timestamps.length ? timestamps[timestamps.length - 1] : -Infinity;

		if (timestamps.length) {
			console.log(`[VIDEO-PROCESSING] Ripresa dopo ${timestamps.length} fotogrammi già analizzati`
				+ (checkpoint.analysisDone ? ' (analisi completa)' : ''));
		}
		if (!checkpoint.analysisDone) {
			const sink = new CanvasSink(videoTrack, { poolSize: 2 });
			const from = Number.isFinite(resumeAfter) ? resumeAfter : undefined;

			for await (const wrapped of sink.canvases(from)) {
				if (this.canceled) throw new ProcessingCanceledError();
				if (wrapped.timestamp <= resumeAfter) continue;

				detCtx.drawImage(wrapped.canvas, 0, 0, detCanvas.width, detCanvas.height);
				const detections = await this.detectMultiScale(detCanvas);
				timestamps.push(wrapped.timestamp);
				frames.push(detections.map(d => ({
					x: d.x / scale, y: d.y / scale, width: d.width / scale, height: d.height / scale, score: d.score,
				})));

				this.progress.set(Math.min(100, Math.floor((wrapped.timestamp - start) / duration * ANALYSIS_WEIGHT * 100)));
				this.updatePreview(detCanvas, detections);
				void this.jobs.save(checkpoint);
			}
			checkpoint.analysisDone = true;
			await this.jobs.save(checkpoint, true);
		}

		const span = timestamps.length > 1 ? timestamps[timestamps.length - 1] - timestamps[0] : 0;
		const fps = span > 0 ? (timestamps.length - 1) / span : 30;
		const masks = computeMasks(frames, width, height, defaultTrackingOptions(fps));
		console.log(`[VIDEO-PROCESSING] ${frames.length} frame analizzati (${fps.toFixed(1)} fps), `
			+ `${frames.filter(f => f.length).length} con volti rilevati, ${masks.filter(m => m.length).length} oscurati`);

		return { width, height, timestamps, masks };
	}

	/** Detection sul frame intero più, per frame grandi, su tile sovrapposti (volti piccoli). */
	private async detectMultiScale(canvas: HTMLCanvasElement): Promise<Detection[]> {
		const all = await this.detect(canvas);
		for (const tile of tileGrid(canvas.width, canvas.height)) {
			const [tileCanvas, tileCtx] = this.tileCanvas(tile.width, tile.height);
			tileCtx.drawImage(canvas, tile.x, tile.y, tile.width, tile.height, 0, 0, tile.width, tile.height);
			for (const d of await this.detect(tileCanvas)) {
				all.push({ ...d, x: d.x + tile.x, y: d.y + tile.y });
			}
		}
		return mergeDetections(all);
	}

	private detect(canvas: HTMLCanvasElement): Promise<Detection[]> {
		return DETECTORS[this.detectorKind()].detect(canvas);
	}

	private tileCache: [HTMLCanvasElement, CanvasRenderingContext2D] | null = null;

	private tileCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
		if (!this.tileCache || this.tileCache[0].width !== width || this.tileCache[0].height !== height) {
			this.tileCache = createCanvas(width, height);
		}
		return this.tileCache;
	}

	// ---- Passata 2: oscuramento e codifica ----

	private async render(input: Input, analysis: Analysis, sourceName: string, bitrate: number | null): Promise<ProcessedVideo> {
		const output = new Output({
			format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
			target: new BufferTarget(),
		});

		let frameCanvas: HTMLCanvasElement | null = null;
		let frameCtx: CanvasRenderingContext2D | null = null;
		const small = createCanvas(2, 2);

		const conversion = await Conversion.init({
			input,
			output,
			tracks: 'primary',
			showWarnings: false,
			video: {
				forceTranscode: true,
				allowTransformationMetadata: false,
				// Stessa qualità dell'originale: bitrate medio del video sorgente (o 'high' se non misurabile).
				quality: bitrate ? new Quality({ bitrate, bitrateMode: 'variable' }) : new Quality('high'),
				processedWidth: analysis.width,
				processedHeight: analysis.height,
				process: (sample: VideoSample) => {
					const w = sample.displayWidth;
					const h = sample.displayHeight;
					if (!frameCanvas || frameCanvas.width !== w || frameCanvas.height !== h) {
						[frameCanvas, frameCtx] = createCanvas(w, h);
					}
					sample.draw(frameCtx!, 0, 0, w, h);

					const i = nearestIndex(analysis.timestamps, sample.timestamp);					const sx = w / analysis.width;
					const sy = h / analysis.height;
					for (const b of analysis.masks[i] ?? []) {
						anonymize(frameCtx!, small, { x: b.x * sx, y: b.y * sy, width: b.width * sx, height: b.height * sy });
					}
					this.updatePreview(frameCanvas!, []);
					return new VideoSample(frameCanvas!, { timestamp: sample.timestamp, duration: sample.duration });
				},
			},
		});
		this.conversion = conversion;

		if (!conversion.isValid) {
			const reasons = conversion.discardedTracks.map(d => d.reason).join(', ');
			throw new Error(`Impossibile creare il video (${reasons}).`);
		}
		const audioDropped = conversion.discardedTracks.some(d => d.track.isAudioTrack());

		conversion.onProgress = p => {
			this.progress.set(Math.floor((ANALYSIS_WEIGHT + p * (1 - ANALYSIS_WEIGHT)) * 100));
		};
		await conversion.execute();

		const blob = new Blob([output.target.buffer!], { type: output.format.mimeType });
		const baseName = sourceName.replace(/\.[^.]+$/, '') || 'video';
		return {
			url: URL.createObjectURL(blob),
			fileName: `${baseName}-blurry${output.format.fileExtension}`,
			audioDropped,
		};
	}

	// ---- Anteprima ----

	private previewCanvas: [HTMLCanvasElement, CanvasRenderingContext2D] | null = null;

	private updatePreview(source: HTMLCanvasElement, boxes: Box[]): void {
		const now = performance.now();
		if (now - this.lastPreviewAt < PREVIEW_INTERVAL_MS) return;
		this.lastPreviewAt = now;

		const scale = Math.min(1, PREVIEW_MAX_SIDE / Math.max(source.width, source.height));
		const w = Math.round(source.width * scale);
		const h = Math.round(source.height * scale);
		if (!this.previewCanvas || this.previewCanvas[0].width !== w || this.previewCanvas[0].height !== h) {
			this.previewCanvas = createCanvas(w, h);
		}
		const [canvas, ctx] = this.previewCanvas;
		ctx.drawImage(source, 0, 0, w, h);
		ctx.strokeStyle = '#ff4d4f';
		ctx.lineWidth = 2;
		for (const b of boxes) ctx.strokeRect(b.x * scale, b.y * scale, b.width * scale, b.height * scale);
		this.preview.set(canvas.toDataURL('image/jpeg', 0.7));
	}
}

/** Codec sorgente più efficienti dell'H.264 di uscita: a parità di qualità serve circa il 50% di bitrate in più. */
const EFFICIENT_CODECS = ['hevc', 'vp9', 'av1'];
const EFFICIENT_CODEC_FACTOR = 1.5;

/**
 * Bitrate di uscita per mantenere la qualità dell'originale: il bitrate video medio del sorgente, aumentato se il
 * sorgente usa un codec più efficiente. Null se non misurabile (si userà una qualità predefinita).
 */
async function targetBitrate(videoTrack: InputVideoTrack): Promise<number | null> {
	try {
		const stats = await videoTrack.computePacketStats();
		if (!stats.averageBitrate || !Number.isFinite(stats.averageBitrate)) return null;
		const factor = EFFICIENT_CODECS.includes(videoTrack.codec ?? '') ? EFFICIENT_CODEC_FACTOR : 1;
		return Math.round(stats.averageBitrate * factor);
	} catch {
		return null;
	}
}

function createCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	return [canvas, canvas.getContext('2d', { willReadFrequently: true })!];
}

/**
 * Oscura un'area ellittica: riduce la regione a poche celle e la riallarga con smoothing, così l'intensità
 * è proporzionale alla dimensione del volto. Il primo disegno è sempre opaco (funziona anche dove `ctx.filter`
 * non è supportato); dove lo è, un secondo passaggio con blur ammorbidisce i blocchi.
 */
function anonymize(ctx: CanvasRenderingContext2D, small: [HTMLCanvasElement, CanvasRenderingContext2D], box: Box): void {
	const frame = ctx.canvas;
	const cell = Math.max(MIN_CELL_PX, box.width / ANONYMIZE_CELLS);
	// L'ellisse è più larga del box per coprirne anche gli angoli (volti in movimento, box in ritardo).
	const rx = (box.width / 2) * ELLIPSE_SCALE;
	const ry = (box.height / 2) * ELLIPSE_SCALE;
	const cx = box.x + box.width / 2;
	const cy = box.y + box.height / 2;
	const margin = cell;
	const x1 = Math.max(0, Math.floor(cx - rx - margin));
	const y1 = Math.max(0, Math.floor(cy - ry - margin));
	const x2 = Math.min(frame.width, Math.ceil(cx + rx + margin));
	const y2 = Math.min(frame.height, Math.ceil(cy + ry + margin));
	const rw = x2 - x1;
	const rh = y2 - y1;
	if (rw < 2 || rh < 2) return;

	const [smallCanvas, smallCtx] = small;
	const sw = Math.max(2, Math.round(rw / cell));
	const sh = Math.max(2, Math.round(sw * rh / rw));
	smallCanvas.width = sw;
	smallCanvas.height = sh;
	smallCtx.imageSmoothingEnabled = true;
	smallCtx.imageSmoothingQuality = 'high';
	smallCtx.drawImage(frame, x1, y1, rw, rh, 0, 0, sw, sh);

	ctx.save();
	ctx.beginPath();
	ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
	ctx.clip();
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(smallCanvas, 0, 0, sw, sh, x1, y1, rw, rh);
	if (typeof ctx.filter === 'string') {
		ctx.filter = `blur(${Math.max(2, Math.round(margin / 2))}px)`;
		ctx.drawImage(smallCanvas, 0, 0, sw, sh, x1, y1, rw, rh);
	}
	ctx.restore();
}
