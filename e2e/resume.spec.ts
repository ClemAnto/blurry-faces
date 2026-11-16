import { Page, expect, test } from '@playwright/test';
import { FIXTURES, hasFacesSource, videoStream } from './fixtures';
import { checkAnonymization, downloadButton, expectAnonymized, openLab, processButton, selectVideo } from './helpers';

const resumeButton = (page: Page) => page.getByRole('button', { name: 'Riprendi' });
const discardButton = (page: Page) => page.getByRole('button', { name: 'Scarta' });
const interrupted = (page: Page) => page.getByText('Elaborazione interrotta');

/** Fotogrammi analizzati nel checkpoint salvato in OPFS (null se non c'è o l'analisi è già completa). */
function savedFrames(page: Page): Promise<number | null> {
	return page.evaluate(async () => {
		try {
			const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('blurry-faces-job');
			const file = await (await dir.getFileHandle('job.json')).getFile();
			const job = JSON.parse(await file.text()).data;
			return job.analysisDone ? null : job.timestamps.length || null;
		} catch {
			return null;
		}
	});
}

/**
 * Avvia l'elaborazione e, appena esiste un checkpoint con l'analisi in corso, ricarica la pagina come farebbe un
 * crash. Non dipende dalla velocità della GPU (sulla RTX l'analisi del clip di prova dura pochi secondi).
 */
async function interrupt(page: Page, file: string) {
	const errors: string[] = [];
	const logs: string[] = [];
	page.on('pageerror', err => errors.push(err.message));
	page.on('console', m => logs.push(m.text()));
	await openLab(page);
	await selectVideo(page, file);
	await expect(processButton(page)).toBeEnabled({ timeout: 60_000 });
	await processButton(page).click();
	await expect.poll(() => savedFrames(page), { timeout: 120_000, intervals: [50] }).toBeGreaterThan(0);
	const saved = (await savedFrames(page))!;
	page.once('dialog', d => d.accept()); // conferma di uscita durante l'elaborazione
	await page.reload();
	return { saved, errors, logs };
}

test.describe('ripresa di un lavoro interrotto', () => {
	test.skip(!hasFacesSource(), 'manca il video sorgente con volti');

	test('dopo un ricaricamento riprende dal punto raggiunto e produce un risultato completo', async ({ page }, testInfo) => {
		test.setTimeout(600_000);
		const { saved, errors, logs } = await interrupt(page, FIXTURES.faces);

		await expect(interrupted(page)).toBeVisible();
		await expect(page.getByText(/si è fermata al \d+%/)).toBeVisible();

		await expect(resumeButton(page)).toBeEnabled({ timeout: 60_000 });
		await resumeButton(page).click();

		await expect(downloadButton(page)).toBeVisible({ timeout: 200_000 });
		// Riparte dal checkpoint (almeno i fotogrammi salvati prima dell'interruzione), non da zero.
		const resumed = logs.map(l => l.match(/Ripresa dopo (\d+) fotogrammi/)).find(Boolean);
		expect(resumed, 'la ripresa deve partire dal checkpoint').toBeTruthy();
		expect(parseInt(resumed![1], 10)).toBeGreaterThanOrEqual(saved);

		const [download] = await Promise.all([page.waitForEvent('download'), downloadButton(page).click()]);
		const path = `${testInfo.outputDir}/${download.suggestedFilename()}`;
		await download.saveAs(path);
		expect(download.suggestedFilename()).toBe('faces-blurry.mp4');
		expect(videoStream(path).nb_read_packets).toBe(videoStream(FIXTURES.faces).nb_read_packets);
		expectAnonymized(await checkAnonymization(page));

		// A lavoro finito non resta nulla da riprendere.
		await page.reload();
		await expect(page.getByText('Carica un video per iniziare')).toBeVisible();
		await expect(interrupted(page)).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('Scarta elimina il lavoro interrotto', async ({ page }) => {
		const { errors } = await interrupt(page, FIXTURES.faces);
		await expect(interrupted(page)).toBeVisible();
		await discardButton(page).click();
		await expect(page.getByText('Carica un video per iniziare')).toBeVisible();
		await page.reload();
		await expect(page.getByText('Carica un video per iniziare')).toBeVisible();
		await expect(interrupted(page)).toHaveCount(0);
		expect(errors).toEqual([]);
	});
});
