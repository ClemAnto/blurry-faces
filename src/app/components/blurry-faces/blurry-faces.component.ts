import { Component, ViewChild, ElementRef } from '@angular/core';
import * as faceapi from 'face-api.js';
import { createFFmpeg, fetchFile } from '@ffmpeg/ffmpeg';
import { IonHeader, IonToolbar, IonContent, IonTitle, IonButton } from "@ionic/angular/standalone";
import { CommonModule } from '@angular/common';

@Component({
	selector: 'app-blurry-faces',
	templateUrl: 'blurry-faces.component.html',
	styleUrls: ['blurry-faces.component.scss'],
	imports: [CommonModule, IonHeader, IonTitle, IonButton, IonToolbar, IonContent]
})
export class BlurryFacesComponent {
	@ViewChild('videoPlayer', { static: false }) videoPlayer!: ElementRef<HTMLVideoElement>;
	videoLoaded = false;
	processing = false;
	downloadUrl: string | null = null;
	videoFile!: File;

	async ngOnInit() {
		await faceapi.nets.tinyFaceDetector.loadFromUri('/assets/models');
	}

	onVideoSelected(event: any) {
		this.videoFile = event.target.files[0];
		const url = URL.createObjectURL(this.videoFile);
		const video: HTMLVideoElement = this.videoPlayer.nativeElement;
		video.src = url;
		video.load();
		video.onloadedmetadata = () => {
			this.videoLoaded = true;
		};
	}

	async processVideo() {
		console.log("PROCESSING...")
		this.processing = true;
		const video = this.videoPlayer.nativeElement;

		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d');

		if (!ctx) {
			console.error('Impossibile ottenere il contesto 2D del canvas.');
			this.processing = false;
			return;
		}

		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;

		const fps = 25;
		const frames: Blob[] = [];

		video.currentTime = 0;

		console.log("VIDEO DURATION: " + video.duration);
		for (let t = 0; t < video.duration; t += 1 / fps) {
			await new Promise((res) => {
				video.currentTime = t;
				video.onseeked = async () => {
					ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

					const detections = await faceapi.detectAllFaces(canvas, new faceapi.TinyFaceDetectorOptions());
					console.log("DETECTION: ", detections);
					for (const det of detections) {
						const { x, y, width, height } = det.box;
						const face = ctx.getImageData(x, y, width, height);
						const blurred = this.blurImage(face); // tua funzione di blur
						ctx.putImageData(blurred, x, y);
					}

					const blob:Blob = await new Promise(resolve=>canvas.toBlob(blob=>resolve(blob!), 'image/jpeg'));
					frames.push(blob);
					console.log("FRAMES: " + frames.length);
					res(true);
				};
			});
		}

		console.log("FINALIZING...");
		// Usa ffmpeg.wasm per ricreare il video
		const ffmpeg = createFFmpeg({ log: true });
		await ffmpeg.load();

		// Scrive tutti i frame su fs di ffmpeg
		for (let i = 0; i < frames.length; i++) {
			console.log("WRITE FRAME " + i + "/" + frames.length);
			const fileData = await frames[i].arrayBuffer();
			ffmpeg.FS('writeFile', `frame_${i}.jpg`, new Uint8Array(fileData));
		}

		// Copia anche l’audio originale
		ffmpeg.FS('writeFile', 'input.mp4', await fetchFile(this.videoFile));

		const result = await ffmpeg.run(
			'-framerate', `${fps}`,
			'-i', 'frame_%d.jpg',
			'-i', 'input.mp4',
			'-map', '0:v:0',
			'-map', '1:a:0',
			'-c:v', 'libx264',
			'-c:a', 'copy',
			'-shortest',
			'output.mp4'
		);

		debugger

		const data = ffmpeg.FS('readFile', 'output.mp4');
		const videoBlob = new Blob([data.buffer], { type: 'video/mp4' });
		this.downloadUrl = URL.createObjectURL(videoBlob);
		this.processing = false;
	}

	blurImage(imageData: ImageData): ImageData {
		const data = imageData.data;
		const len = data.length;

		for (let i = 0; i < len; i += 4) {
			const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
			data[i] = data[i + 1] = data[i + 2] = avg;
		}

		return imageData;
	}
}
