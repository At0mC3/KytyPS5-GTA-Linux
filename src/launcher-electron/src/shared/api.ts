// The API the preload script exposes to the UI as window.kyty. Each method is an IPC call of
// the same name ("kyty:<method>"), handled by the main process.
import type { ControllerSettings, EmulatorSettings, LauncherPrefs } from './settings';
import type {
	AppState,
	CheatPreview,
	DirListing,
	Game,
	GameSettingsView,
	GameStatus,
	ImportPreview,
	LaunchResult,
	LocalCheats,
	LogLine,
	RemoteCheat,
	RunState,
	SaveResult,
	SdlControllerEvent,
	TrophyGame,
	UpdateResult,
} from './types';

export interface GlobalSettingsInput {
	global: EmulatorSettings;
	controller: ControllerSettings;
	gameDirs: string[];
}

export interface FileDialogOptions {
	title?: string;
	defaultPath?: string;
	filters?: { name: string; extensions: string[] }[];
}

export interface KytyMethods {
	getState(): Promise<AppState>;
	getLibrary(): Promise<Game[]>;
	rescan(): Promise<Game[]>;
	refreshEmulator(): Promise<AppState>;

	getGameSettings(gameId: string): Promise<GameSettingsView>;
	saveGameSettings(gameId: string, settings: EmulatorSettings): Promise<SaveResult>;
	clearGameSettings(gameId: string): Promise<SaveResult>;
	saveGlobalSettings(input: GlobalSettingsInput): Promise<SaveResult>;
	setPrefs(prefs: Partial<LauncherPrefs>): Promise<SaveResult>;
	setCheckUpdatesOnStartup(value: boolean): Promise<SaveResult>;
	previewLightbar(color: string | null): Promise<void>;

	launch(gameId: string, decision?: 'recommended' | 'as-configured'): Promise<LaunchResult>;
	stopGame(): Promise<void>;
	getRunState(): Promise<RunState>;
	getLog(): Promise<LogLine[]>;

	getTrophies(gameId: string): Promise<TrophyGame>;
	getTrophyOverview(): Promise<TrophyGame[]>;

	cheatsLocal(gameId: string): Promise<LocalCheats>;
	cheatsSave(gameId: string, enabled: boolean[]): Promise<SaveResult>;
	cheatsCatalog(gameId: string): Promise<{ files: RemoteCheat[]; error: string }>;
	cheatsPreview(gameId: string, name: string): Promise<CheatPreview>;
	cheatsImport(gameId: string, name: string): Promise<SaveResult>;

	setCompat(gameId: string, change: { status?: GameStatus; comment?: string }): Promise<SaveResult>;
	saveDataDirs(gameId: string): Promise<string[]>;
	removeSaveData(gameId: string): Promise<{ failed: string[] }>;
	openGameFolder(gameId: string): Promise<SaveResult>;

	listDir(dir: string | undefined, extensions?: string[]): Promise<DirListing>;
	showOpenDialog(options: FileDialogOptions & { directory?: boolean; multiple?: boolean }): Promise<string[]>;
	showSaveDialog(options: FileDialogOptions): Promise<string | undefined>;

	previewImport(file: string): Promise<ImportPreview>;
	applyImport(token: string): Promise<SaveResult>;
	exportTargets(): Promise<{ gameId: string; titleId: string; title: string; gamePath: string }[]>;
	exportGameConfig(gameId: string, file: string, overwrite: boolean): Promise<SaveResult & { exists?: boolean }>;

	checkForUpdates(): Promise<UpdateResult>;
	openExternal(url: string): Promise<void>;

	setFullscreen(value: boolean): Promise<void>;
	toggleFullscreen(): Promise<void>;
	quit(stopGame: boolean): Promise<void>;
	minimize(): Promise<void>;
}

export const KYTY_METHODS: readonly (keyof KytyMethods)[] = [
	'getState',
	'getLibrary',
	'rescan',
	'refreshEmulator',
	'getGameSettings',
	'saveGameSettings',
	'clearGameSettings',
	'saveGlobalSettings',
	'setPrefs',
	'setCheckUpdatesOnStartup',
	'previewLightbar',
	'launch',
	'stopGame',
	'getRunState',
	'getLog',
	'getTrophies',
	'getTrophyOverview',
	'cheatsLocal',
	'cheatsSave',
	'cheatsCatalog',
	'cheatsPreview',
	'cheatsImport',
	'setCompat',
	'saveDataDirs',
	'removeSaveData',
	'openGameFolder',
	'listDir',
	'showOpenDialog',
	'showSaveDialog',
	'previewImport',
	'applyImport',
	'exportTargets',
	'exportGameConfig',
	'checkForUpdates',
	'openExternal',
	'setFullscreen',
	'toggleFullscreen',
	'quit',
	'minimize',
];

export interface Notice {
	kind: 'update' | 'error' | 'info';
	title: string;
	message: string;
	url?: string;
}

export interface KytyEvents {
	state: AppState;
	library: Game[];
	run: RunState;
	log: LogLine[];
	sdl: SdlControllerEvent;
	notice: Notice;
	confirmQuit: undefined;
}

export const KYTY_EVENTS: readonly (keyof KytyEvents)[] = ['state', 'library', 'run', 'log', 'sdl', 'notice', 'confirmQuit'];

export interface KytyApi extends KytyMethods {
	on<K extends keyof KytyEvents>(event: K, listener: (payload: KytyEvents[K]) => void): () => void;
	platform: string;
}
