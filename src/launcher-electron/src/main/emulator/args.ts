// Port of CreateEmulatorArgs and ApplyRecommendedSettings (src/launcher/src/mainDialog.cpp).
// The argument order matches the Qt launcher exactly.
import path from 'node:path';
import { resolutionText, type ControllerSettings, type EmulatorSettings, type Platform } from '../../shared/settings';
import { isArchivePath } from '../library/paths';

export interface LaunchTarget {
	settings: EmulatorSettings;
	controller: ControllerSettings;
	basedir: string;
}

function bool(value: boolean): string {
	return value ? 'true' : 'false';
}

export function joinGamePath(basedir: string, elf: string, platform: Platform): string {
	return (platform === 'win32' ? path.win32 : path.posix).join(basedir, elf).replace(/\\/g, '/');
}

export function buildEmulatorArgs(target: LaunchTarget, platform: Platform, patchPath?: string): string[] {
	const { settings: s, controller } = target;
	const [width, height] = resolutionText(s.screen_resolution).split('x');
	const args: string[] = [];
	args.push('--screen-width', width!, '--screen-height', height!);
	args.push('--user-name', s.user_name);
	args.push('--user-id', String(s.user_id));
	if (s.audio_input_device.length > 0) {
		args.push('--mic', s.audio_input_device);
	}
	if (controller.color.length > 0) {
		args.push('--controller-color', controller.color);
	}
	args.push('--controller-volume', String(controller.speaker_volume));
	args.push('--controller-vibration', String(controller.vibration_intensity));
	args.push('--present-mode', s.present_mode);
	if (s.gpu_index >= 0) {
		args.push('--gpu', String(s.gpu_index));
	}
	if (s.fullscreen_enabled) {
		args.push('--fullscreen');
	}
	if (s.hide_cursor_enabled) {
		args.push('--hide-cursor');
	}
	args.push('--readback-linear-images', bool(s.readback_linear_images));
	args.push('--sync-raw-image-buffers', bool(s.sync_raw_image_buffers));
	args.push('--trophy-notifications', bool(s.trophy_enabled));
	args.push('--skip-notice-screen', bool(s.skip_notice_screen));
	args.push(s.tessellation_enabled ? '--tessellation' : '--no-tessellation');
	args.push(s.async_pipelines_enabled ? '--async-pipelines' : '--no-async-pipelines');
	args.push('--vblank-frequency', String(s.vblank_frequency));
	args.push('--console-language', String(s.console_language));
	args.push('--vulkan-validation', bool(s.vulkan_validation_enabled));
	args.push('--shader-validation', bool(s.shader_validation_enabled));
	args.push('--shader-optimization-type', s.shader_optimization_type);
	args.push('--shader-log-direction', s.shader_log_direction);
	args.push('--shader-log-folder', s.shader_log_folder);
	args.push('--command-buffer-dump', bool(s.command_buffer_dump_enabled));
	args.push('--command-buffer-dump-folder', s.command_buffer_dump_folder);
	args.push('--printf-direction', s.printf_direction);
	args.push('--printf-output-file', s.printf_output_file);
	if (s.profiler_enabled) {
		args.push('--profile');
	}
	args.push('--spirv-debug-printf', 'false');
	if (s.amd_cpu_enabled) {
		args.push('--amd-cpu');
	}
	if (platform === 'win32') {
		args.push(s.red_zone_protection_enabled ? '--redzone' : '--no-redzone');
	}
	for (const binding of s.host_input_mapping) {
		args.push('--keymap', binding);
	}
	if (s.renderdoc_enabled) {
		args.push('--rd');
	}
	let game = target.basedir;
	if (s.elf.length > 0 && !isArchivePath(target.basedir)) {
		game = joinGamePath(target.basedir, s.elf, platform);
	}
	args.push('--game', game);
	if (patchPath !== undefined) {
		args.push('--game-patch', patchPath);
	}
	return args;
}

export const GTA_V_TITLE_ID = 'PPSA04263';

// Settings GTA V needs: without red zone protection its streaming thread crashes, without linear
// image readback cars deform wildly in collisions, and without tessellation the trunks of nearby
// trees are not drawn.
export function missingRecommendedSettings(titleId: string, s: EmulatorSettings, platform: Platform): string[] {
	if (titleId !== GTA_V_TITLE_ID) {
		return [];
	}
	const missing: string[] = [];
	if (platform === 'win32' && !s.red_zone_protection_enabled) {
		missing.push('Windows SysV red zone crash protection (streaming crashes)');
	}
	if (!s.readback_linear_images) {
		missing.push('Read back linear images (vehicle damage)');
	}
	if (!s.tessellation_enabled) {
		missing.push('Tessellation support (trunks of nearby trees)');
	}
	return missing;
}

export function withRecommendedSettings(s: EmulatorSettings, platform: Platform): EmulatorSettings {
	return {
		...s,
		red_zone_protection_enabled: platform === 'win32' ? true : s.red_zone_protection_enabled,
		readback_linear_images: true,
		tessellation_enabled: true,
	};
}
