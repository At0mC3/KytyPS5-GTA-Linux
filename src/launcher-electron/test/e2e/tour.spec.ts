import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createFixture } from '../fixture';
import { installFakeGamepad, launchApp, press } from './app';

const shots = path.join(__dirname, '..', '..', 'test-results', 'screenshots');

test('controller tour of every screen', async () => {
	const fixture = createFixture();
	const size = process.env.KYTY_E2E_SIZE === '1080' ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
	const suffix = size.width === 1920 ? '-1080' : '';
	const { app, page } = await launchApp(fixture, [], size);
	const shot = async (name: string) => {
		await page.waitForTimeout(700);
		await page.screenshot({ path: path.join(shots, `${name}${suffix}.png`) });
	};
	fs.mkdirSync(shots, { recursive: true });
	try {
		await installFakeGamepad(page);
		await expect(page.locator('.hero-title')).toHaveText('Crimson Harbor');
		const renderer = await page.evaluate(() => window.__kytyDebug?.renderer);
		console.log(`renderer: ${renderer}`);

		// Move right twice to Grand Theft Auto V.
		await press(page, 'right');
		await press(page, 'right');
		await expect(page.locator('.hero-title')).toHaveText('Grand Theft Auto V');
		await shot('01-home-gta');

		// Cards row.
		await press(page, 'down');
		await press(page, 'down');
		await shot('02-home-cards');
		await press(page, 'circle');

		// Options menu.
		await press(page, 'options');
		await expect(page.locator('.modal-sheet')).toBeVisible();
		await shot('03-game-menu');
		await press(page, 'circle');

		// Trophies of GTA V.
		await page.locator('.cards .card').first().click();
		await expect(page.locator('.trophy-item')).toHaveCount(6);
		await press(page, 'down');
		await shot('04-trophies');
		await press(page, 'circle');

		// Global settings.
		await page.locator('[data-testid="open-settings"]').click();
		await expect(page.locator('.settings-nav-item')).toHaveCount(12);
		await press(page, 'down');
		await press(page, 'right');
		await shot('05-settings-graphics');
		await press(page, 'r1');
		await press(page, 'r1');
		await press(page, 'r1');
		await press(page, 'r1');
		await press(page, 'r1');
		await press(page, 'right');
		await shot('06-settings-controller');
		await press(page, 'r1');
		await press(page, 'right');
		await shot('07-settings-input');

		// On-screen keyboard from the user name.
		await page.locator('.settings-nav-item[data-section="user"]').click();
		await page.locator('[data-testid="setting-user-name"]').click();
		await expect(page.locator('.osk')).toBeVisible();
		await shot('08-keyboard');
		await press(page, 'circle');
		await press(page, 'circle');
		await press(page, 'circle');

		// Library.
		await press(page, 'r1');
		await expect(page.locator('.library-item')).toHaveCount(7);
		await shot('09-library');
		await press(page, 'circle');

		// Launch GTA V: it has the recommended settings, so it starts straight away.
		await expect(page.locator('.hero-title')).toHaveText('Grand Theft Auto V');
		await page.locator('[data-testid="play"]').click();
		await expect(page.locator('[data-testid="stop"]')).toBeVisible();
		await page.locator('[aria-label="Emulator log"]').click();
		await expect(page.locator('.log-line').nth(3)).toBeVisible();
		await shot('10-log');
		await page.locator('.log-actions .button-danger').click();
		await expect(page.locator('.log-actions .button-danger')).toHaveCount(0);
		await press(page, 'circle');

		// Folder browser.
		await page.locator('[data-testid="open-settings"]').click();
		await page.locator('.settings-nav-item[data-section="folders"]').click();
		await page.locator('[data-testid="add-folder"]').click();
		await expect(page.locator('.browser')).toBeVisible();
		await shot('11-folder-browser');
	} finally {
		await app.close();
		fixture.cleanup();
	}
});
