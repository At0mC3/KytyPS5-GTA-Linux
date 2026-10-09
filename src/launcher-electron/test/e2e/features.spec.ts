import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createFixture } from '../fixture';
import { launchApp } from './app';

const CHEAT = {
	id: 'PPSA04263',
	version: '01.010.002',
	process: 'eboot.bin',
	name: 'GTA V cheats',
	credits: ['Fixture'],
	mods: [
		{ name: 'Infinite Ammo', memory: [{ offset: '0x1000', on: '9090', off: '0F0B' }] },
		{ name: 'Max Money', memory: [{ offset: '0x2000', on: '01', off: '00' }] },
	],
};

async function cheatServer(): Promise<{ url: string; close: () => void }> {
	const server = http.createServer((request, response) => {
		const routes: Record<string, string> = {
			'/cheats/json.txt': 'PPSA04263_01.010.002_gta.json=GTA V cheats\nPPSA04263_01.000.000_old.json=Old cheats\n',
			'/cheats/mc4.txt': 'PPSA04263_01.010.002_gta.mc4=MC4 cheats\n',
			'/cheats/shn.txt': '',
			'/cheats/json/PPSA04263_01.010.002_gta.json': JSON.stringify(CHEAT),
			'/cheats/json/PPSA04263_01.000.000_old.json': JSON.stringify({ ...CHEAT, version: '01.000.000' }),
		};
		const body = routes[request.url ?? ''];
		response.writeHead(body === undefined ? 404 : 200, { 'Content-Type': 'text/plain' });
		response.end(body ?? 'not found');
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;
	return { url: `http://127.0.0.1:${port}/cheats/`, close: () => server.close() };
}

test('imports remote cheats and saves a selection', async () => {
	const server = await cheatServer();
	const fixture = createFixture();
	fixture.env.KYTY_CHEATS_BASE_URL = server.url;
	fs.appendFileSync(fixture.settingsFile, `[ElectronLauncher]\nlast_selected_game=${path.join(fixture.gamesDir, 'GTA V')}\n`);
	const { app, page } = await launchApp(fixture);
	try {
		await expect(page.locator('.hero-title')).toHaveText('Grand Theft Auto V');
		await page.locator('.card', { hasText: 'Cheats' }).click();
		await expect(page.locator('.cheats-status')).toContainText('No local cheat file');
		await page.locator('.tab', { hasText: 'Remote' }).click();
		await expect(page.locator('.cheat-file')).toHaveCount(3);
		await expect(page.locator('.cheat-file').first()).toContainText('01.010.002 (installed)');
		await expect(page.locator('.cheat-file', { hasText: 'MC4' })).toBeDisabled();
		await page.locator('.cheat-file').first().click();
		await expect(page.locator('.cheat-mods li')).toHaveCount(2);
		await page.getByRole('button', { name: 'Import to Local' }).click();
		await expect(page.locator('.cheats-body .row')).toHaveCount(2);
		const file = path.join(fixture.emulatorDir, '_Patches', 'PPSA04263.json');
		expect(JSON.parse(fs.readFileSync(file, 'utf8')).mods.map((mod: { enabled: boolean }) => mod.enabled)).toEqual([false, false]);
		await page.locator('.cheats-body .row').first().click();
		await page.getByRole('button', { name: 'Apply selection' }).click();
		await expect(page.locator('.cheats-status')).toContainText('Cheat selection saved');
		expect(JSON.parse(fs.readFileSync(file, 'utf8')).mods.map((mod: { enabled: boolean }) => mod.enabled)).toEqual([true, false]);

		// The cheat file is passed to the emulator.
		await page.evaluate(async () => {
			const games = await window.kyty.getLibrary();
			await window.kyty.launch(games.find((game) => game.titleId === 'PPSA04263')!.id);
		});
		await expect.poll(() => (fs.existsSync(fixture.argvFile) ? fs.readFileSync(fixture.argvFile, 'utf8') : '')).toContain('--game-patch');
		await page.evaluate(() => window.kyty.stopGame());
	} finally {
		await app.close();
		fixture.cleanup();
		server.close();
	}
});

test('exports and imports game configs', async () => {
	const fixture = createFixture();
	const { app, page } = await launchApp(fixture);
	try {
		const exported = path.join(fixture.root, 'PPSA01003.json');
		const result = await page.evaluate(async (file) => {
			const games = await window.kyty.getLibrary();
			const game = games.find((item) => item.titleId === 'PPSA01003')!;
			const view = await window.kyty.getGameSettings(game.id);
			await window.kyty.saveGameSettings(game.id, { ...view.settings, vblank_frequency: 120 });
			const targets = await window.kyty.exportTargets();
			return { targets: targets.map((target) => target.titleId), export: await window.kyty.exportGameConfig(game.id, file, false) };
		}, exported);
		expect(result.targets).toEqual(['PPSA01003']);
		expect(result.export.ok).toBe(true);
		const json = JSON.parse(fs.readFileSync(exported, 'utf8'));
		expect(json.PPSA01003.vblank_frequency).toBe('120');
		expect(json.PPSA01003.elf).toBe('eboot.bin');

		const toImport = path.join(fixture.root, 'import.json');
		fs.writeFileSync(toImport, JSON.stringify({ PPSA01001: { present_mode: 'Fifo', vblank_frequency: '144' }, PPSA77777: { user_id: '7' } }));
		const preview = await page.evaluate((file) => window.kyty.previewImport(file), toImport);
		expect(preview.matched.map((item) => item.titleId)).toEqual(['PPSA01001']);
		expect(preview.unmatched).toEqual(['PPSA77777']);
		expect((await page.evaluate((token) => window.kyty.applyImport(token), preview.token!)).ok).toBe(true);
		const ini = fs.readFileSync(fixture.settingsFile, 'utf8');
		expect(ini).toContain('vblank_frequency=144');
		expect(ini).toContain('size=2');

		fs.writeFileSync(toImport, JSON.stringify({ PPSA01001: { vblank_frequency: '999' } }));
		const invalid = await page.evaluate((file) => window.kyty.previewImport(file), toImport);
		expect(invalid.error).toContain('Vblank frequency must be between 30 and 360.');
	} finally {
		await app.close();
		fixture.cleanup();
	}
});

test('removes save data after confirmation', async () => {
	const fixture = createFixture();
	const saveDir = path.join(fixture.emulatorDir, '_SaveData', 'PPSA01003');
	fs.mkdirSync(saveDir, { recursive: true });
	fs.writeFileSync(path.join(saveDir, 'save.dat'), 'save');
	const { app, page } = await launchApp(fixture);
	try {
		await page.locator('[data-testid="game-options"]').click();
		await page.locator('.menu-item', { hasText: 'Remove save data' }).click();
		await expect(page.locator('.path-list li')).toHaveText(saveDir);
		await page.getByRole('button', { name: 'Delete' }).click();
		await expect(page.locator('.toast')).toContainText('Save data removed.');
		expect(fs.existsSync(saveDir)).toBe(false);
	} finally {
		await app.close();
		fixture.cleanup();
	}
});

test('edits compatibility with --local', async () => {
	const fixture = createFixture();
	const { app, page } = await launchApp(fixture, ['--local']);
	try {
		await page.locator('.card', { hasText: 'Compatibility' }).click();
		await page.locator('.menu-item', { hasText: 'Change status' }).click();
		await page.locator('.pick-item', { hasText: 'In game' }).click();
		await expect(page.locator('.status-pill')).toHaveText('In game');
		const db = JSON.parse(fs.readFileSync(path.join(fixture.root, 'compatibility_db.json'), 'utf8'));
		expect(db.PPSA01003.status).toBe('InGame');
	} finally {
		await app.close();
		fixture.cleanup();
	}
});

// Runs against a built emulator when KYTY_REAL_EMULATOR points to one.
test('reads devices from the real emulator', async () => {
	const real = process.env.KYTY_REAL_EMULATOR;
	test.skip(real === undefined || !fs.existsSync(real), 'KYTY_REAL_EMULATOR is not set');
	const fixture = createFixture();
	fixture.env.KYTY_EMULATOR = real!;
	const { app, page } = await launchApp(fixture);
	try {
		const state = await page.evaluate(() => window.kyty.getState());
		expect(state.emulator.queryAvailable).toBe(true);
		expect(state.emulator.version).toMatch(/ver = /);
		console.log(`GPUs: ${JSON.stringify(state.emulator.gpus)} ${state.emulator.gpuError ?? ''}`);
		console.log(`Microphones: ${JSON.stringify(state.emulator.microphones)}`);
		await page.locator('[data-testid="open-settings"]').click();
		await page.locator('.settings-nav-item[data-section="graphics"]').click();
		await page.getByText('GPU', { exact: true }).click();
		await expect(page.locator('.pick-item').first()).toHaveText('Auto');
	} finally {
		await app.close();
		fixture.cleanup();
	}
});

test('adds the first game folder with the folder browser', async () => {
	const fixture = createFixture();
	fs.writeFileSync(fixture.settingsFile, '[ElectronLauncher]\nui_sounds=false\n');
	fixture.env.HOME = fixture.root;
	const { app, page } = await launchApp(fixture);
	try {
		await expect(page.locator('.hero-title')).toHaveText('Add your games');
		await page.getByRole('button', { name: 'Add game folder' }).click();
		await expect(page.locator('.modal-subtitle')).toHaveText(fixture.root);
		await page.locator('.browser-entry', { hasText: 'Games' }).click();
		await expect(page.locator('.modal-subtitle')).toHaveText(fixture.gamesDir);
		await page.getByRole('button', { name: 'Add this folder' }).click();
		await expect(page.locator('.tile')).toHaveCount(8);
		expect(fs.readFileSync(fixture.settingsFile, 'utf8')).toContain(`game_dirs=${fixture.gamesDir}`);
	} finally {
		await app.close();
		fixture.cleanup();
	}
});
