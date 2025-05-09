import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild } from '@angular/core';
import { IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonContent, IonHeader, IonImg, IonProgressBar, IonText, IonTitle, IonToolbar } from "@ionic/angular/standalone";
import * as faceapi from 'face-api.js';

@Component({
	selector: 'app-root',
	templateUrl: './home.page.html',
	styleUrls: ['./home.page.scss'],
	imports: [IonCardTitle, IonCardContent, IonCardHeader, IonProgressBar, IonText, IonCard, IonButton, IonTitle, IonToolbar, IonContent, IonHeader,
		CommonModule
	]
})
export class HomePage {
	videoUrl: string | ArrayBuffer | null = null;
	previewVideoUrl: string | null = null;
	processedVideoUrl: string | null = null;
	processing: boolean = false;
	progress: number = 0;
	stopProcessing: boolean = false;
	lastValidDetections: faceapi.FaceDetection[] = [];

	@ViewChild('videoPlayer', { static: false }) videoPlayer!: ElementRef<HTMLVideoElement>;

	async ngOnInit() {
		console.log('Caricamento dei modelli di face-api.js...');
		await Promise.all([
			//faceapi.nets.tinyFaceDetector.loadFromUri('/assets/models/tiny_face_detector')
			faceapi.nets.ssdMobilenetv1.loadFromUri('/assets/models/ssd_mobilenetv1')
			//faceapi.nets.mtcnn.loadFromUri('/assets/models/mtcnn')
			// Se servono altri modelli, caricali qui
		]);
		console.log('Modelli caricati correttamente');
	}

	// Gestione della selezione del file video
	onFileSelected(event: any) {
		const file = event.target.files[0];
		if (file) {
			console.log('File selezionato:', file.name);
			const reader = new FileReader();
			reader.onload = (e) => {
				if (e.target?.result) this.videoUrl = e.target.result;
			};
			reader.readAsDataURL(file);
		}
	}

	// Elaborazione del video
	async processVideo() {
		if (!this.videoUrl) return;
		this.processing = true;
		this.progress = 0;
		this.stopProcessing = false;
		console.log('Inizio elaborazione video');

		// Creazione di un elemento video per l'elaborazione
		const video = document.createElement('video');
		video.src = this.videoUrl as string;
		await video.play();

		// Creazione di un canvas per processare i frame
		const canvas = document.createElement('canvas');
		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;
		const ctx = canvas.getContext('2d', {willReadFrequently:true})!;

		// Calcolo del numero totale di frame (assumendo 25 fps)
		const fps = 25;
		const totalFrames = Math.floor(video.duration * fps);
		let currentFrame = 0;
	
		// Cattura lo stream dal canvas (solo video)
		const canvasStream = canvas.captureStream(fps);

		// Cattura lo stream audio (e video) dal video originale
		const videoStream = (video as any).captureStream();
		const audioTracks:[] = videoStream.getAudioTracks();
		if (audioTracks.length > 0) {
		  // Aggiungi ogni track audio allo stream del canvas
		  audioTracks.forEach(track => canvasStream.addTrack(track));
		}

		// Imposta il MediaRecorder per acquisire il video elaborato
		// Specificando un timeslice per ottenere dati periodici
		const mediaRecorder = new MediaRecorder(canvasStream, { mimeType: 'video/webm' });
		const recordedChunks: Blob[] = [];

		mediaRecorder.ondataavailable = (e) => {
			if (e.data.size > 0) {
				console.log('Push chunks ', e.data);
				recordedChunks.push(e.data);
			}
		};

		mediaRecorder.start(100);

		// Funzione ricorsiva per processare ogni frame
		const processFrame = async () => {
			if (this.stopProcessing || video.ended) {
				console.log('Elaborazione interrotta o completata');
				mediaRecorder.stop();
				this.processing = false;
				// Creazione del blob finale
				const blob = new Blob(recordedChunks, { type: 'video/webm' });
				this.processedVideoUrl = URL.createObjectURL(blob);
				return;
			}

			// Disegna il frame corrente nel canvas
			ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
			/*
			// Rilevazione dei volti nel frame corrente
			//const detections = await faceapi.detectAllFaces(canvas, new faceapi.TinyFaceDetectorOptions());
			let detections = await faceapi.detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence:0.2}))
			//let detections = await faceapi.detectAllFaces(canvas, new faceapi.MtcnnOptions());
			console.log(`Frame ${currentFrame}: volti rilevati = ${detections.length}`);

			// Se non rileva alcun volto, usa l'ultimo set valido (smoothing temporale)
			if (!detections || detections.length === 0) {
				console.log(`Frame ${currentFrame}: nessun volto rilevato, utilizzo rilevamento precedente`);
				detections = this.lastValidDetections;
			} else {
				this.lastValidDetections = detections;
			}

			// Applica un effetto blur per ogni volto rilevato
			detections.forEach(det => {
				const { x, y, width, height } = det.box;
				ctx.filter = 'blur(16px)';
				// Ridisegna la porzione del volto con l'effetto blur
				ctx.drawImage(canvas, x, y, width, height, x, y, width, height);
				ctx.filter = 'none';
			});
			
			*/
			currentFrame++;
			this.progress = Math.floor((currentFrame / totalFrames) * 100);

			// Aggiorna l’anteprima dinamica (qui viene salvato il frame corrente come immagine)
			this.previewVideoUrl = canvas.toDataURL('image/webp');

			// Processa il frame successivo
			requestAnimationFrame(processFrame);
			
		};

		processFrame();
	}

	// Interrompe e finalizza l'elaborazione corrente
	finalizeProcessing() {
		if (this.processing) {
			console.log('Finalizzazione dell’elaborazione in corso');
			this.stopProcessing = true;
		}
	}

	// Scarica il video elaborato
	downloadVideo() {
		if (this.processedVideoUrl) {
			console.log('Inizio download del video elaborato');
			const a = document.createElement('a');
			a.href = this.processedVideoUrl;
			a.download = 'BlurryFaces_video.webm';
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
		}
	}
}
