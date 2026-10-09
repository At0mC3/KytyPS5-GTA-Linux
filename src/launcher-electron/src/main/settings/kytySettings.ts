// Maps Kyty.ini sections to launcher data, the way ConfigurationListWidget::ReadSettings and
// WriteSettings do (src/launcher/src/configurationListWidget.cpp).
import {
	defaultControllerSettings,
	defaultEmulatorSettings,
	defaultLauncherPrefs,
	type ControllerSettings,
	type EmulatorSettings,
	type GameConfig,
	type LauncherPrefs,
	type Platform,
	type WindowBounds,
} from '../../shared/settings';
import { gameSettingsMap, readGameSettings, readInputMapping, type Getter } from './gameSettings';
import type { IniDocument } from './qsettingsIni';
import { normalizeColor, toQBool, toQInt, toQString, toQStringList } from './qtValues';

export const SECTION_GLOBAL = 'GlobalConfiguration';
export const SECTION_GAMES = 'GameConfigurations';
export const SECTION_LAUNCHER = 'Launcher';
export const SECTION_MAIN_DIALOG = 'MainDialog';
export const SECTION_ELECTRON = 'ElectronLauncher';

export interface GlobalMeta {
	name: string;
	basedir: string;
	game_path: string;
}

export interface KytySettings {
	global: EmulatorSettings;
	globalMeta: GlobalMeta;
	controller: ControllerSettings;
	gameDirs: string[];
	gameConfigs: GameConfig[];
	checkUpdatesOnStartup: boolean;
	prefs: LauncherPrefs;
	window: WindowBounds;
}

function getter(doc: IniDocument, section: string, prefix = ''): Getter {
	return (key) => doc.get(section, prefix + key);
}

// SettingsStringList(): a list, or a single string as a one-item list.
function stringList(value: ReturnType<IniDocument['get']>): string[] {
	const list = toQStringList(value ?? null);
	return list.filter((item, index) => !(list.length === 1 && index === 0 && item.length === 0));
}

export function readController(get: Getter): ControllerSettings {
	const result = defaultControllerSettings();
	result.color = normalizeColor(toQString(get('controller_color')));
	const percent = (key: string, fallback: number) => {
		const raw = get(key);
		const value = raw === undefined ? { ok: true, value: fallback } : toQInt(raw);
		return value.ok ? Math.min(100, Math.max(0, value.value)) : fallback;
	};
	result.speaker_volume = percent('controller_speaker_volume', 50);
	result.vibration_intensity = percent('controller_vibration_intensity', 100);
	return result;
}

function readGameConfig(get: Getter, platform: Platform): GameConfig {
	const base = defaultEmulatorSettings();
	const settings = readGameSettings(get, base, platform);
	settings.host_input_mapping = readInputMapping(get, base.host_input_mapping);
	return {
		...settings,
		name: toQString(get('name')),
		basedir: toQString(get('basedir')),
		game_path: toQString(get('game_path')),
	};
}

function readPrefs(get: Getter): { prefs: LauncherPrefs; window: WindowBounds } {
	const prefs = defaultLauncherPrefs();
	const bool = (key: string, fallback: boolean) => {
		const raw = get(key);
		return raw === undefined ? fallback : toQBool(raw);
	};
	const oneOf = <T extends string>(key: string, values: readonly T[], fallback: T): T => {
		const text = toQString(get(key));
		return (values as readonly string[]).includes(text) ? (text as T) : fallback;
	};
	const int = (key: string) => {
		const raw = get(key);
		const value = raw === undefined ? { ok: false, value: 0 } : toQInt(raw);
		return value.ok ? value.value : undefined;
	};
	prefs.fullscreen = bool('fullscreen', prefs.fullscreen);
	prefs.gpu_acceleration = oneOf('gpu_acceleration', ['auto', 'force', 'off'] as const, prefs.gpu_acceleration);
	prefs.animated_background = bool('animated_background', prefs.animated_background);
	prefs.minimize_on_launch = bool('minimize_on_launch', prefs.minimize_on_launch);
	prefs.confirm_button = oneOf('confirm_button', ['cross', 'circle'] as const, prefs.confirm_button);
	prefs.controller_input_source = oneOf('controller_input_source', ['gamepad', 'sdl'] as const, prefs.controller_input_source);
	prefs.ui_sounds = bool('ui_sounds', prefs.ui_sounds);
	prefs.last_selected_game = toQString(get('last_selected_game'));
	const width = int('window_width');
	const height = int('window_height');
	const window: WindowBounds = {
		x: int('window_x'),
		y: int('window_y'),
		width: width !== undefined && width >= 640 ? width : 1280,
		height: height !== undefined && height >= 400 ? height : 760,
		maximized: bool('window_maximized', false),
	};
	return { prefs, window };
}

