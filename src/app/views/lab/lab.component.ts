
import { Component, OnDestroy, computed, signal, ChangeDetectionStrategy } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzResultModule } from 'ng-zorro-antd/result';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { ProcessedVideo, ProcessingCanceledError, VideoProcessingService } from '../../services/video-processing.service';
import { CustomIconsModule } from '../../shareds/custom-icons.module';

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

	phaseLabel = computed(() => this.VideoProcessing.phase() === 'render' ? 'Oscuramento' : 'Analisi volti');

	constructor(
		protected VideoProcessing: VideoProcessingService
	) {
		this.VideoProcessing.loadModels().catch(err => {
			console.error('[LAB] Caricamento modelli fallito', err);
			this.modelsError.set(true);
		});
	}

	onFileSelected(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;

		this.reset();
		this.file.set(file);
		this.sourceUrl.set(URL.createObjectURL(file));
	}

	async processVideo() {
		const file = this.file();
		if (!file || this.processing()) return;

		this.error.set(null);
		this.processing.set(true);
		try {
			this.result.set(await this.VideoProcessing.blurFaces(file));
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
