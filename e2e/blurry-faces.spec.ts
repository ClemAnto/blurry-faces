import { Page, expect, test } from '@playwright/test';
import { statSync } from 'node:fs';
import { FIXTURES, audioStream, hasFacesSource, probe, videoStream } from './fixtures';
import {
	browseButton, cancelButton, checkAnonymization, downloadButton, errorAlert, expectAnonymized,
	openLab, processAndDownload, processButton, selectVideo,
} from './helpers';

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

			// Stessa qualità dell'originale: il bitrate (quindi la dimensione) resta vicino a quello di partenza.
			const ratio = statSync(path).size / statSync(FIXTURES.faces).size;
			expect(ratio, `dimensione risultato / originale = ${ratio.toFixed(2)}`).toBeGreaterThan(0.6);
			expect(ratio).toBeLessThan(1.5);
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
