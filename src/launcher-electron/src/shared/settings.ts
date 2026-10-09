// Settings model shared by the main process and the UI. It mirrors the Qt launcher's
// Configuration class (src/launcher/include/configuration.h) so both launchers read and write
// the same Kyty.ini values.

export type Platform = 'linux' | 'win32' | 'darwin';

export const RESOLUTIONS = ['R1280X720', 'R1920X1080', 'R2560X1440', 'R3840X2160'] as const;
export const PRESENT_MODES = ['Fifo', 'Mailbox', 'Immediate'] as const;
export const SHADER_OPTIMIZATION_TYPES = ['None', 'Size', 'Performance'] as const;
export const LOG_DIRECTIONS = ['Silent', 'Console', 'File'] as const;

export type Resolution = (typeof RESOLUTIONS)[number];
export type PresentMode = (typeof PRESENT_MODES)[number];
export type ShaderOptimizationType = (typeof SHADER_OPTIMIZATION_TYPES)[number];
export type LogDirection = (typeof LOG_DIRECTIONS)[number];

export const DEFAULT_USER_ID = 1000;
export const DEFAULT_CONSOLE_LANGUAGE = 1;
export const MAX_CONSOLE_LANGUAGE = 29;
export const MAX_USER_NAME_BYTES = 16;
export const MIN_VBLANK_FREQUENCY = 30;
export const MAX_VBLANK_FREQUENCY = 360;
export const MAX_USER_ID = 2147483647;

export const CONSOLE_LANGUAGE_NAMES = [
	'Japanese',
	'English (United States)',
	'French (France)',
	'Spanish (Spain)',
	'German',
	'Italian',
	'Dutch',
	'Portuguese (Portugal)',
	'Russian',
	'Korean',
	'Chinese (Traditional)',
	'Chinese (Simplified)',
	'Finnish',
	'Swedish',
	'Danish',
	'Norwegian',
	'Polish',
	'Portuguese (Brazil)',
	'English (United Kingdom)',
	'Turkish',
	'Spanish (Latin America)',
	'Arabic',
	'French (Canada)',
	'Czech',
	'Hungarian',
	'Greek',
	'Romanian',
	'Thai',
	'Vietnamese',
	'Indonesian',
] as const;

// The emulator settings a game config overrides (Configuration::GameSettings plus the mapping).
export interface EmulatorSettings {
	screen_resolution: Resolution;
	user_name: string;
	user_id: number;
	audio_input_device: string;
	present_mode: PresentMode;
	gpu_index: number;
	fullscreen_enabled: boolean;
	hide_cursor_enabled: boolean;
	readback_linear_images: boolean;
	sync_raw_image_buffers: boolean;
	tessellation_enabled: boolean;
	async_pipelines_enabled: boolean;
	trophy_enabled: boolean;
	skip_notice_screen: boolean;
	vblank_frequency: number;
	console_language: number;
	vulkan_validation_enabled: boolean;
	shader_validation_enabled: boolean;
	shader_optimization_type: ShaderOptimizationType;
	shader_log_direction: LogDirection;
	shader_log_folder: string;
	command_buffer_dump_enabled: boolean;
	command_buffer_dump_folder: string;
	printf_direction: LogDirection;
	printf_output_file: string;
	profiler_enabled: boolean;
	renderdoc_enabled: boolean;
	amd_cpu_enabled: boolean;
	// Read, written and passed to the emulator on Windows only.
	red_zone_protection_enabled: boolean;
	elf: string;
	host_input_mapping: string[];
}

export interface ControllerSettings {
	// "#rrggbb", or empty to let the game control the lightbar.
	color: string;
	speaker_volume: number;
	vibration_intensity: number;
}

