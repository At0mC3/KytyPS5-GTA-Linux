import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createFixture } from '../fixture';
import { installFakeGamepad, launchApp, press } from './app';

function launches(file: string): string[][] {
	return fs.existsSync(file)
		? fs
				.readFileSync(file, 'utf8')
				.trim()
				.split('\n')
				.map((line) => JSON.parse(line) as string[])
		: [];
}

test('launches with the Qt launcher arguments and shows the log', async () => {
	const fixture = createFixture();
	const { app, page } = await launchApp(fixture);
	try {
		await installFakeGamepad(page);
		await expect(page.locator('.hero-title')).toHaveText('Crimson Harbor');
		await press(page, 'cross');
		await expect.poll(() => launches(fixture.argvFile).length).toBe(1);
		const args = launches(fixture.argvFile)[0]!;
		expect(args.slice(0, 8)).toEqual(['--screen-width', '1280', '--screen-height', '720', '--user-name', 'Kyty', '--user-id', '1000']);
		expect(args.slice(-2)).toEqual(['--game', path.join(fixture.gamesDir, 'Crimson Harbor', 'eboot.bin')]);
		await expect(page.locator('[data-testid="stop"]')).toBeVisible();
		await page.locator('[data-testid="stop"]').click();
		await expect(page.locator('[data-testid="play"]')).toBeVisible();
		const log = await page.evaluate(() => window.kyty.getLog());
		expect(log.some((line) => line.text.includes('Kyty fake emulator starting'))).toBe(true);
		expect(log[log.length - 1]?.text).toMatch(/Emulator (exited|stopped)/);
	} finally {
		await app.close();
		fixture.cleanup();
	}
});

test('asks for the GTA V recommended settings', async () => {
	const fixture = createFixture();
	fs.writeFileSync(
		fixture.settingsFile,
		[
			'[GameConfigurations]',
			`1\\game_path=${path.join(fixture.gamesDir, 'GTA V')}`,
			'1\\tessellation_enabled=false',
			'1\\readback_linear_images=true',
			'1\\present_mode=Mailbox',
			'size=1',
			'',
			'[Launcher]',
			`game_dirs=${fixture.gamesDir}`,
			'',
			'[ElectronLauncher]',
			'ui_sounds=false',
			'minimize_on_launch=false',
			'last_selected_game=' + path.join(fixture.gamesDir, 'GTA V'),
			'',
		].join('\n'),
	);
	const { app, page } = await launchApp(fixture);
	try {
		await expect(page.locator('.hero-title')).toHaveText('Grand Theft Auto V');
		await page.locator('[data-testid="play"]').click();
		await expect(page.locator('.modal-header h2')).toHaveText('Recommended settings');
		await expect(page.locator('.dialog-message')).toContainText('Tessellation support (trunks of nearby trees)');
		await page.getByRole('button', { name: 'Launch with recommended settings' }).click();
		await expect.poll(() => launches(fixture.argvFile).length).toBe(1);
		const args = launches(fixture.argvFile)[0]!;
		expect(args).toContain('--tessellation');
		expect(args).not.toContain('--no-tessellation');
		// The choice applies to this launch only.
		expect(fs.readFileSync(fixture.settingsFile, 'utf8')).toContain('1\\tessellation_enabled=false');
		await page.evaluate(() => window.kyty.stopGame());
	} finally {
		await app.close();
		fixture.cleanup();
	}
});

