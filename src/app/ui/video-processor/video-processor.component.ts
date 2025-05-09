import { CommonModule } from '@angular/common';
import { Component, ViewChild, ElementRef } from '@angular/core';
import * as faceapi from 'face-api.js';
import { IonContent, IonButton, IonProgressBar } from "@ionic/angular/standalone";

@Component({
	selector: 'app-video-processor',
	templateUrl: './video-processor.component.html',
	styleUrls: ['./video-processor.component.scss'],
	imports: [IonProgressBar, IonButton, IonContent, CommonModule]
})
export class VideoProcessorComponent {
	@ViewChild('previewCanvas', { static: false }) previewCanvasRef!: ElementRef<HTMLCanvasElement>;

	videoFile: File | null = null;
	originalVideoUrl: string | null = null;
	processedVideoUrl: string | null = null;
	processing = false;
	progress = 0;

	async onFileSelected(event: any) {
		this.videoFile = event.target.files[0];
		if (!this.videoFile) return;

		this.processedVideoUrl = null;

		if (this.originalVideoUrl) {
			URL.revokeObjectURL(this.originalVideoUrl);
		}

		this.originalVideoUrl = URL.createObjectURL(this.videoFile);
	}

	async processVideo() {
		console.log("START!");
		if (!this.videoFile || !this.previewCanvasRef) return;

		this.processing = true;
		this.progress = 0;

		// Carica modello FaceAPI
		await faceapi.nets.ssdMobilenetv1.loadFromUri('assets/models');

		// Crea video element
		const video = document.createElement('video');
		video.src = this.originalVideoUrl!;
		video.crossOrigin = 'anonymous';
		video.muted = true; // necessario per autoplay su mobile
		video.playsInline = true;

		await video.play(); // forza caricamento metadata
		video.pause();

		const fps = 25;
		const duration = video.duration;

		const canvas = this.previewCanvasRef.nativeElement;
		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;
		const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

		// 🔊 AUDIO dal video originale
		const videoStream = (video as any).captureStream();
		const audioTracks = videoStream.getAudioTracks();

		// 🎥 VIDEO dal canvas
		const canvasStream = canvas.captureStream(fps);

		// 🔄 Combina tracce audio + video
		const combinedStream = new MediaStream([
			...canvasStream.getVideoTracks(),
			...audioTracks
		]);

		const recordedChunks: Blob[] = [];
		const recorder = new MediaRecorder(combinedStream, { mimeType: 'video/webm; codecs=vp8,opus' });

		recorder.ondataavailable = (event) => {
			if (event.data.size > 0) recordedChunks.push(event.data);
		};

		recorder.onstop = () => {
			const blob = new Blob(recordedChunks, { type: 'video/webm' });
			this.processedVideoUrl = URL.createObjectURL(blob);
			this.processing = false;
			console.log("COMPLETED!");
		};

		recorder.start();

		// 🌀 Elabora ogni frame
		for (let t = 0; t < duration; t += 1 / fps) {
			video.currentTime = t;
			await new Promise(res => (video.onseeked = () => res(null)));

			ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

			console.log("DRAW FRAME " + t);

			const detections = await faceapi.detectAllFaces(canvas);

			detections.forEach(det => {
				const { x, y, width, height } = det.box;
				ctx.filter = 'blur(20px)';
				ctx.drawImage(canvas, x, y, width, height, x, y, width, height);
				ctx.filter = 'none';
			});

			this.progress = Math.round((t / duration) * 100);
			await new Promise(r => setTimeout(r, 1000 / fps));
		}

		recorder.stop();
	}

	downloadVideo() {
		if (!this.processedVideoUrl) return;
		const a = document.createElement('a');
		a.href = this.processedVideoUrl;
		a.download = 'video_elaborato_con_audio.webm';
		a.click();
	}
}
