import { NgModule } from '@angular/core';
import { NzIconModule, NzIconService } from 'ng-zorro-antd/icon';
import { IconDefinition } from '@ant-design/icons-angular';

import {
	FolderOutline,
	StarOutline,
	PlayCircleOutline,
	DownloadOutline
} from '@ant-design/icons-angular/icons';

const ICONS: IconDefinition[] = [
	FolderOutline,
	StarOutline,
	PlayCircleOutline,
	DownloadOutline
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