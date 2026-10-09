import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createFixture } from '../fixture';
import { launchApp } from './app';

const shots = path.join(__dirname, '..', '..', 'test-results', 'screenshots');

test('shows the library from Kyty.ini', async () => {
	const fixture = createFixture();
	const { app, page } = await launchApp(fixture);
	try {
		await expect(page.locator('.hero-title')).toHaveText('Crimson Harbor');
		await expect(page.locator('.tile')).toHaveCount(8);
		fs.mkdirSync(shots, { recursive: true });
		await page.waitForTimeout(2500);
		const renderer = await page.evaluate(() => window.__kytyDebug?.renderer);
		const frames = await page.evaluate(() => window.__kytyDebug?.frames() ?? 0);
		console.log(`renderer: ${renderer}, frames: ${frames}`);
		if (process.env.KYTY_E2E_SWIFTSHADER === '1') {
			expect(renderer).toBe('webgl');
			expect(frames).toBeGreaterThan(5);
		}
		await page.screenshot({ path: path.join(shots, `home-${renderer}.png`) });
	} finally {
		await app.close();
		fixture.cleanup();
	}
});
