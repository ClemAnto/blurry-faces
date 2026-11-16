import { Page, expect } from '@playwright/test';

export const browseButton = (page: Page) => page.getByRole('button', { name: 'Sfoglia' });
export const processButton = (page: Page) => page.getByRole('button', { name: 'Elabora' });
export const downloadButton = (page: Page) => page.getByRole('button', { name: 'Scarica' });
export const cancelButton = (page: Page) => page.getByRole('button', { name: 'Annulla' });
export const errorAlert = (page: Page) => page.locator('nz-alert[nztype="error"]');

export async function openLab(page: Page) {
	const errors: string[] = [];
	page.on('pageerror', err => errors.push(err.message));
	await page.goto('/');
	await expect(page).toHaveURL(/#\/lab$/);
	return errors;
}

export async function selectVideo(page: Page, file: string) {
	await page.locator('input[type=file]').setInputFiles(file);
	await expect(page.locator('nz-card video')).toBeVisible();
}

/** Avvia l'elaborazione, aspetta il risultato e lo scarica. Restituisce il percorso e il nome del file. */
export async function processAndDownload(page: Page, outDir: string, timeout = 200_000) {
	await expect(processButton(page)).toBeEnabled({ timeout: 60_000 });
	await processButton(page).click();
	await expect(page.locator('nz-progress')).toBeVisible();
	await expect(downloadButton(page)).toBeVisible({ timeout });
	await expect(errorAlert(page)).toHaveCount(0);

	const [download] = await Promise.all([page.waitForEvent('download'), downloadButton(page).click()]);
	const path = `${outDir}/${download.suggestedFilename()}`;
	await download.saveAs(path);
	return { path, fileName: download.suggestedFilename() };
}

/** Punteggio oltre il quale una detection è considerata un volto vero (sotto, SSD vede "volti" anche nelle macchie sfocate). */
export const CONFIDENT = 0.5;
/**
 * Soglia per i "volti" cercati direttamente nel risultato. Più alta: lì SSD scambia per volti magliette, scritte e
 * macchie sfocate con punteggi 0,50–0,58, e quanti ne trova cambia con la GPU (più falsi positivi sulla RTX).
 */
export const CONFIDENT_IN_RESULT = 0.65;
/**
 * Correlazione massima tra il dettaglio fine di originale e risultato in una zona oscurata. Misurata sul clip di prova:
 * volti oscurati 0,01–0,36 (i valori alti su box di pochi pixel), zone solo ricompresse 0,6–0,8.
 */
export const MAX_RESIDUAL_DETAIL = 0.45;
/** La mediana delle zone di controllo deve stare sopra questa soglia, altrimenti la metrica non distingue nulla. */
export const MIN_CONTROL_DETAIL = 0.5;

export interface FaceCheck {
	t: number;
	score: number;
	/** Correlazione tra il dettaglio fine di originale e risultato nella zona del volto (0 = oscurato). */
	residual: number;
	box: string;
}

export interface AnonymizationReport {
	width: number;
	height: number;
	frames: number;
	/** Fotogrammi dell'originale con almeno un volto sicuro. */
	framesWithFaces: number;
	/** Volti sicuri dell'originale la cui zona nel risultato è rimasta (quasi) identica. */
	uncovered: FaceCheck[];
	/** Volti sicuri trovati nel risultato in zone non modificate. */
	leaked: FaceCheck[];
	/** Dettaglio residuo negli angoli dei fotogrammi: misura quanto ne lascia la sola ricompressione. */
	control: number[];
}

/**
 * Confronta originale e risultato fotogramma per fotogramma (uno ogni `step` secondi) con lo stesso detector
 * dell'app. Usa le API di debug di Angular (`ng`), disponibili solo con il dev server.
 */
export async function checkAnonymization(page: Page, step = 0.2): Promise<AnonymizationReport> {
	return page.evaluate(async ({ step, CONFIDENT, CONFIDENT_IN_RESULT }) => {
		const ng = (window as any).ng;
		const lab = ng.getComponent(document.querySelector('view-lab'));
		const svc = lab.VideoProcessing;

		const open = async (url: string) => {
			const video = document.createElement('video');
			video.muted = true;
			video.src = url;
			await new Promise((resolve, reject) => {
				video.onloadeddata = resolve;
				video.onerror = () => reject(new Error(`Video non caricabile: ${url}`));
			});
			const canvas = document.createElement('canvas');
			canvas.width = video.videoWidth;
			canvas.height = video.videoHeight;
			return { video, canvas, ctx: canvas.getContext('2d', { willReadFrequently: true })! };
		};
		const seek = (v: HTMLVideoElement, t: number) => new Promise(r => { v.onseeked = r; v.currentTime = t; });

		const src = await open(lab.sourceUrl());
		const res = await open(lab.result().url);

		type Rect = { x: number; y: number; width: number; height: number };
		/** Laplaciano della luminanza (dettaglio fine) nella parte centrale del box, dentro l'ellisse oscurata. */
		const laplacian = (ctx: CanvasRenderingContext2D, b: Rect) => {
			// Parte centrale del box, limitata al fotogramma (i box dei volti tagliati escono dal bordo).
			const x = Math.max(0, Math.round(b.x + b.width * 0.2)), y = Math.max(0, Math.round(b.y + b.height * 0.2));
			const x2 = Math.min(ctx.canvas.width, Math.round(b.x + b.width * 0.8));
			const y2 = Math.min(ctx.canvas.height, Math.round(b.y + b.height * 0.8));
			const w = Math.max(3, x2 - x), h = Math.max(3, y2 - y);
			const d = ctx.getImageData(x, y, w, h).data;
			const lum = (r: number, c: number) => {
				const i = (r * w + c) * 4;
				return d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
			};
			const out: number[] = [];
			for (let r = 1; r < h - 1; r++) {
				for (let c = 1; c < w - 1; c++) {
					out.push(4 * lum(r, c) - lum(r - 1, c) - lum(r + 1, c) - lum(r, c - 1) - lum(r, c + 1));
				}
			}
			return out;
		};
		/**
		 * Correlazione tra il dettaglio fine dell'originale e quello del risultato: alta se la zona è solo
		 * ricompressa (il dettaglio è lo stesso), vicina a 0 se è stata oscurata.
		 */
		const diff = (b: Rect) => {
			const a = laplacian(src.ctx, b), c = laplacian(res.ctx, b);
			const n = a.length;
			if (n < 4) return 0;
			const ma = a.reduce((s, v) => s + v, 0) / n, mc = c.reduce((s, v) => s + v, 0) / n;
			let num = 0, da = 0, dc = 0;
			for (let i = 0; i < n; i++) {
				num += (a[i] - ma) * (c[i] - mc);
				da += (a[i] - ma) ** 2;
				dc += (c[i] - mc) ** 2;
			}
			return da && dc ? Math.max(0, num / Math.sqrt(da * dc)) : 0;
		};

		const report = { width: res.canvas.width, height: res.canvas.height, frames: 0, framesWithFaces: 0, uncovered: [] as any[], leaked: [] as any[], control: [] as number[] };
		for (let t = 0.05; t < src.video.duration - 0.05; t += step) {
			await seek(src.video, t);
			await seek(res.video, t);
			src.ctx.drawImage(src.video, 0, 0);
			res.ctx.drawImage(res.video, 0, 0);
			report.frames++;

			const before = (await svc.detectMultiScale(src.canvas)).filter((d: any) => d.score >= CONFIDENT);
			if (before.length) report.framesWithFaces++;
			// Controllo: dettaglio rimasto negli angoli, di norma solo ricompressi.
			const cw = res.canvas.width / 5, ch = res.canvas.height / 5;
			for (const [x, y] of [[0, 0], [4 * cw, 0], [0, 4 * ch], [4 * cw, 4 * ch]]) {
				report.control.push(diff({ x, y, width: cw, height: ch }));
			}

			const box = (d: any) => [d.x, d.y, d.width, d.height].map(Math.round).join(',');
			for (const d of before) report.uncovered.push({ t, score: d.score, residual: diff(d), box: box(d) });

			const after = (await svc.detectMultiScale(res.canvas)).filter((d: any) => d.score >= CONFIDENT_IN_RESULT);
			for (const d of after) report.leaked.push({ t, score: d.score, residual: diff(d), box: box(d) });
		}
		return report;
	}, { step, CONFIDENT, CONFIDENT_IN_RESULT });
}

export function expectAnonymized(report: AnonymizationReport) {
	const worst = Math.max(...report.uncovered.map(f => f.residual));
	const control = [...report.control].sort((a, b) => a - b)[Math.floor(report.control.length / 2)];
	console.log(`[e2e] ${report.uncovered.length} volti nell'originale, dettaglio residuo massimo ${worst.toFixed(2)} `
		+ `(controllo, mediana angoli: ${control.toFixed(2)}); `
		+ `${report.leaked.length} detection sicure nel risultato`);
	expect(control, 'le zone di controllo (solo ricompresse) devono restare correlate all\'originale').toBeGreaterThan(MIN_CONTROL_DETAIL);
	expect(report.framesWithFaces / report.frames, 'il clip di prova deve contenere volti').toBeGreaterThan(0.5);
	expect(report.uncovered.filter(f => f.residual > MAX_RESIDUAL_DETAIL), 'volti dell\'originale rimasti scoperti').toEqual([]);
	expect(report.leaked.filter(f => f.residual > MAX_RESIDUAL_DETAIL), 'volti riconoscibili in zone non oscurate del risultato').toEqual([]);
}