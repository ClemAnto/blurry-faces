import { Routes } from '@angular/router';

export const routes: Routes = [
	{
		path: 'lab', loadComponent: () =>
			import('./views/lab/lab.component').then(m => m.LabComponent),
	},
	{ path: '', redirectTo: '/lab', pathMatch: 'full' } // opzionale: redirect alla root
];