test('saves global and per-game settings to Kyty.ini', async () => {
	const fixture = createFixture();
	fs.appendFileSync(fixture.settingsFile, '\n[MainDialog]\ngeometry=@ByteArray(\\x1\\xd9\\xd0\\xcb)\n');
	const { app, page } = await launchApp(fixture);
	try {
		await installFakeGamepad(page);
		await page.locator('[data-testid="open-settings"]').click();
		await page.locator('[data-testid="setting-user-name"]').click();
		await page.locator('.osk-input').fill('Player, One');
		await press(page, 'options');
		await expect(page.locator('[data-testid="setting-user-name"]')).toContainText('Player, One');
		await press(page, 'options');
		await expect(page.locator('.toast')).toContainText('Settings saved.');
		const ini = fs.readFileSync(fixture.settingsFile, 'utf8');
		expect(ini).toContain('user_name="Player, One"');
		expect(ini).toContain('geometry=@ByteArray(\\x1\\xd9\\xd0\\xcb)');
		expect(ini).toContain('[GlobalConfiguration]');

		// Game settings for the selected game create a full game config.
		await page.locator('.settings-header [aria-label="Back"]').click();
		await press(page, 'triangle');
		await page.locator('.settings-nav-item[data-section="graphics"]').click();
		await page.getByText('Present mode').click();
		await page.locator('.pick-item', { hasText: 'Immediate' }).click();
		await page.locator('[data-testid="settings-save"]').click();
		await expect(page.locator('.toast').last()).toContainText('Game config saved.');
		const saved = fs.readFileSync(fixture.settingsFile, 'utf8');
		expect(saved).toContain('1\\present_mode=Immediate');
		expect(saved).toContain('1\\custom_settings=true');
		expect(saved).toContain(`1\\game_path=${path.join(fixture.gamesDir, 'Crimson Harbor')}`);
		expect(saved).toContain('size=1');
	} finally {
		await app.close();
		fixture.cleanup();
	}
});

test('toggles full screen with the controller and remembers it', async () => {
	const fixture = createFixture();
	const { app, page } = await launchApp(fixture);
	try {
		await installFakeGamepad(page);
		await press(page, 'create');
		await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isFullScreen())).toBe(true);
		await expect.poll(() => fs.readFileSync(fixture.settingsFile, 'utf8')).toContain('fullscreen=true');
		await press(page, 'create');
		await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isFullScreen())).toBe(false);
		await expect.poll(() => fs.readFileSync(fixture.settingsFile, 'utf8')).toContain('fullscreen=false');
	} finally {
		await app.close();
		fixture.cleanup();
	}
});

test('starts in full screen with --fullscreen', async () => {
	const fixture = createFixture();
	const { app } = await launchApp(fixture, ['--fullscreen']);
	try {
		await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isFullScreen())).toBe(true);
	} finally {
		await app.close();
		fixture.cleanup();
	}
});

test('previews the lightbar color through the controller helper', async () => {
	const fixture = createFixture();
	const { app, page } = await launchApp(fixture);
	try {
		await page.locator('[data-testid="open-settings"]').click();
		await page.locator('.settings-nav-item[data-section="controller"]').click();
		await page.getByText('DualSense lightbar').click();
		await page.locator('.color-swatch').nth(6).click();
		await expect.poll(() => (fs.existsSync(fixture.controllerLog) ? fs.readFileSync(fixture.controllerLog, 'utf8') : '')).toContain('led #ff2d2d');
		await page.getByRole('button', { name: 'Use color' }).click();
		await page.locator('[data-testid="settings-save"]').click();
		await expect.poll(() => fs.readFileSync(fixture.settingsFile, 'utf8')).toContain('controller_color=#ff2d2d');
	} finally {
		await app.close();
		fixture.cleanup();
	}
});

test('maps keys to DualSense controls', async () => {
	const fixture = createFixture();
	const { app, page } = await launchApp(fixture);
	try {
		await page.locator('[data-testid="open-settings"]').click();
		await page.locator('.settings-nav-item[data-section="input"]').click();
		await page.locator('.row[data-control="Cross"]').click();
		await expect(page.locator('.capture-area')).toBeVisible();
		await page.waitForTimeout(250);
		await page.keyboard.press('KeyW');
		await expect(page.locator('.row[data-control="Cross"] .keycap')).toHaveText('W');
		await expect(page.locator('.row[data-control="LeftStickUp"] .keycap')).toHaveText('None');
		await page.locator('[data-testid="settings-save"]').click();
		await expect.poll(() => fs.readFileSync(fixture.settingsFile, 'utf8')).toContain('"Cross=W"');
		const ini = fs.readFileSync(fixture.settingsFile, 'utf8');
		expect(ini).not.toContain('LeftStickUp=');
	} finally {
		await app.close();
		fixture.cleanup();
	}
});
