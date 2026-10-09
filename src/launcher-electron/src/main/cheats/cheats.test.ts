import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCompat, statusFromText } from '../compat/database';
import { cheatMods, cheatPath, parseCheatDocument, saveCheatDocument, validateImport, withSelection } from './cheatFile';
import { parseCheatIndex, remoteFileUrl, sortCheatFiles } from './repository';

const valid = {
	id: 'PPSA04263',
	version: '01.000.000',
	process: 'eboot.bin',
	name: 'GTA V',
	mods: [{ name: 'Money', memory: [{ offset: '0x1000', on: '9090', off: '0F0B' }] }],
};

describe('cheat files', () => {
	it('validates documents and imports', () => {
		const parsed = parseCheatDocument(JSON.stringify(valid));
		expect(parsed.error).toBe('');
		const document = parsed.document!;
		expect(cheatMods(document)).toEqual([{ name: 'Money', enabled: true }]);
		expect(validateImport(document, 'ppsa04263', '01.000.000', 'EBOOT.BIN')).toBe('');
		expect(validateImport(document, 'PPSA04263', '01.001.000', 'eboot.bin')).toContain('version');
		expect(validateImport(document, 'PPSA00001', '01.000.000', 'eboot.bin')).toContain('title ID');
		const absolute = parseCheatDocument(JSON.stringify({ ...valid, mods: [{ name: 'X', memory: [{ offset: '1', on: '00', off: '11', absolute: true }] }] }));
		expect(validateImport(absolute.document!, 'PPSA04263', '01.000.000', 'eboot.bin')).toContain('addressing');
		const uneven = parseCheatDocument(JSON.stringify({ ...valid, mods: [{ name: 'X', memory: [{ offset: '1', on: '00', off: '1122' }] }] }));
		expect(validateImport(uneven.document!, 'PPSA04263', '01.000.000', 'eboot.bin')).toContain('Unsupported memory');
		expect(parseCheatDocument('{"mods":[{"name":""}]}').error).toBe('Invalid cheat entry.');
		expect(parseCheatDocument('[]').error).toBe('Invalid cheat JSON.');
	});

	it('saves a selection only when the file is unchanged', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kyty-cheats-'));
		const file = cheatPath(dir, 'ppsa04263')!;
		expect(file).toBe(path.join(dir, '_Patches', 'PPSA04263.json'));
		const document = parseCheatDocument(JSON.stringify(valid)).document!;
		expect(saveCheatDocument(file, withSelection(document, [false])!, Buffer.alloc(0))).toBe('');
		const saved = fs.readFileSync(file);
		expect(cheatMods(parseCheatDocument(saved).document!)).toEqual([{ name: 'Money', enabled: false }]);
		expect(saveCheatDocument(file, document, Buffer.from('stale'))).toContain('changed');
		expect(saveCheatDocument(file, document, saved)).toBe('');
		expect(cheatPath(dir, 'CUSA00001')).toBeUndefined();
		fs.rmSync(dir, { recursive: true, force: true });
	});
});

describe('cheat index', () => {
	it('parses entries for one title', () => {
		const index = '﻿PPSA04263_1.00_GTA.json=GTA V\nPPSA04263_1.00_GTA.json=dup\nPPSA00001_1.0_X.json=Other\nbad line\nPPSA04263_1.01_GTA.mc4=wrong format\n';
		const result = parseCheatIndex(index, 'json', ' ppsa04263 ');
		expect(result.files).toEqual([{ name: 'PPSA04263_1.00_GTA.json', title: 'GTA V', version: '1.00', format: 'json', supported: true }]);
		expect(result.error).toBe('Skipped 2 invalid cheat index entries.');
		expect(remoteFileUrl({ name: 'PPSA04263_1.00_GTA.json', format: 'json' })).toMatch(/cheats\/json\/PPSA04263_1\.00_GTA\.json$/);
	});

	it('sorts newest first with the installed version on top', () => {
		const file = (version: string, format: 'json' | 'mc4' = 'json') => ({ name: `PPSA04263_${version}_a.${format}`, title: '', version, format, supported: format === 'json' });
		const sorted = sortCheatFiles([file('1.00'), file('1.02', 'mc4'), file('1.02'), file('1.01')], '1.01');
		expect(sorted.map((item) => `${item.version}.${item.format}`)).toEqual(['1.01.json', '1.02.json', '1.02.mc4', '1.00.json']);
	});
});

describe('compatibility', () => {
	it('parses statuses', () => {
		expect(statusFromText('In game')).toBe('InGame');
		expect(statusFromText("Doesn't boot")).toBe('DoesntBoot');
		expect(statusFromText('weird')).toBe('Unknown');
		const entries = parseCompat('{" ppsa04263 ":{"status":"MainMenu","comment":"ok"},"X":{}}');
		expect(entries.get('PPSA04263')).toEqual({ status: 'MainMenu', comment: 'ok' });
		expect(entries.has('X')).toBe(false);
	});
});
