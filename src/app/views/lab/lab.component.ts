import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzResultModule } from 'ng-zorro-antd/result';
import { CustomIconsModule } from '../../shareds/custom-icons.module';

@Component({
  selector: 'app-lab',
  imports: [
	CommonModule,
	NzButtonModule,
	NzResultModule,
	CustomIconsModule	
  ],
  templateUrl: './lab.component.html',
  styleUrl: './lab.component.scss'
})
export class LabComponent {

}
