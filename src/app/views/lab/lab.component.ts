import { Component, HostListener, OnDestroy, computed, signal, ChangeDetectionStrategy } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzResultModule } from 'ng-zorro-antd/result';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { ProcessedVideo, ProcessingCanceledError, VideoProcessingService } from '../../services/video-processing.service';
import { CustomIconsModule } from '../../shareds/custom-icons.module';
import { JobCheckpoint, JobCheckpointService, identityOf, sameFile } from '../../services/job-checkpoint.service';

@Component({
	selector: 'view-lab',
	imports: [
    NzButtonModule,
    NzResultModule,
    NzCardModule,
    NzProgressModule,
    NzAlertModule,
    CustomIconsModule
],
	templateUrl: './lab.component.html',
	styleUrl: './lab.component.scss',
	changeDetection: ChangeDetectionStrategy.Eager,
	host: {
		class: "flex min-h-full items-center justify-center p-2"
	}
})
export class LabComponent implements OnDestroy {

	file = signal<File | null>(null);
	sourceUrl = signal<string | null>(null);
	result = signal<ProcessedVideo | null>(null);
	processing = signal(false);
	error = signal<string | null>(null);
	modelsError = signal(false);

	/** Lavoro interrotto trovato all'apertura, da riprendere o scartare. */
	pendingJob = signal<{ checkpoint: JobCheckpoint; progress: number } | null>(null);
	/** True mentre si aspetta che l'utente riselezioni il file del lavoro interrotto (copia locale assente). */
	private awaitingReselect = false;

	phaseLabel = computed(() => this.VideoProcessing.phase() === 'render' ? 'Oscuramento' : 'Analisi volti');

	constructor(
		protected VideoProcessing: VideoProcessingService,
		private jobs: JobCheckpointService,
	) {
		this.VideoProcessing.loadModels().catch(err => {
			console.error('[LAB] Caricamento modelli fallito', err);
			this.modelsError.set(true);
		});
		this.jobs.load().then(saved => {
			if (saved && !this.file()) {
				this.pendingJob.set({ checkpoint: saved.checkpoint, progress: VideoProcessingService.progressOf(saved.checkpoint) });
			}
		});
	}

	/** Durante l'elaborazione chiede conferma prima di chiudere o ricaricare la pagina. */
	@HostListener('window:beforeunload', ['$event'])
	onBeforeUnload(event: BeforeUnloadEvent) {
		if (this.processing()) event.preventDefault();
	}

	onFileSelected(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;

		const pending = this.pendingJob();
		if (this.awaitingReselect && pending) {
			this.awaitingReselect = false;
			if (!sameFile(identityOf(file), pending.checkpoint.file)) {
				this.error.set(`Il file scelto non è quello dell'elaborazione interrotta (${pending.checkpoint.file.name}).`);
				return;
			}
			this.startResume(file, pending.checkpoint);
			return;
		}

		this.reset();
		this.pendingJob.set(null);
		this.file.set(file);
		this.sourceUrl.set(URL.createObjectURL(file));
	}

	/** Riprende il lavoro interrotto, dalla copia locale del video o chiedendo di riselezionarlo. */
	async resumeJob(fileInput: HTMLInputElement) {
		const pending = this.pendingJob();
		if (!pending) return;
		this.error.set(null);
		const file = await this.jobs.videoFile(pending.checkpoint);
		if (file) {
			this.startResume(file, pending.checkpoint);
		} else {
			this.awaitingReselect = true;
			fileInput.click();
		}
	}

	async discardJob() {
		this.pendingJob.set(null);
		await this.jobs.discard();
	}

	private startResume(file: File, checkpoint: JobCheckpoint) {
		this.reset();
		this.pendingJob.set(null);
		this.file.set(file);
		this.sourceUrl.set(URL.createObjectURL(file));
		this.processVideo(checkpoint);
	}

	async processVideo(resume?: JobCheckpoint) {
		const file = this.file();
		if (!file || this.processing()) return;

		this.error.set(null);
		this.processing.set(true);
		try {
			this.result.set(await this.VideoProcessing.blurFaces(file, resume));
		} catch (err) {
			if (!(err instanceof ProcessingCanceledError)) {
				console.error('[LAB] Elaborazione fallita', err);
				this.error.set(err instanceof Error ? err.message : String(err));
			}
		} finally {
			this.processing.set(false);
		}
	}

	cancel() {
		this.VideoProcessing.cancel();
	}

	downloadProcessedVideo() {
		const result = this.result();
		if (!result) return;
		const a = document.createElement('a');
		a.href = result.url;
		a.download = result.fileName;
		a.click();
	}

	reset() {
		const source = this.sourceUrl();
		const result = this.result();
		if (source) URL.revokeObjectURL(source);
		if (result) URL.revokeObjectURL(result.url);
		this.file.set(null);
		this.sourceUrl.set(null);
		this.result.set(null);
		this.error.set(null);
	}

	ngOnDestroy() {
		if (this.processing()) this.VideoProcessing.cancel();
		this.reset();
	}
}
