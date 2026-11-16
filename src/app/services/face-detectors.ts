import * as faceapi from 'face-api.js';
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
import { Detection } from './face-tracking';

/**
 * - `ssd`: SSD MobileNet v1 di face-api.js.
 * - `mediapipe`: BlazeFace full-range di MediaPipe, pensato per inquadrature da fotocamera posteriore.
 * - `combined`: entrambi, unendo i risultati (più lento, ma un volto sfugge solo se sfugge a tutti e due).
 *
 * SCRFD e YOLOv8-face via ONNX Runtime Web sono stati provati e scartati: vedi docs/TODO.md.
 */
export type DetectorKind = 'ssd' | 'mediapipe' | 'combined';

export interface FaceDetectorBackend {
	load(): Promise<void>;
	detect(canvas: HTMLCanvasElement): Promise<Detection[]>;
}

const SSD_MIN_CONFIDENCE = 0.2;
const MEDIAPIPE_MIN_CONFIDENCE = 0.3;

class SsdBackend implements FaceDetectorBackend {
	private loading: Promise<void> | null = null;

	load(): Promise<void> {
		this.loading ??= faceapi.nets.ssdMobilenetv1.loadFromUri('assets/models/ssd_mobilenetv1')
			.catch(err => {
				this.loading = null;
				throw err;
			});
		return this.loading;
	}

	async detect(canvas: HTMLCanvasElement): Promise<Detection[]> {
		const results = await faceapi.detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: SSD_MIN_CONFIDENCE }));
		return results.map(r => ({ x: r.box.x, y: r.box.y, width: r.box.width, height: r.box.height, score: r.score }));
	}
}

class MediaPipeBackend implements FaceDetectorBackend {
	private loading: Promise<FaceDetector> | null = null;
	private detector: FaceDetector | null = null;

	load(): Promise<void> {
		this.loading ??= this.create().catch(err => {
			this.loading = null;
			throw err;
		});
		return this.loading.then(d => { this.detector = d; });
	}

	private async create(): Promise<FaceDetector> {
		const fileset = await FilesetResolver.forVisionTasks('assets/mediapipe/wasm');
		const options = (delegate: 'GPU' | 'CPU') => ({
			baseOptions: { modelAssetPath: 'assets/models/mediapipe/blaze_face_full_range.tflite', delegate },
			runningMode: 'IMAGE' as const,
			minDetectionConfidence: MEDIAPIPE_MIN_CONFIDENCE,
		});
		try {
			return await FaceDetector.createFromOptions(fileset, options('GPU'));
		} catch (err) {
			console.warn('[DETECTOR] MediaPipe su GPU non disponibile, uso la CPU', err);
			return FaceDetector.createFromOptions(fileset, options('CPU'));
		}
	}

	async detect(canvas: HTMLCanvasElement): Promise<Detection[]> {
		if (!this.detector) await this.load();
		const result = this.detector!.detect(canvas);
		return result.detections
			.filter(d => d.boundingBox)
			.map(d => ({
				x: d.boundingBox!.originX,
				y: d.boundingBox!.originY,
				width: d.boundingBox!.width,
				height: d.boundingBox!.height,
				score: d.categories[0]?.score ?? 0,
			}));
	}
}

class CombinedBackend implements FaceDetectorBackend {
	constructor(private backends: FaceDetectorBackend[]) { }

	async load(): Promise<void> {
		for (const b of this.backends) await b.load();
	}

	async detect(canvas: HTMLCanvasElement): Promise<Detection[]> {
		const all: Detection[] = [];
		for (const b of this.backends) all.push(...await b.detect(canvas));
		return all;
	}
}

const ssd = new SsdBackend();
const mediapipe = new MediaPipeBackend();

export const DETECTORS: Record<DetectorKind, FaceDetectorBackend> = {
	ssd,
	mediapipe,
	combined: new CombinedBackend([ssd, mediapipe]),
};
