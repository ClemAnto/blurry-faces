import { defineConfig } from '@playwright/test';

const PORT = 4300;

export default defineConfig({
	testDir: './e2e',
	globalSetup: './e2e/global-setup.ts',
	// Le elaborazioni sono pesanti (detection su GPU/CPU): meglio in serie che in parallelo.
	workers: 1,
	timeout: 240_000,
	expect: { timeout: 15_000 },
	reporter: [['list']],
	use: {
		baseURL: `http://localhost:${PORT}`,
		// Usa il Chrome installato: niente download dei browser di Playwright.
		channel: 'chrome',
		headless: true,
		acceptDownloads: true,
	},
	webServer: {
		command: `yarn start --port ${PORT}`,
		url: `http://localhost:${PORT}`,
		reuseExistingServer: true,
		timeout: 120_000,
	},
});
