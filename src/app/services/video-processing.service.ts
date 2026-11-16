import { Injectable, signal } from '@angular/core';
import * as faceapi from 'face-api.js';
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
	QUALITY_HIGH,
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
const MIN_CONFIDENCE = 0.2;
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

	private modelsPromise: Promise<void> | null = null;
	private canceled = false;
	private conversion: Conversion | null = null;
	private lastPreviewAt = 0;

	loadModels(): Promise<void> {
		this.modelsPromise ??= faceapi.nets.ssdMobilenetv1.loadFromUri('assets/models/ssd_mobilenetv1')
			.then(() => this.modelsReady.set(true))
			.catch(err => {
				this.modelsPromise = null;
				throw err;
			});
		return this.modelsPromise;
	}

	cancel(): void {
		this.canceled = true;
		this.conversion?.cancel();
	}

	/**
	 * Oscura i volti del video in due passate: prima rileva i volti su tutti i frame e ne ricostruisce le tracce,
	 * poi decodifica di nuovo il video, oscura e ricodifica in MP4 copiando l'audio originale.
	 */
	async blurFaces(file: File): Promise<ProcessedVideo> {
		this.canceled = false;
		this.progress.set(0);
		this.preview.set(null);
		await this.loadModels();

		const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
		try {
			const videoTrack = await input.getPrimaryVideoTrack();
			if (!videoTrack) throw new Error('Il file non contiene una traccia video.');
			if (!(await videoTrack.canDecode())) throw new Error('Il formato video non è supportato da questo browser.');

			this.phase.set('analysis');
			const analysis = await this.analyze(input, videoTrack);

			this.phase.set('render');
			return await this.render(input, analysis, file.name);
		} catch (err) {
			if (err instanceof ConversionCanceledError || this.canceled) throw new ProcessingCanceledError();
			throw err;
		} finally {
			this.conversion = null;
			this.phase.set('idle');
			input.dispose();
		}
	}

	// ---- Passata 1: detection e tracking ----

	private async analyze(input: Input, videoTrack: InputVideoTrack): Promise<Analysis> {
		const width = videoTrack.displayWidth;
		const height = videoTrack.displayHeight;
		const start = await videoTrack.getFirstTimestamp();
		const duration = Math.max(0.001, (await input.computeDuration()) - start);

		const scale = Math.min(1, MAX_DETECTION_SIDE / Math.max(width, height));
		const [detCanvas, detCtx] = createCanvas(Math.round(width * scale), Math.round(height * scale));

		const timestamps: number[] = [];
		const frames: Detection[][] = [];
		const sink = new CanvasSink(videoTrack, { poolSize: 2 });

		for await (const wrapped of sink.canvases()) {
			if (this.canceled) throw new ProcessingCanceledError();

			detCtx.drawImage(wrapped.canvas, 0, 0, detCanvas.width, detCanvas.height);
			const detections = await this.detectMultiScale(detCanvas);
			timestamps.push(wrapped.timestamp);
			frames.push(detections.map(d => ({
				x: d.x / scale, y: d.y / scale, width: d.width / scale, height: d.height / scale, score: d.score,
			})));

			this.progress.set(Math.min(100, Math.floor((wrapped.timestamp - start) / duration * ANALYSIS_WEIGHT * 100)));
			this.updatePreview(detCanvas, detections);
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

	private async detect(canvas: HTMLCanvasElement): Promise<Detection[]> {
		const results = await faceapi.detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_CONFIDENCE }));
		return results.map(r => ({ x: r.box.x, y: r.box.y, width: r.box.width, height: r.box.height, score: r.score }));
	}

	private tileCache: [HTMLCanvasElement, CanvasRenderingContext2D] | null = null;

	private tileCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
		if (!this.tileCache || this.tileCache[0].width !== width || this.tileCache[0].height !== height) {
			this.tileCache = createCanvas(width, height);
		}
		return this.tileCache;
	}

	// ---- Passata 2: oscuramento e codifica ----

	private async render(input: Input, analysis: Analysis, sourceName: string): Promise<ProcessedVideo> {
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
				quality: QUALITY_HIGH,
				processedWidth: analysis.width,
				processedHeight: analysis.height,
				process: (sample: VideoSample) => {
					const w = sample.displayWidth;
					const h = sample.displayHeight;
					if (!frameCanvas || frameCanvas.width !== w || frameCanvas.height !== h) {
						[frameCanvas, frameCtx] = createCanvas(w, h);
					}
					sample.draw(frameCtx!, 0, 0, w, h);

					const i = nearestIndex(analysis.timestamps, sample.timestamp);
					const sx = w / analysis.width;
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
