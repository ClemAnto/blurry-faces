import { Component, ElementRef, ViewChild } from '@angular/core';
import { VideoProcessingService } from '../services/video-processing.service';
import * as faceapi from 'face-api.js';
import { IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonCard, IonText, IonProgressBar, IonCardHeader, IonCardTitle, IonCardContent } from "@ionic/angular/standalone";

@Component({
	selector: 'app-root',
	templateUrl: './home.page.html',
	styleUrls: ['./home.page.scss'],
	imports: [
		IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonCard, IonText, IonProgressBar, IonCardHeader, IonCardTitle, IonCardContent	
	]
})
export class HomePage {
	videoUrl: string | ArrayBuffer | null = null;
	previewVideoUrl: string | null = null;
	processedVideoUrl: string | null = null;
	processing = false;
	progress = 0;
	stopProcessing = false;

	@ViewChild('videoPlayer', { static: false }) videoPlayer!: ElementRef<HTMLVideoElement>;

	constructor(private VideoProcessing: VideoProcessingService) { }

	async ngOnInit() {
		console.log("[HOME] Load models...")
		await this.VideoProcessing.loadModels();
		console.log("[HOME] Models loaded")
	}

	onFileSelected(event: any) {
		const file = event.target.files[0];
		if (file) {
			const reader = new FileReader();
			reader.onload = e => this.videoUrl = e.target?.result ?? null;
			reader.readAsDataURL(file);
		}
	}

	async processVideo() {
		console.log("[HOME] Process Video")
		if (!this.videoUrl) return;

		this.processing = true;
		this.progress = 0;
		this.stopProcessing = false;

		const video = await this.VideoProcessing.initSource(this.videoUrl as string);
		const totalFrames = Math.floor(video.duration * this.VideoProcessing.fps);
		console.log(`[HOME] Video duration: ${video.duration} | frames: ${totalFrames} | size: ${video.videoWidth}x${video.videoHeight} `);

		
		const [canvas, ctx] = this.VideoProcessing.createCanvas(video.videoWidth, video.videoHeight);
		const frames: string[] = [];
		let lastDetections: faceapi.FaceDetection[] = [];
		let currentFrame = 0;

		console.log(`[HOME] Canvas size: ${canvas.width}x${canvas.height} `);


		const processFrame = async () => {
			ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
			let detections = await this.VideoProcessing.detectFaces(canvas);
			detections = detections.length ? detections : lastDetections;
			if (detections.length) lastDetections = detections;
			detections.forEach(det => this.VideoProcessing.applyBlur(ctx, det));

			const frameData = canvas.toDataURL('image/png');
			this.previewVideoUrl = frameData;
			frames.push(frameData);

			currentFrame++;
			this.progress = Math.floor((currentFrame / totalFrames) * 100);

			//if (currentFrame < totalFrames && !this.stopProcessing) {
			if (this.progress < 100) {
				await this.VideoProcessing.seekToTime(video, currentFrame / this.VideoProcessing.fps);
				await processFrame();
			} else {
				const finalDuration = frames.length / this.VideoProcessing.fps;
				console.log(`[HOME] Rebuild video duration: ${finalDuration} | frames: ${frames.length} `)
	
				const audioTracks = await this.VideoProcessing.extractAudioTracks(video);

				this.processedVideoUrl = await this.VideoProcessing.rebuildVideo(
					frames, video.videoWidth, video.videoHeight, audioTracks, this.VideoProcessing.fps
				);
				this.processing = false;
			}
		};

		await processFrame();
	}

	finalizeProcessing() {
		if (this.processing) {
			this.stopProcessing = true;
		}
	}

	downloadVideo() {
		if (this.processedVideoUrl) {
			const a = document.createElement('a');
			a.href = this.processedVideoUrl;
			a.download = 'BlurryFaces_video.webm';
			a.click();
		}
	}
}
