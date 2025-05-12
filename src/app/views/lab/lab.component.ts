import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzResultModule } from 'ng-zorro-antd/result';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { VideoProcessingService } from '../../services/video-processing.service';
import { CustomIconsModule } from '../../shareds/custom-icons.module';

@Component({
	selector: 'view-lab',
	imports: [
		CommonModule,
		NzButtonModule,
		NzResultModule,
		NzCardModule,
		NzProgressModule,
		CustomIconsModule
	],
	templateUrl: './lab.component.html',
	styleUrl: './lab.component.scss',
	host: {
		class: "flex min-h-full items-center justify-center p-2"
	}
})
export class LabComponent {

	processing = signal<boolean>(false);
	sourceUrl = signal<string>(null);
	resultUrl = signal<string>(null);
	percentage = computed(()=>Math.round((this.VideoProcessing.rebuild() + this.VideoProcessing.progress())/2));

	constructor(
		protected VideoProcessing:VideoProcessingService
	) {
		this.VideoProcessing.loadModels();
	}

	onFileSelected(event: any) {
		const file = event.target.files[0];
		if (file) {
			const url = URL.createObjectURL(file);
			console.log("[LAB] Selected source: " + url)
			this.sourceUrl.set(url);
		}
	}

	async processVideo() {
		this.processing.set(true);
		const processedVideoUrl = await this.VideoProcessing.blurryFaces(this.sourceUrl());
		this.resultUrl.set(processedVideoUrl);
		this.processing.set(false);
	}

	downloadProcessedVideo() {
		const a = document.createElement('a');
		a.href = this.resultUrl();
		a.download = `blurry-faces-${Date.now()}.webm`;
		a.click();
	}
}
