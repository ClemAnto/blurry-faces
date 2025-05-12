import { Injectable, signal } from '@angular/core';
import * as faceapi from 'face-api.js';


@Injectable({ providedIn: 'root' })
export class VideoProcessingService {

	public progressPreview = signal<string>(null);
	public progress = signal<number>(0);
	public rebuild = signal<number>(0);

	fps = 30;

	async loadModels(): Promise<void> {
		console.log("[VIDEO-PROCESSING] Load models...");
		try {
			//https://github.com/justadudewhohacks/face-api.js-models/tree/master
			//const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js-models@master/ssd_mobilenetv1';

			await faceapi.nets.ssdMobilenetv1.loadFromUri('assets/models/ssd_mobilenetv1');
			//await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
			console.log("[VIDEO-PROCESSING] Models loaded");
		} catch (err) {
			console.error("[VIDEO-PROCESSING] Model loading failed:", err);
		}

	}

	async blurryFaces(videoUrl: string):Promise<string> {
		console.log("[VIDEO-PROCESSING] Blurry faces!");
		return new Promise(async (resolve, reject) => {
			
			this.progress.set(0);
			const video = await this.initSource(videoUrl);
			const [canvas, ctx] = this.createCanvas(video.videoWidth, video.videoHeight);
			var lastDetections: faceapi.FaceDetection[] = [];
			var currentFrame = 0;
			const totalFrames = Math.floor(video.duration * this.fps);
			console.log("[VIDEO-PROCESSING] totalFrames: " + totalFrames);
			const frames: string[] = [];

			const processFrame = async () => {
				ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
				let detections = await this.detectFaces(canvas);
				detections = detections.length ? detections : lastDetections;
				if (detections.length) lastDetections = detections;
				detections.forEach(det => this.applyBlur(ctx, det));

				const frameData = canvas.toDataURL('image/png');
				this.progressPreview.set(frameData);
				frames.push(frameData);

				currentFrame++;	
				this.progress.set(Math.floor((currentFrame / totalFrames) * 100));
				console.log("[VIDEO-PROCESSING] Process frame "+currentFrame + " " + this.progress() + "%");

				//if (currentFrame < totalFrames && !this.stopProcessing) {
				if (this.progress() < 2) {
					await this.seekToTime(video, currentFrame / this.fps);
					await processFrame();

				} else {
					const finalDuration = frames.length / this.fps;
					console.log(`[HOME] Rebuild video duration: ${finalDuration} | frames: ${frames.length} `)

					const audioTracks = await this.extractAudioTracks(video);
					const processedVideoUrl = await this.rebuildVideo(
						frames, video.videoWidth, video.videoHeight, audioTracks, this.fps
					);

					resolve(processedVideoUrl);
				}
			};

			processFrame();
		});
	}

	async initSource(videoUrl: string): Promise<HTMLVideoElement> {
		const video = document.createElement('video');
		video.src = videoUrl;
		await video.play();
		video.pause();

		//this.fps = await this.retrieveFPS(video);
		/*
	await new Promise(resolve => {
		
		video.onloadedmetadata = () => resolve(true);
	});
	*/
		return video;
	}

	async retrieveFPS(video: HTMLVideoElement): Promise<number> {
		return new Promise(resolve => {
			console.log("retrieveFPS...");

			let prev = performance.now();
			let intervals: number[] = [];

			video.requestVideoFrameCallback(function step(now, metadata) {
				console.log("metadata: ", metadata);
				const delta = now - prev;
				prev = now;
				intervals.push(delta);

				if (intervals.length < 100) {
					video.requestVideoFrameCallback(step);
				} else {
					const avgInterval = intervals.reduce((a, b) => a + b) / intervals.length;
					const fps = 1000 / avgInterval;
					console.log("Estimated FPS:", fps.toFixed(2));
					video.currentTime = 0;
					video.pause();
					resolve(fps);
				}
			});

			video.muted = true;
			video.play();

		});
	}

	createCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		return [canvas, canvas.getContext('2d', { willReadFrequently: true })!];
	}

	async extractAudioTracks(video: HTMLMediaElement) {
		const audioCtx = new AudioContext();
		const sourceNode = audioCtx.createMediaElementSource(video);
		const dest = audioCtx.createMediaStreamDestination();

		sourceNode.connect(dest);
		sourceNode.connect(audioCtx.destination); // per sentire anche in output

		// Attiva il playback (audio live)
		//video.muted = true;
		//await video.play();
		//audioCtx.resume();
		video.currentTime = 0;
		await video.play();

		return dest.stream.getAudioTracks();
	}


	seekToTime(video: HTMLVideoElement, time: number): Promise<void> {
		return new Promise(resolve => {
			video.onseeked = () => resolve();
			video.currentTime = time;
		});
	}

	sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	async detectFaces(canvas: HTMLCanvasElement): Promise<faceapi.FaceDetection[]> {
		return await faceapi.detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.2 }));
	}

	applyBlur(ctx: CanvasRenderingContext2D, face: faceapi.FaceDetection) {
		const { x, y, width, height } = face.box;
		ctx.filter = 'blur(20px)';
		ctx.drawImage(ctx.canvas, x, y, width, height, x, y, width, height);
		ctx.filter = 'blur(5px)';
		ctx.drawImage(ctx.canvas, x, y, width, height, x, y, width, height);
		ctx.filter = 'none';
	}



	async rebuildVideo(
		frames: string[],
		width: number,
		height: number,
		audioTracks: MediaStreamTrack[],
		fps: number
	): Promise<string> {

		console.log("[VIDEO-PROCESSING] Rebuild video... fps:" + fps);

		//const [canvas, ctx1] = this.createCanvas(width, height);

		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d', { willReadFrequently: true })!
		const stream = canvas.captureStream(fps);

		audioTracks.forEach(track => {
			console.log("[VIDEO-PROCESSING] add audio track ", track);
			stream.addTrack(track)
		});

		const recorder = new MediaRecorder(stream, {
			//mimeType: 'video/webm;codecs=vp8,opus',
			mimeType: 'video/webm;codecs=vp9,opus',
			//videoBitsPerSecond: 5_000_000,
		});

		const chunks: Blob[] = [];
		recorder.ondataavailable = e => {
			console.log("[VIDEO-PROCESSING] chunk: " + e.data.size);
			if (e.data.size > 0) chunks.push(e.data);
		};
		recorder.start();

		const frameDuration = 1000 / fps;
		var count = 0;

		this.rebuild.set(0);
		const totalFrames = frames.length;
		console.log("[VIDEO-PROCESSING] totalFrames: " + totalFrames);

		while (frames.length) {
			var prev = performance.now();
			const imageUrl = frames.shift()!;
			const bitmap = await createImageBitmap(await fetch(imageUrl).then(r => r.blob()));
			//ctx.fillStyle = 'red'; // oppure '#ff0000'
			//ctx.fillRect(0, 0, canvas.width, canvas.height);
			ctx.drawImage(bitmap, 0, 0, width, height);
			const delta = performance.now() - prev;
			count++;
			await this.sleep(Math.max(1, frameDuration - delta));
			const perc = Math.floor(count/totalFrames * 100);
			console.log("[VIDEO-PROCESSING] Draw frame " + count + " " + perc + "%");
			this.rebuild.set(perc);
		}

		console.log("[VIDEO-PROCESSING] No more frames! ");

		recorder.requestData();
		await this.sleep(500);
		recorder.stop();

		return new Promise(resolve => {
			recorder.onstop = async () => {
				const blob = new Blob(chunks, { type: 'video/webm' });
				//const mp4 = await this.convertWebMtoMP4(blob);
				resolve(URL.createObjectURL(blob));
			};
		});
	}

	
}
