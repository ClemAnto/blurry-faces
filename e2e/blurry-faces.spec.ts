import { Page, expect, test } from '@playwright/test';
import { FIXTURES, audioStream, hasFacesSource, probe, videoStream } from './fixtures';

const browseButton = (page: Page) => page.getByRole('button', { name: 'Sfoglia' });
const processButton = (page: Page) => page.getByRole('button', { name: 'Elabora' });
const downloadButton = (page: Page) => page.getByRole('button', { name: 'Scarica' });
const cancelButton = (page: Page) => page.getByRole('button', { name: 'Annulla' });
const errorAlert = (page: Page) => page.locator('nz-alert[nztype="error"]');

async function openLab(page: Page) {
	const errors: string[] = [];
	page.on('pageerror', err => errors.push(err.message));
	await page.goto('/');
	await expect(page).toHaveURL(/#\/lab$/);
	return errors;
}

async function selectVideo(page: Page, file: string) {
	await page.locator('input[type=file]').setInputFiles(file);
	await expect(page.locator('nz-card video')).toBeVisible();
}

/** Avvia l'elaborazione, aspetta il risultato e lo scarica. Restituisce il percorso e il nome del file. */
async function processAndDownload(page: Page, outDir: string) {
	await expect(processButton(page)).toBeEnabled({ timeout: 60_000 });
	await processButton(page).click();
	await expect(page.locator('nz-progress')).toBeVisible();
	await expect(downloadButton(page)).toBeVisible({ timeout: 200_000 });
	await expect(errorAlert(page)).toHaveCount(0);

	const [download] = await Promise.all([page.waitForEvent('download'), downloadButton(page).click()]);
	const path = `${outDir}/${download.suggestedFilename()}`;
	await download.saveAs(path);
	return { path, fileName: download.suggestedFilename() };
}

/** Punteggio oltre il quale una detection è considerata un volto vero (sotto, SSD vede "volti" anche nelle macchie sfocate). */
const CONFIDENT = 0.5;
/**
 * Correlazione massima tra il dettaglio fine di originale e risultato in una zona oscurata. Misurata sul clip di prova:
 * volti oscurati 0,01–0,36 (i valori alti su box di pochi pixel), zone solo ricompresse 0,6–0,8.
 */
const MAX_RESIDUAL_DETAIL = 0.45;
/** La mediana delle zone di controllo deve stare sopra questa soglia, altrimenti la metrica non distingue nulla. */
const MIN_CONTROL_DETAIL = 0.5;

interface FaceCheck {
	t: number;
	score: number;
	/** Correlazione tra il dettaglio fine di originale e risultato nella zona del volto (0 = oscurato). */
	residual: number;
	box: string;
}

interface AnonymizationReport {
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
async function checkAnonymization(page: Page, step = 0.2): Promise<AnonymizationReport> {
	return page.evaluate(async ({ step, CONFIDENT }) => {
		const ng = (window as any).ng;
		const lab = ng.getComponent(document.querySelector('view-lab'));
		const svc = lab.VideoProcessing;

		const open = async (url: string) => {
			const video = document.createElement('video');
			video.muted = true;
			video.src = url;
			await new Promise(r => video.onloadeddata = r);
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
			const x = Math.round(b.x + b.width * 0.2), y = Math.round(b.y + b.height * 0.2);
			const w = Math.max(3, Math.round(b.width * 0.6)), h = Math.max(3, Math.round(b.height * 0.6));
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

			const after = (await svc.detectMultiScale(res.canvas)).filter((d: any) => d.score >= CONFIDENT);
			for (const d of after) report.leaked.push({ t, score: d.score, residual: diff(d), box: box(d) });
		}
		return report;
	}, { step, CONFIDENT });
}

function expectAnonymized(report: AnonymizationReport) {
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

test.describe('interfaccia', () => {

	test('mostra lo stato iniziale senza errori', async ({ page }) => {
		const errors = await openLab(page);
		await expect(page.getByText('Carica un video per iniziare')).toBeVisible();
		await expect(browseButton(page)).toBeVisible();
		expect(errors).toEqual([]);
	});

	test('dopo la scelta del file abilita Elabora quando il modello è caricato', async ({ page }) => {
		await openLab(page);
		await selectVideo(page, FIXTURES.noAudio);
		await expect(processButton(page)).toBeEnabled({ timeout: 60_000 });
		await expect(page.getByRole('button', { name: 'Altro video' })).toBeVisible();
	});

	test('un file non valido mostra un errore e lascia l\'app utilizzabile', async ({ page }) => {
		const errors = await openLab(page);
		await page.locator('input[type=file]').setInputFiles(FIXTURES.invalid);
		await expect(processButton(page)).toBeEnabled({ timeout: 60_000 });
		await processButton(page).click();
		await expect(errorAlert(page)).toBeVisible({ timeout: 30_000 });
		await expect(processButton(page)).toBeEnabled();
		expect(errors).toEqual([]);
	});

	test('Annulla interrompe l\'elaborazione senza errori', async ({ page }) => {
		test.skip(!hasFacesSource(), 'manca il video sorgente con volti');
		await openLab(page);
		await selectVideo(page, FIXTURES.faces);
		await expect(processButton(page)).toBeEnabled({ timeout: 60_000 });
		await processButton(page).click();
		await expect(page.locator('nz-progress')).toBeVisible();
		await cancelButton(page).click();
		await expect(processButton(page)).toBeVisible({ timeout: 30_000 });
		await expect(errorAlert(page)).toHaveCount(0);
		await expect(downloadButton(page)).toHaveCount(0);
	});
});

test.describe('elaborazione', () => {

	test('video senza audio: MP4 con gli stessi frame e nessun audio', async ({ page }, testInfo) => {
		await openLab(page);
		await selectVideo(page, FIXTURES.noAudio);
		const { path, fileName } = await processAndDownload(page, testInfo.outputDir);

		expect(fileName).toBe('no-audio-blurry.mp4');
		const input = videoStream(FIXTURES.noAudio);
		const output = videoStream(path);
		expect(output.codec_name).toBe('h264');
		expect([output.width, output.height]).toEqual([input.width, input.height]);
		expect(output.nb_read_packets).toBe(input.nb_read_packets);
		expect(audioStream(path)).toBeUndefined();
		await expect(page.locator('nz-alert[nztype="warning"]')).toHaveCount(0);
	});

	test.describe('con volti', () => {
		test.skip(!hasFacesSource(), 'manca il video sorgente con volti');

		test('MP4: oscura tutti i volti, mantiene frame, durata e audio', async ({ page }, testInfo) => {
			await openLab(page);
			await selectVideo(page, FIXTURES.faces);
			const { path, fileName } = await processAndDownload(page, testInfo.outputDir);
			expect(fileName).toBe('faces-blurry.mp4');

			expectAnonymized(await checkAnonymization(page));

			const input = probe(FIXTURES.faces);
			const output = probe(path);
			expect(videoStream(path).nb_read_packets).toBe(videoStream(FIXTURES.faces).nb_read_packets);
			expect(Number(output.format.duration)).toBeCloseTo(Number(input.format.duration), 1);
			const audioIn = audioStream(FIXTURES.faces)!;
			const audioOut = audioStream(path);
			expect(audioOut?.codec_name).toBe('aac');
			expect(audioOut?.nb_read_packets).toBe(audioIn.nb_read_packets);
		});

		test('video ruotato (da telefono): orientamento corretto e volti oscurati', async ({ page }, testInfo) => {
			await openLab(page);
			await selectVideo(page, FIXTURES.facesRotated);
			// Il fixture ha pixel verticali, ma il browser lo mostra orizzontale grazie al metadato.
			const stored = videoStream(FIXTURES.facesRotated);
			expect(stored.height).toBeGreaterThan(stored.width!);

			const { path } = await processAndDownload(page, testInfo.outputDir);

			// La rotazione è applicata ai pixel: niente metadato e frame già dritti.
			const output = videoStream(path);
			expect([output.width, output.height]).toEqual([stored.height, stored.width]);
			expect(output.side_data_list?.some(d => d.rotation)).toBeFalsy();

			const report = await checkAnonymization(page);
			expect(report.width).toBeGreaterThan(report.height);
			expectAnonymized(report);
		});

		test('WebM VP9/Opus: converte in MP4 e oscura i volti', async ({ page }, testInfo) => {
			await openLab(page);
			await selectVideo(page, FIXTURES.facesWebm);
			const { path, fileName } = await processAndDownload(page, testInfo.outputDir);

			expect(fileName).toBe('faces-blurry.mp4');
			expect(videoStream(path).nb_read_packets).toBe(videoStream(FIXTURES.facesWebm).nb_read_packets);
			expect(audioStream(path)?.codec_name).toBe('opus');

			expectAnonymized(await checkAnonymization(page));
		});

		test('si può elaborare un secondo video dopo il primo', async ({ page }, testInfo) => {
			await openLab(page);
			await selectVideo(page, FIXTURES.noAudio);
			await processAndDownload(page, testInfo.outputDir);

			await page.locator('input[type=file]').setInputFiles(FIXTURES.facesWebm);
			await expect(downloadButton(page)).toHaveCount(0);
			const { fileName } = await processAndDownload(page, testInfo.outputDir);
			expect(fileName).toBe('faces-blurry.mp4');
		});
	});
});
