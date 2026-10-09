// Port of Configuration::GameSettings, ReadGameSettingsValues and SetGameSettings
// (src/launcher/src/configuration.cpp). Reading keeps Qt's behaviour for missing keys, which is
// not always the default value: Kyty.ini must give the same launch arguments in both launchers.
import {
	DEFAULT_CONSOLE_LANGUAGE,
	DEFAULT_USER_ID,
	LOG_DIRECTIONS,
	MAX_CONSOLE_LANGUAGE,
	MAX_USER_NAME_BYTES,
	PRESENT_MODES,
	RESOLUTIONS,
	SHADER_OPTIMIZATION_TYPES,
	gameSettingKeys,
	isUserIdValid,
	utf8Length,
	type EmulatorSettings,
	type Platform,
} from '../../shared/settings';
import { toQBool, toQEnum, toQInt, toQString, toQStringList, type Raw } from './qtValues';

export type Getter = (key: string) => Raw;

// Configuration::ReadGameSettingsValues. `base` holds the values used where Qt passes the current
// member as the default.
export function readGameSettings(get: Getter, base: EmulatorSettings, platform: Platform): EmulatorSettings {
	const s = { ...base, host_input_mapping: [...base.host_input_mapping] };
	const str = (key: string, fallback: string) => {
		const value = get(key);
		return value === undefined ? fallback : toQString(value);
	};
	const bool = (key: string, fallback: boolean) => {
		const value = get(key);
		return value === undefined ? fallback : toQBool(value);
	};
	const int = (key: string, fallback: number) => {
		const value = get(key);
		return value === undefined ? { ok: true, value: fallback } : toQInt(value);
	};

	s.screen_resolution = toQEnum(get('screen_resolution'), RESOLUTIONS) ?? RESOLUTIONS[0];
	s.user_name = str('user_name', s.user_name);
	const userId = int('user_id', s.user_id);
	s.user_id = userId.ok && isUserIdValid(userId.value) ? userId.value : DEFAULT_USER_ID;
	s.audio_input_device = str('audio_input_device', s.audio_input_device);
	s.present_mode = toQEnum(get('present_mode'), PRESENT_MODES) ?? 'Mailbox';
	s.gpu_index = int('gpu_index', -1).value;
	s.fullscreen_enabled = bool('fullscreen_enabled', false);
	s.hide_cursor_enabled = bool('hide_cursor_enabled', false);
	s.readback_linear_images = bool('readback_linear_images', false);
	s.sync_raw_image_buffers = bool('sync_raw_image_buffers', false);
	s.tessellation_enabled = bool('tessellation_enabled', false);
	s.async_pipelines_enabled = bool('async_pipelines_enabled', true);
	s.trophy_enabled = bool('trophy_enabled', s.trophy_enabled);
	s.skip_notice_screen = bool('skip_notice_screen', false);
	s.vblank_frequency = int('vblank_frequency', s.vblank_frequency).value;
	s.console_language = int('console_language', s.console_language).value;
	if (s.console_language < 0 || s.console_language > MAX_CONSOLE_LANGUAGE) {
		s.console_language = DEFAULT_CONSOLE_LANGUAGE;
	}
	s.vulkan_validation_enabled = bool('vulkan_validation_enabled', false);
	s.shader_validation_enabled = bool('shader_validation_enabled', false);
	s.shader_optimization_type = toQEnum(get('shader_optimization_type'), SHADER_OPTIMIZATION_TYPES) ?? 'None';
	s.shader_log_direction = toQEnum(get('shader_log_direction'), LOG_DIRECTIONS) ?? 'Silent';
	s.shader_log_folder = str('shader_log_folder', '');
	s.command_buffer_dump_enabled = bool('command_buffer_dump_enabled', false);
	s.command_buffer_dump_folder = str('command_buffer_dump_folder', '');
	s.printf_direction = toQEnum(get('printf_direction'), LOG_DIRECTIONS) ?? 'Silent';
	s.printf_output_file = str('printf_output_file', '');
	s.profiler_enabled = bool('profiler_enabled', false);
	s.renderdoc_enabled = bool('renderdoc_enabled', false);
	s.amd_cpu_enabled = bool('amd_cpu_enabled', false);
	if (platform === 'win32') {
		s.red_zone_protection_enabled = bool('red_zone_protection_enabled', s.red_zone_protection_enabled);
	}
	s.elf = str('elf', s.elf);
	return s;
}

export function readInputMapping(get: Getter, fallback: string[]): string[] {
	const value = get('host_input_mapping');
	return value === undefined ? [...fallback] : toQStringList(value);
}

// Configuration::GameSettings(): every value as the string Qt stores.
export function gameSettingsMap(s: EmulatorSettings, platform: Platform): Record<string, string> {
	const out: Record<string, string> = {};
	for (const key of gameSettingKeys(platform)) {
		const value = s[key as keyof EmulatorSettings];
		out[key] = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);
	}
	return out;
}

// Configuration::SetGameSettings: validates imported string values against a configuration.
export function applyGameSettings(
	base: EmulatorSettings,
	settings: Record<string, unknown>,
	platform: Platform,
): { ok: true; settings: EmulatorSettings } | { ok: false; error: string } {
	const values = gameSettingsMap(base, platform);
	for (const [key, value] of Object.entries(settings)) {
		if (!(key in values)) {
			return { ok: false, error: `Unknown game setting: ${key}` };
		}
		if (typeof value !== 'string') {
			return { ok: false, error: `Game setting ${key} must be a string.` };
		}
		values[key] = value;
	}
	const result = readGameSettings((key) => values[key], base, platform);
	const canonical = gameSettingsMap(result, platform);
	for (const key of Object.keys(settings)) {
		if (canonical[key] !== values[key]) {
			return { ok: false, error: `Invalid value for game setting: ${key}` };
		}
	}
	if (result.user_name.trim().length === 0 || utf8Length(result.user_name) > MAX_USER_NAME_BYTES) {
		return { ok: false, error: 'User name must contain 1-16 UTF-8 bytes.' };
	}
	if (result.gpu_index < -1) {
		return { ok: false, error: 'GPU index must be -1 or greater.' };
	}
	if (result.vblank_frequency < 30 || result.vblank_frequency > 360) {
		return { ok: false, error: 'Vblank frequency must be between 30 and 360.' };
	}
	if (
		(result.shader_log_direction === 'File' && result.shader_log_folder.length === 0) ||
		(result.printf_direction === 'File' && result.printf_output_file.length === 0) ||
		(result.command_buffer_dump_enabled && result.command_buffer_dump_folder.length === 0)
	) {
		return { ok: false, error: 'Enabled logging and command buffer dumps require an output path.' };
	}
	return { ok: true, settings: result };
}

