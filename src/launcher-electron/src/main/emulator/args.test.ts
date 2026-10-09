import { describe, expect, it } from 'vitest';
import { defaultControllerSettings, defaultEmulatorSettings } from '../../shared/settings';
import { buildEmulatorArgs, missingRecommendedSettings, withRecommendedSettings } from './args';

describe('buildEmulatorArgs', () => {
	it('matches the Qt launcher for default settings', () => {
		const args = buildEmulatorArgs(
			{ settings: defaultEmulatorSettings(), controller: defaultControllerSettings(), basedir: '/games/GTA V' },
			'linux',
		);
		expect(args).toEqual([
			'--screen-width', '1280', '--screen-height', '720',
			'--user-name', 'Kyty', '--user-id', '1000',
			'--controller-volume', '50', '--controller-vibration', '100',
			'--present-mode', 'Mailbox',
			'--readback-linear-images', 'true',
			'--sync-raw-image-buffers', 'false',
			'--trophy-notifications', 'true',
			'--skip-notice-screen', 'false',
			'--tessellation', '--async-pipelines',
			'--vblank-frequency', '60', '--console-language', '1',
			'--vulkan-validation', 'false', '--shader-validation', 'false',
			'--shader-optimization-type', 'Performance',
			'--shader-log-direction', 'Silent', '--shader-log-folder', '_Shaders',
			'--command-buffer-dump', 'false', '--command-buffer-dump-folder', '_Buffers',
			'--printf-direction', 'Silent', '--printf-output-file', '_kyty.txt',
			'--spirv-debug-printf', 'false',
			'--game', '/games/GTA V/eboot.bin',
		]);
	});

	it('adds optional flags in Qt order', () => {
		const settings = {
			...defaultEmulatorSettings(),
			screen_resolution: 'R3840X2160' as const,
			audio_input_device: 'USB Mic',
			gpu_index: 1,
			fullscreen_enabled: true,
			hide_cursor_enabled: true,
			tessellation_enabled: false,
			async_pipelines_enabled: false,
			profiler_enabled: true,
			amd_cpu_enabled: true,
			renderdoc_enabled: true,
			red_zone_protection_enabled: false,
			host_input_mapping: ['Cross=J', 'MouseSensitivity=1.5'],
		};
		const controller = { color: '#ff0000', speaker_volume: 10, vibration_intensity: 20 };
		const args = buildEmulatorArgs({ settings, controller, basedir: 'C:/Games/GTA.zar' }, 'win32', 'C:/Kyty/_Patches/PPSA04263.json');
		const joined = args.join(' ');
		expect(joined).toContain('--screen-width 3840 --screen-height 2160');
		expect(joined).toContain('--mic USB Mic --controller-color #ff0000 --controller-volume 10 --controller-vibration 20');
		expect(joined).toContain('--present-mode Mailbox --gpu 1 --fullscreen --hide-cursor');
		expect(joined).toContain('--no-tessellation --no-async-pipelines');
		expect(joined).toContain('--profile --spirv-debug-printf false --amd-cpu --no-redzone');
		expect(joined).toContain('--keymap Cross=J --keymap MouseSensitivity=1.5 --rd');
		expect(args.slice(-4)).toEqual(['--game', 'C:/Games/GTA.zar', '--game-patch', 'C:/Kyty/_Patches/PPSA04263.json']);
	});

	it('passes the folder when elf is empty', () => {
		const settings = { ...defaultEmulatorSettings(), elf: '' };
		const args = buildEmulatorArgs({ settings, controller: defaultControllerSettings(), basedir: '/g' }, 'linux');
		expect(args.slice(-2)).toEqual(['--game', '/g']);
	});
});

describe('GTA V recommended settings', () => {
	it('lists only missing settings for PPSA04263', () => {
		const settings = { ...defaultEmulatorSettings(), tessellation_enabled: false, red_zone_protection_enabled: false };
		expect(missingRecommendedSettings('PPSA01234', settings, 'linux')).toEqual([]);
		expect(missingRecommendedSettings('PPSA04263', settings, 'linux')).toEqual(['Tessellation support (trunks of nearby trees)']);
		expect(missingRecommendedSettings('PPSA04263', settings, 'win32')).toHaveLength(2);
		const fixed = withRecommendedSettings(settings, 'win32');
		expect(missingRecommendedSettings('PPSA04263', fixed, 'win32')).toEqual([]);
	});
});