export function readKytySettings(doc: IniDocument, platform: Platform): KytySettings {
	const launcherGet = getter(doc, SECTION_LAUNCHER);
	let gameDirs = stringList(launcherGet('game_dirs'));
	if (gameDirs.length === 0) {
		gameDirs = stringList(launcherGet('game_dir'));
	}

	const globalGet = getter(doc, SECTION_GLOBAL);
	let global = defaultEmulatorSettings();
	const globalMeta: GlobalMeta = { name: '', basedir: '', game_path: '' };
	if (doc.childKeys(SECTION_GLOBAL).length > 0) {
		global = readGameSettings(globalGet, global, platform);
		global.host_input_mapping = readInputMapping(globalGet, global.host_input_mapping);
		globalMeta.name = toQString(globalGet('name'));
		globalMeta.basedir = toQString(globalGet('basedir'));
		globalMeta.game_path = toQString(globalGet('game_path'));
	}
	const controller = readController(globalGet);

	const gameConfigs = new Map<string, GameConfig>();
	const sizeRaw = doc.get(SECTION_GAMES, 'size');
	const size = sizeRaw === undefined ? 0 : Math.max(0, toQInt(sizeRaw).value);
	for (let i = 1; i <= size; i++) {
		const config = readGameConfig(getter(doc, SECTION_GAMES, `${i}/`), platform);
		if (config.game_path.length > 0) {
			gameConfigs.set(config.game_path, config);
		}
	}

	const mainGet = getter(doc, SECTION_MAIN_DIALOG);
	const checkRaw = mainGet('check_updates_on_startup');
	const { prefs, window } = readPrefs(getter(doc, SECTION_ELECTRON));

	return {
		global,
		globalMeta,
		controller,
		gameDirs,
		gameConfigs: [...gameConfigs.values()],
		checkUpdatesOnStartup: checkRaw === undefined ? true : toQBool(checkRaw),
		prefs,
		window,
	};
}

function writeConfiguration(
	doc: IniDocument,
	section: string,
	prefix: string,
	settings: EmulatorSettings,
	meta: GlobalMeta,
	customSettings: boolean,
	platform: Platform,
): void {
	for (const [key, value] of Object.entries(gameSettingsMap(settings, platform))) {
		doc.set(section, prefix + key, value);
	}
	doc.set(section, `${prefix}name`, meta.name);
	doc.set(section, `${prefix}basedir`, meta.basedir);
	doc.set(section, `${prefix}game_path`, meta.game_path);
	doc.set(section, `${prefix}custom_settings`, customSettings ? 'true' : 'false');
	doc.set(section, `${prefix}host_input_mapping`, settings.host_input_mapping);
}

export function writeGlobal(
	doc: IniDocument,
	global: EmulatorSettings,
	meta: GlobalMeta,
	controller: ControllerSettings,
	platform: Platform,
): void {
	doc.clearSection(SECTION_GLOBAL);
	writeConfiguration(doc, SECTION_GLOBAL, '', global, meta, false, platform);
	doc.set(SECTION_GLOBAL, 'controller_color', controller.color);
	doc.set(SECTION_GLOBAL, 'controller_speaker_volume', String(controller.speaker_volume));
	doc.set(SECTION_GLOBAL, 'controller_vibration_intensity', String(controller.vibration_intensity));
}

export function writeGameDirs(doc: IniDocument, dirs: string[]): void {
	doc.set(SECTION_LAUNCHER, 'game_dirs', dirs);
	doc.remove(SECTION_LAUNCHER, 'game_dir');
}

export function writeGameConfigs(doc: IniDocument, configs: GameConfig[], platform: Platform): void {
	doc.clearSection(SECTION_GAMES);
	const sorted = [...configs].sort((a, b) => (a.game_path < b.game_path ? -1 : a.game_path > b.game_path ? 1 : 0));
	sorted.forEach((config, index) => {
		const meta = { name: config.name, basedir: config.basedir, game_path: config.game_path };
		writeConfiguration(doc, SECTION_GAMES, `${index + 1}/`, config, meta, true, platform);
	});
	doc.set(SECTION_GAMES, 'size', String(sorted.length));
}

export function writeCheckUpdates(doc: IniDocument, value: boolean): void {
	doc.set(SECTION_MAIN_DIALOG, 'check_updates_on_startup', value ? 'true' : 'false');
}

export function writePrefs(doc: IniDocument, prefs: LauncherPrefs): void {
	doc.set(SECTION_ELECTRON, 'fullscreen', String(prefs.fullscreen));
	doc.set(SECTION_ELECTRON, 'gpu_acceleration', prefs.gpu_acceleration);
	doc.set(SECTION_ELECTRON, 'animated_background', String(prefs.animated_background));
	doc.set(SECTION_ELECTRON, 'minimize_on_launch', String(prefs.minimize_on_launch));
	doc.set(SECTION_ELECTRON, 'confirm_button', prefs.confirm_button);
	doc.set(SECTION_ELECTRON, 'controller_input_source', prefs.controller_input_source);
	doc.set(SECTION_ELECTRON, 'ui_sounds', String(prefs.ui_sounds));
	doc.set(SECTION_ELECTRON, 'last_selected_game', prefs.last_selected_game);
}

export function writeWindow(doc: IniDocument, window: WindowBounds): void {
	if (window.x !== undefined && window.y !== undefined) {
		doc.set(SECTION_ELECTRON, 'window_x', String(Math.round(window.x)));
		doc.set(SECTION_ELECTRON, 'window_y', String(Math.round(window.y)));
	}
	doc.set(SECTION_ELECTRON, 'window_width', String(Math.round(window.width)));
	doc.set(SECTION_ELECTRON, 'window_height', String(Math.round(window.height)));
	doc.set(SECTION_ELECTRON, 'window_maximized', String(window.maximized));
}