export function defaultEmulatorSettings(): EmulatorSettings {
	return {
		screen_resolution: 'R1280X720',
		user_name: 'Kyty',
		user_id: DEFAULT_USER_ID,
		audio_input_device: '',
		present_mode: 'Mailbox',
		gpu_index: -1,
		fullscreen_enabled: false,
		hide_cursor_enabled: false,
		readback_linear_images: true,
		sync_raw_image_buffers: false,
		tessellation_enabled: true,
		async_pipelines_enabled: true,
		trophy_enabled: true,
		skip_notice_screen: false,
		vblank_frequency: 60,
		console_language: DEFAULT_CONSOLE_LANGUAGE,
		vulkan_validation_enabled: false,
		shader_validation_enabled: false,
		shader_optimization_type: 'Performance',
		shader_log_direction: 'Silent',
		shader_log_folder: '_Shaders',
		command_buffer_dump_enabled: false,
		command_buffer_dump_folder: '_Buffers',
		printf_direction: 'Silent',
		printf_output_file: '_kyty.txt',
		profiler_enabled: false,
		renderdoc_enabled: false,
		amd_cpu_enabled: false,
		red_zone_protection_enabled: true,
		elf: 'eboot.bin',
		host_input_mapping: [],
	};
}

export function defaultControllerSettings(): ControllerSettings {
	return { color: '', speaker_volume: 50, vibration_intensity: 100 };
}

// "R1920X1080" -> "1920x1080", as the Qt launcher displays and passes it.
export function resolutionText(value: Resolution): string {
	return value.slice(1).toLowerCase();
}

export function isUserIdValid(id: number): boolean {
	return Number.isInteger(id) && id >= 0 && id <= MAX_USER_ID && id !== 254 && id !== 255;
}

export function utf8Length(text: string): number {
	return new TextEncoder().encode(text).length;
}

export function isUserNameValid(name: string): boolean {
	const trimmed = name.trim();
	return trimmed.length > 0 && utf8Length(trimmed) <= MAX_USER_NAME_BYTES;
}

// Keys of Configuration::GameSettings(), in the QVariantMap (sorted) order Qt exports them.
export function gameSettingKeys(platform: Platform): string[] {
	const keys = [
		'amd_cpu_enabled',
		'async_pipelines_enabled',
		'command_buffer_dump_enabled',
		'command_buffer_dump_folder',
		'console_language',
		'elf',
		'fullscreen_enabled',
		'gpu_index',
		'hide_cursor_enabled',
		'present_mode',
		'printf_direction',
		'printf_output_file',
		'profiler_enabled',
		'readback_linear_images',
		'audio_input_device',
		'renderdoc_enabled',
		'screen_resolution',
		'shader_log_direction',
		'shader_log_folder',
		'shader_optimization_type',
		'shader_validation_enabled',
		'skip_notice_screen',
		'sync_raw_image_buffers',
		'tessellation_enabled',
		'trophy_enabled',
		'user_id',
		'user_name',
		'vblank_frequency',
		'vulkan_validation_enabled',
	];
	if (platform === 'win32') {
		keys.push('red_zone_protection_enabled');
	}
	return keys.sort();
}

export type SettingKey = keyof EmulatorSettings;

// Preferences of this launcher, stored in the [ElectronLauncher] section of Kyty.ini.
export type GpuAcceleration = 'auto' | 'force' | 'off';
export type ConfirmButton = 'cross' | 'circle';
export type ControllerInputSource = 'gamepad' | 'sdl';

export interface LauncherPrefs {
	fullscreen: boolean;
	gpu_acceleration: GpuAcceleration;
	animated_background: boolean;
	minimize_on_launch: boolean;
	confirm_button: ConfirmButton;
	controller_input_source: ControllerInputSource;
	ui_sounds: boolean;
	last_selected_game: string;
}

export function defaultLauncherPrefs(): LauncherPrefs {
	return {
		fullscreen: false,
		gpu_acceleration: 'auto',
		animated_background: true,
		minimize_on_launch: true,
		confirm_button: 'cross',
		controller_input_source: 'gamepad',
		ui_sounds: true,
		last_selected_game: '',
	};
}

export interface WindowBounds {
	x?: number;
	y?: number;
	width: number;
	height: number;
	maximized: boolean;
}

// A per-game entry of [GameConfigurations].
export interface GameConfig extends EmulatorSettings {
	name: string;
	basedir: string;
	game_path: string;
}
