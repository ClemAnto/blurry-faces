import { NgModule } from '@angular/core';
import { NzIconModule, NzIconService } from 'ng-zorro-antd/icon';
import { IconDefinition } from '@ant-design/icons-angular';

import {
	FolderOutline,
	StarOutline,
	PlayCircleOutline,
	DownloadOutline,
	WarningFill,
	InfoCircleFill,
	CloseCircleFill,
	ExclamationCircleFill
} from '@ant-design/icons-angular/icons';

/** Icone usate direttamente e da nz-result / nz-alert (stati warning, info, error). */
const ICONS: IconDefinition[] = [
	FolderOutline,
	StarOutline,
	PlayCircleOutline,
	DownloadOutline,
	WarningFill,
	InfoCircleFill,
	CloseCircleFill,
	ExclamationCircleFill
];

@NgModule({
	imports: [NzIconModule],
	exports: [NzIconModule]
})
export class CustomIconsModule {

	constructor(
		private Icons: NzIconService
	) {
		this.Icons.addIcon(...ICONS)
	}

}