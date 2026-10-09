// Data exchanged between the main process and the UI.
import type { ControllerSettings, EmulatorSettings, LauncherPrefs, Platform } from './settings';

export type GameStatus = 'Unknown' | 'InGame' | 'MainMenu' | 'Logo' | 'DoesntBoot';

export const GAME_STATUS_LABELS: Record<GameStatus, string> = {
	Unknown: 'Unknown',
	InGame: 'In game',
	MainMenu: 'Main menu',
	Logo: 'Logo',
	DoesntBoot: "Doesn't boot",
};

export const GAME_STATUS_COLORS: Record<GameStatus, string> = {
	Unknown: '#8a8a8a',
	InGame: '#2fb344',
	MainMenu: '#2f80ed',
	Logo: '#f2c94c',
	DoesntBoot: '#e55353',
};

export interface TrophySummary {
	total: number;
	earned: number;
	percentage: number;
	earnedGrade: number[];
	totalGrade: number[];
}

export interface Game {
	id: string;
	gamePath: string;
	basedir: string;
	archive: boolean;
	title: string;
	titleId: string;
	gameVersion: string;
	firmwareVersion: string;
	hasCustomConfig: boolean;
	icon?: string;
	background?: string;
	size?: number;
	status: GameStatus;
	comment: string;
	available: boolean;
	cheatsSupported: boolean;
	hasCheatFile: boolean;
	trophies?: TrophySummary;
}

export interface GpuInfo {
	index: number;
	name: string;
	type: string;
	meetsRequirements: boolean;
}

export interface EmulatorInfo {
	found: boolean;
	path?: string;
	directory?: string;
	version?: string;
	buildString?: string;
	queryAvailable: boolean;
	updateCheckSupported: boolean;
	releaseTag?: string;
	gpus: GpuInfo[];
	gpuError?: string;
	microphones: string[];
	micError?: string;
}

export interface AppState {
	platform: Platform;
	launcherVersion: string;
	settingsFile: string;
	settingsError?: string;
	emulator: EmulatorInfo;
	global: EmulatorSettings;
	controller: ControllerSettings;
	gameDirs: string[];
	prefs: LauncherPrefs;
	checkUpdatesOnStartup: boolean;
	compatLocal: boolean;
	fullscreen: boolean;
	// False until the first scan of the game folders has finished.
	libraryReady: boolean;
	gpuFeatures: Record<string, string>;
	testMode: boolean;
}

export interface RunState {
	running: boolean;
	gameId?: string;
	title?: string;
	pid?: number;
	startedAt?: number;
	exitCode?: number | null;
	signal?: string | null;
	error?: string;
}

export interface LogLine {
	stream: 'out' | 'err' | 'sys';
	text: string;
}

export interface GameSettingsView {
	settings: EmulatorSettings;
	custom: boolean;
}

export type SaveResult = { ok: true } | { ok: false; error: string };

export interface LaunchResult {
	ok: boolean;
	error?: string;
	// Settings GTA V needs that are off; the UI asks before launching.
	missingRecommended?: string[];
}

export interface DirEntry {
	name: string;
	path: string;
	directory: boolean;
}

export interface DirListing {
	path: string;
	parent?: string;
	entries: DirEntry[];
	roots: DirEntry[];
	error?: string;
}

export interface ImportPreview {
	token?: string;
	error?: string;
	matched: { titleId: string; title: string }[];
	unmatched: string[];
}

export interface Trophy {
	id: number;
	groupId: number;
	grade: number;
	hidden: boolean;
	hasReward: boolean;
	name: string;
	description: string;
	reward: string;
	icon?: string;
	unlocked: boolean;
	unlockedAt?: number;
}

export interface TrophyPackage {
	file: string;
	serviceLabel: number;
	title: string;
	groups: { id: number; name: string }[];
	progress: TrophySummary;
	trophies: Trophy[];
}

export interface TrophyGame {
	gameId: string;
	packages: TrophyPackage[];
	errors: string[];
	summary?: TrophySummary;
}

export interface RemoteCheat {
	name: string;
	title: string;
	version: string;
	format: string;
	supported: boolean;
	installed: boolean;
}

export interface CheatPreview {
	error?: string;
	importError?: string;
	mods: string[];
	name: string;
	credits: string;
	version: string;
}

export interface LocalCheats {
	path?: string;
	exists: boolean;
	readable: boolean;
	error?: string;
	mods: { name: string; enabled: boolean }[];
}

export interface UpdateResult {
	error?: string;
	current?: string;
	latest?: string;
	url?: string;
	upToDate?: boolean;
}

export interface SdlControllerEvent {
	event: 'added' | 'removed' | 'button' | 'axis';
	name?: string;
	button?: string;
	down?: boolean;
	axis?: string;
	value?: number;
}
