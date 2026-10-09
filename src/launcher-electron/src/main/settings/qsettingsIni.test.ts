import { describe, expect, it } from 'vitest';
import { IniDocument, decodeValue, encodeValue, escapeKey, unescapeKey } from './qsettingsIni';

describe('QSettings value encoding', () => {
	it('writes plain strings unquoted', () => {
		expect(encodeValue('eboot.bin')).toBe('eboot.bin');
		expect(encodeValue('true')).toBe('true');
		expect(encodeValue('/home/user/Games/GTA V')).toBe('/home/user/Games/GTA V');
	});

	it('quotes values with separators or edge spaces', () => {
		expect(encodeValue('a,b')).toBe('"a,b"');
		expect(encodeValue('Cross=J')).toBe('"Cross=J"');
		expect(encodeValue('x;y')).toBe('"x;y"');
		expect(encodeValue(' lead')).toBe('" lead"');
		expect(encodeValue('trail ')).toBe('"trail "');
	});

	it('escapes backslashes, quotes and control characters', () => {
		expect(encodeValue('C:\\Games')).toBe('C:\\\\Games');
		expect(encodeValue('say "hi"')).toBe('say \\"hi\\"');
		expect(encodeValue('a\nb\tc')).toBe('a\\nb\\tc');
		expect(encodeValue('\x01A')).toBe('\\x1\\x41');
	});

	it('doubles a leading @', () => {
		expect(encodeValue('@home')).toBe('@@home');
		expect(decodeValue('@@home')).toBe('@home');
	});

	it('writes string lists like Qt', () => {
		expect(encodeValue([])).toBe('@Invalid()');
		expect(encodeValue(['/games'])).toBe('/games');
		expect(encodeValue(['Cross=J', 'Circle=L', 'MouseSensitivity=1.5'])).toBe(
			'"Cross=J", "Circle=L", "MouseSensitivity=1.5"',
		);
		expect(encodeValue(['/a', '/b'])).toBe('/a, /b');
	});

	it('keeps non-ASCII text as UTF-8', () => {
		expect(encodeValue('Jörg ゲーム')).toBe('Jörg ゲーム');
		expect(decodeValue('Jörg ゲーム')).toBe('Jörg ゲーム');
	});

	it('round-trips values', () => {
		const values = ['', 'plain', 'a,b', ' x ', 'C:\\x\\y', 'q"q', 'line\nbreak', '@at', 'tab\t', '\x00', 'é,=;'];
		for (const value of values) {
			expect(decodeValue(encodeValue(value))).toBe(value);
		}
		const list = ['Up=Up', 'Cross=J', 'a, b', ' spaced '];
		expect(decodeValue(encodeValue(list))).toEqual(list);
	});

	it('decodes lists, invalid and opaque values', () => {
		expect(decodeValue('/a, /b')).toEqual(['/a', '/b']);
		expect(decodeValue('@Invalid()')).toBeNull();
		expect(decodeValue('@ByteArray(\\x1\\xd9\\xd0)')).toEqual({ opaque: '@ByteArray(\\x1\\xd9\\xd0)' });
		expect(decodeValue('  spaced  ')).toBe('spaced');
		expect(decodeValue('"quoted ", next')).toEqual(['quoted ', 'next']);
	});
});

describe('keys', () => {
	it('escapes and unescapes keys', () => {
		expect(escapeKey('1/game_path')).toBe('1\\game_path');
		expect(unescapeKey('1\\game_path')).toBe('1/game_path');
		expect(escapeKey('a b')).toBe('a%20b');
		expect(unescapeKey('a%20b')).toBe('a b');
	});
});

describe('IniDocument', () => {
	const qtFile = [
		'[GameConfigurations]',
		'1\\basedir=/games/GTA',
		'1\\game_path=/games/GTA',
		'1\\host_input_mapping=@Invalid()',
		'size=1',
		'',
		'[GlobalConfiguration]',
		'user_name=Kyty',
		'host_input_mapping="Cross=J", "Circle=L"',
		'',
		'[Launcher]',
		'game_dirs=/games, /more games',
		'',
		'[MainDialog]',
		'geometry=@ByteArray(\\x1\\xd9\\xd0\\xcb\\0\\x3)',
		'check_updates_on_startup=true',
		'',
	].join('\n');

	it('reads sections, arrays and lists', () => {
		const doc = IniDocument.parse(qtFile);
		expect(doc.get('GameConfigurations', 'size')).toBe('1');
		expect(doc.get('GameConfigurations', '1/game_path')).toBe('/games/GTA');
		expect(doc.get('GlobalConfiguration', 'host_input_mapping')).toEqual(['Cross=J', 'Circle=L']);
		expect(doc.get('Launcher', 'game_dirs')).toEqual(['/games', '/more games']);
		expect(doc.get('Launcher', 'missing')).toBeUndefined();
		expect(doc.childKeys('GameConfigurations')).toEqual(['size']);
	});

	it('keeps entries it does not change byte for byte', () => {
		const doc = IniDocument.parse(qtFile);
		doc.set('MainDialog', 'check_updates_on_startup', 'false');
		doc.set('ElectronLauncher', 'fullscreen', 'true');
		const text = doc.serialize();
		expect(text).toContain('geometry=@ByteArray(\\x1\\xd9\\xd0\\xcb\\0\\x3)');
		expect(text).toContain('check_updates_on_startup=false');
		expect(text).toContain('[ElectronLauncher]\nfullscreen=true\n');
		expect(text.indexOf('[GameConfigurations]')).toBeLessThan(text.indexOf('[ElectronLauncher]'));
		const reparsed = IniDocument.parse(text);
		expect(reparsed.get('GlobalConfiguration', 'host_input_mapping')).toEqual(['Cross=J', 'Circle=L']);
	});

	it('ignores comments and handles continuation lines', () => {
		const doc = IniDocument.parse('[A]\n; comment\nkey=value ; trailing\nquoted="a;b"\nlong=one\\\ntwo\n');
		expect(doc.get('A', 'key')).toBe('value');
		expect(doc.get('A', 'quoted')).toBe('a;b');
		expect(doc.get('A', 'long')).toBe('onetwo');
	});

	it('handles a BOM, CRLF and the General section', () => {
		const doc = IniDocument.parse('\uFEFFtop=1\r\n[S]\r\nk=v\r\n');
		expect(doc.get('General', 'top')).toBe('1');
		expect(doc.get('S', 'k')).toBe('v');
		expect(doc.serialize('\r\n')).toBe('[General]\r\ntop=1\r\n\r\n[S]\r\nk=v\r\n');
	});

	it('sorts keys within a section when writing', () => {
		const doc = IniDocument.parse('[S]\nb=2\na=1\n');
		expect(doc.serialize()).toBe('[S]\na=1\nb=2\n');
	});
});
