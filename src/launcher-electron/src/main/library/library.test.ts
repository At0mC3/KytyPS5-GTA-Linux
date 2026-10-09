import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Platform } from '../../shared/settings';
import { firmwareVersion, parseParamJson } from './paramJson';
import { normalizeGameDirectories, qtCleanPath } from './paths';
import { gameSize, scanGameFolders } from './scanner';

describe('parseParamJson', () => {
	it('prefers the default language, then en-US, then any title', () => {
		const param = {
			titleId: ' PPSA04263 ',
			appVersion: '01.000.000',
			requiredSystemSoftwareVersion: '0x0510000000000000',
			localizedParameters: { defaultLanguage: 'fr-FR', 'fr-FR': { titleName: 'Jeu' }, 'en-US': { titleName: 'Game' } },
		};
		expect(parseParamJson(JSON.stringify(param), 'folder')).toEqual({
			title: 'Jeu',
			titleId: 'PPSA04263',
			gameVersion: '01.000.000',
			firmwareVersion: '5.10',
		});
		param.localizedParameters['fr-FR'].titleName = '';
		expect(parseParamJson(JSON.stringify(param), 'folder').title).toBe('Game');
		const sorted = { localizedParameters: { 'zh-CN': { titleName: 'Z' }, 'de-DE': { titleName: 'D' } } };
		expect(parseParamJson(JSON.stringify(sorted), 'folder').title).toBe('D');
	});

	it('falls back on bad input', () => {
		expect(parseParamJson('{', 'Folder').title).toBe('Folder');
		expect(parseParamJson(undefined, 'Folder').title).toBe('Folder');
		expect(parseParamJson('{"contentVersion":"02.00"}', 'F').gameVersion).toBe('02.00');
	});

	it('formats firmware versions', () => {
		expect(firmwareVersion('0x0750010000000000')).toBe('7.50.01');
		expect(firmwareVersion('0x1000000000000000')).toBe('10.00');
		expect(firmwareVersion('bad')).toBe('');
	});
});

describe('paths', () => {
	it('normalizes like QDir::cleanPath(absolutePath)', () => {
		expect(qtCleanPath('/a/b/../c/', 'linux')).toBe('/a/c');
		expect(qtCleanPath('  ', 'linux')).toBe('');
		expect(qtCleanPath('c:\\Games\\X\\', 'win32')).toBe('C:/Games/X');
		expect(qtCleanPath('D:\\', 'win32')).toBe('D:/');
	});
});

describe('scanGameFolders', () => {
	const platform = process.platform as Platform;
	const rel = (from: string, to: string) => path.relative(from, to).split(path.sep).join('/');
	let root: string;

	const touch = (rel: string) => {
		const full = path.join(root, rel);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, 'x');
	};

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'kyty-scan-'));
	});

	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	it('finds folder games breadth-first and archives in any scanned folder', () => {
		touch('eboot.bin');
		touch('b/Game B/eboot.bin');
		touch('b/Game B/nested/eboot.bin');
		touch('A/eboot.bin');
		touch('one.zar');
		touch('deep/inner/two.ZAR');
		touch('.hidden/eboot.bin');
		touch('notes.txt');
		const games = scanGameFolders([root], platform);
		expect(games.map((game) => rel(root, game.basedir))).toEqual(['one.zar', 'A', 'b/Game B', 'deep/inner/two.ZAR']);
		expect(games[0]).toMatchObject({ archive: true, fallbackTitle: 'one', legacyGamePath: 'one.zar' });
		expect(games[2]).toMatchObject({ archive: false, fallbackTitle: 'Game B', legacyGamePath: 'b/Game B' });
	});

	it('skips duplicate folders and archives without eboot.bin', () => {
		touch('G/eboot.bin');
		touch('bad.zar');
		const games = scanGameFolders([root, path.join(root, '.')], platform, (archive) => !archive.endsWith('bad.zar'));
		expect(games).toHaveLength(1);
		expect(normalizeGameDirectories([root, `${root}/`, ''], platform)).toEqual([qtCleanPath(root, platform)]);
	});

	it('computes sizes', async () => {
		touch('G/eboot.bin');
		touch('G/sub/data.bin');
		expect(await gameSize(path.join(root, 'G'), false)).toBe(2);
	});
});
