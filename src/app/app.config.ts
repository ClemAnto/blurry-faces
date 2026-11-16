import { ApplicationConfig, provideZoneChangeDetection, importProvidersFrom } from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';


import { it_IT, provideNzI18n } from 'ng-zorro-antd/i18n';
import { registerLocaleData } from '@angular/common';
import it from '@angular/common/locales/it';
import { FormsModule } from '@angular/forms';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { routes } from './app.routes';
import { provideNzDateFnsAdapter } from 'ng-zorro-antd/core/time';


registerLocaleData(it);

export const appConfig: ApplicationConfig = {
	providers: [
		provideZoneChangeDetection({ eventCoalescing: true }), 
		provideRouter(routes, withHashLocation()), provideNzI18n(it_IT), 
		importProvidersFrom(FormsModule), 
		provideAnimationsAsync(), 
		provideHttpClient(withXhr()), provideNzDateFnsAdapter()
	]
};
