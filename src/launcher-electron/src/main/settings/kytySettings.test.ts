import { describe, expect, it } from 'vitest';
import { defaultEmulatorSettings } from '../../shared/settings';
import { applyGameSettings, gameSettingsMap } from './gameSettings';
import { readKytySettings, writeGameConfigs, writeGlobal } from './kytySettings';
import { IniDocument } from './qsettingsIni';

describe('readKytySettings', () => {
	it('uses defaults for a missing file', () => {
		const settings = readKytySettings(IniDocument.parse(''), 'linux');
		expect(settings.global).toEqual(defaultEmulatorSettings());
		expect(settings.gameDirs).toEqual([]);
		expect(settings.checkUpdatesOnStartup).toBe(true);
		expect(settings.controller).toEqual({ color: '', speaker_volume: 50, vibration_intensity: 100 });
	});

	it("reads missing keys the way Qt's KYTY_CFG_GET does", () => {
		const settings = readKytySettings(IniDocument.parse('[GlobalConfiguration]\nuser_name=Neo\n'), 'linux');
		expect(settings.global.user_name).toBe('Neo');
		expect(settings.global.present_mode).toBe('Fifo');
		expect(settings.global.readback_linear_images).toBe(false);
		expect(settings.global.tessellation_enabled).toBe(false);
		expect(settings.global.async_pipelines_enabled).toBe(true);
		expect(settings.global.trophy_enabled).toBe(true);
		expect(settings.global.shader_optimization_type).toBe('None');
		expect(settings.global.shader_log_folder).toBe('');
		expect(settings.global.elf).toBe('eboot.bin');
		expect(settings.global.vblank_frequency).toBe(60);
		expect(settings.global.gpu_index).toBe(-1);
	});

	it('validates user id, language and colors', () => {
		const doc = IniDocument.parse(
			'[GlobalConfiguration]\nuser_id=255\nconsole_language=40\ncontroller_color=#ABC\ncontroller_speaker_volume=150\n',
		);
		const settings = readKytySettings(doc, 'linux');
		expect(settings.global.user_id).toBe(1000);
		expect(settings.global.console_language).toBe(1);
		expect(settings.controller.color).toBe('#aabbcc');
		expect(settings.controller.speaker_volume).toBe(100);
	});

	it('reads game folders, legacy game_dir and per-game configs', () => {
		const doc = IniDocument.parse(
			[
				'[Launcher]',
				'game_dir=/old',
				'[GameConfigurations]',
				'1\\game_path=/games/A',
				'1\\present_mode=Immediate',
				'2\\game_path=',
				'size=2',
			].join('\n'),
		);
		const settings = readKytySettings(doc, 'linux');
		expect(settings.gameDirs).toEqual(['/old']);
		expect(settings.gameConfigs).toHaveLength(1);
		expect(settings.gameConfigs[0]!.present_mode).toBe('Immediate');
		expect(settings.gameConfigs[0]!.readback_linear_images).toBe(false);
	});

	it('reads red zone protection only on Windows', () => {
		const doc = IniDocument.parse('[GlobalConfiguration]\nred_zone_protection_enabled=false\n');
		expect(readKytySettings(doc, 'win32').global.red_zone_protection_enabled).toBe(false);
		expect(readKytySettings(doc, 'linux').global.red_zone_protection_enabled).toBe(true);
	});
});

describe('writing', () => {
	it('round-trips global and per-game settings', () => {
		const doc = IniDocument.parse('');
		const global = { ...defaultEmulatorSettings(), user_name: 'A, B', host_input_mapping: ['Cross=J'] };
		writeGlobal(doc, global, { name: '', basedir: '', game_path: '' }, { color: '#112233', speaker_volume: 20, vibration_intensity: 80 }, 'linux');
		const game = { ...defaultEmulatorSettings(), present_mode: 'Fifo' as const, name: 'Game', basedir: '/g', game_path: '/g' };
		writeGameConfigs(doc, [game], 'linux');
		const text = doc.serialize();
		expect(text).toContain('user_name="A, B"');
		expect(text).toContain('custom_settings=false');
		expect(text).toContain('1\\custom_settings=true');
		expect(text).toContain('size=1');

		const settings = readKytySettings(IniDocument.parse(text), 'linux');
		expect(settings.global).toEqual(global);
		expect(settings.controller).toEqual({ color: '#112233', speaker_volume: 20, vibration_intensity: 80 });
		expect(settings.gameConfigs[0]).toEqual(game);
	});
});

describe('applyGameSettings', () => {
	const base = defaultEmulatorSettings();

	it('accepts canonical values', () => {
		const result = applyGameSettings(base, { screen_resolution: 'R1920X1080', user_id: '42', tessellation_enabled: 'false' }, 'linux');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.settings.screen_resolution).toBe('R1920X1080');
			expect(result.settings.user_id).toBe(42);
			expect(result.settings.tessellation_enabled).toBe(false);
		}
	});

	it('rejects unknown keys, non-strings and non-canonical values', () => {
		expect(applyGameSettings(base, { nope: 'x' }, 'linux')).toEqual({ ok: false, error: 'Unknown game setting: nope' });
		expect(applyGameSettings(base, { user_id: 5 }, 'linux')).toEqual({ ok: false, error: 'Game setting user_id must be a string.' });
		expect(applyGameSettings(base, { fullscreen_enabled: 'True' }, 'linux').ok).toBe(false);
		expect(applyGameSettings(base, { user_id: '01000' }, 'linux').ok).toBe(false);
		expect(applyGameSettings(base, { red_zone_protection_enabled: 'true' }, 'linux').ok).toBe(false);
		expect(applyGameSettings(base, { red_zone_protection_enabled: 'true' }, 'win32').ok).toBe(true);
	});

	it('checks ranges and output paths', () => {
		expect(applyGameSettings(base, { vblank_frequency: '20' }, 'linux').ok).toBe(false);
		expect(applyGameSettings(base, { printf_direction: 'File', printf_output_file: '' }, 'linux').ok).toBe(false);
		expect(applyGameSettings(base, { user_name: '12345678901234567' }, 'linux').ok).toBe(false);
	});

	it('exports every setting as a string', () => {
		const map = gameSettingsMap(base, 'linux');
		expect(Object.keys(map)).toHaveLength(29);
		expect(map.screen_resolution).toBe('R1280X720');
		expect(map.elf).toBe('eboot.bin');
		expect(map.async_pipelines_enabled).toBe('true');
	});
});
