// The launcher's state and operations behind the IPC API: settings in Kyty.ini, the game
// library, launching, trophies, cheats, compatibility, save data and updates.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GlobalSettingsInput, KytyEvents, Notice } from '../shared/api';
import {
	defaultEmulatorSettings,
	type EmulatorSettings,
	type GameConfig,
	type LauncherPrefs,
	type Platform,
	type WindowBounds,
} from '../shared/settings';
import type {
	AppState,
	CheatPreview,
	DirListing,
	EmulatorInfo,
	Game,
	GameSettingsView,
	GameStatus,
	ImportPreview,
	LaunchResult,
	LocalCheats,
	RemoteCheat,
	SaveResult,
	Trophy,
	TrophyGame,
	TrophyPackage,
	TrophySummary,
	UpdateResult,
} from '../shared/types';
import { cheatMods, cheatPath, isSupportedTitleId, parseCheatDocument, saveCheatDocument, validateImport, withSelection, type CheatDocument } from './cheats/cheatFile';
import { fetchCheatFile, loadCheatCatalog } from './cheats/repository';
import { CompatibilityDatabase } from './compat/database';
import { buildEmulatorArgs, missingRecommendedSettings, withRecommendedSettings } from './emulator/args';
import { ControllerHelper } from './emulator/controllerHelper';
import { findEmulator } from './emulator/discovery';
import { queryEmulatorInfo, runQuery } from './emulator/query';
import { GameRunner } from './emulator/runner';
import { listDirectory } from './fs/browser';
import { MAX_IMAGE_SIZE, MAX_METADATA_SIZE, parseParamJson, type GameMetadata } from './library/paramJson';
import { isArchivePath, normalizeGameDirectories, qtCleanPath, sameGamePath } from './library/paths';
import { removeDirs, saveDataDirs } from './library/saveData';
import { gameSize, scanGameFolders, type FoundGame } from './library/scanner';
import { applyGameSettings, gameSettingsMap } from './settings/gameSettings';
import {
	readKytySettings,
	writeCheckUpdates,
	writeGameConfigs,
	writeGameDirs,
	writeGlobal,
	writePrefs,
	writeWindow,
	type KytySettings,
} from './settings/kytySettings';
import { IniDocument } from './settings/qsettingsIni';
import { readSettingsText, resolveSettingsPath, updateSettingsFile, writeFileAtomic } from './settings/settingsFile';
import { checkForUpdates } from './updates/checker';

export interface ServiceOptions {
	platform: Platform;
	cwd: string;
	launcherDir: string;
	cacheDir: string;
	compatLocal: boolean;
	emulatorOverride?: string;
	launcherVersion: string;
	testMode: boolean;
	gpuFeatures: () => Record<string, string>;
}

interface ArchiveMeta {
	ok: boolean;
	hasEboot: boolean;
	dir?: string;
	files: Record<string, boolean>;
	trophyFiles: string[];
}

interface GameRecord {
	game: Game;
	found: FoundGame;
	meta: GameMetadata;
	media: { icon?: string; pic?: string };
	hasTrophies: boolean;
}

type ServiceEvents = { [K in keyof KytyEvents]: [KytyEvents[K]] } & { window: [] };

function hash(text: string): string {
	return crypto.createHash('sha1').update(text).digest('hex').slice(0, 16);
}

function readLimited(file: string, limit: number): Buffer | undefined {
	try {
		const stat = fs.statSync(file);
		if (!stat.isFile() || stat.size > limit) {
			return undefined;
		}
		return fs.readFileSync(file);
	} catch {
		return undefined;
	}
}

function fileExists(file: string): boolean {
	try {
		return fs.statSync(file).isFile();
	} catch {
		return false;
	}
}

const TROPHY_FILE = /^trophy(\d+)\.ucp$/;

export class LauncherService extends EventEmitter<ServiceEvents> {
	readonly platform: Platform;
	settingsFile: string;
	settings: KytySettings;
	settingsError: string | undefined;
	emulator: EmulatorInfo = { found: false, queryAvailable: false, updateCheckSupported: false, gpus: [], microphones: [] };
	fullscreen = false;
	readonly runner = new GameRunner();
	readonly controller: ControllerHelper;
	private records = new Map<string, GameRecord>();
	private order: string[] = [];
	private rekeys = new Map<string, string>();
	private compat: CompatibilityDatabase;
	private lastSettingsText = '';
	private watcher: fs.FSWatcher | undefined;
	private reloadTimer: NodeJS.Timeout | undefined;
	private lightbarPreview: string | null = null;
	private cheatState = new Map<string, { data: Buffer; document?: CheatDocument; readable: boolean }>();
	private cheatPreviews = new Map<string, CheatDocument>();
	private pendingImports = new Map<string, { gameId: string; settings: EmulatorSettings }[]>();
	private mediaFiles = new Map<string, string>();
	private sizeJob = 0;

	constructor(private readonly options: ServiceOptions) {
		super();
		this.platform = options.platform;
		const emulatorPath = findEmulator(options.platform, options.launcherDir, options.emulatorOverride);
		this.settingsFile = resolveSettingsPath(options.platform, options.cwd, emulatorPath === undefined ? undefined : path.dirname(emulatorPath));
		this.settings = this.readSettingsFile();
		this.emulator = { ...this.emulator, found: emulatorPath !== undefined, path: emulatorPath, directory: emulatorPath === undefined ? undefined : path.dirname(emulatorPath) };
		this.controller = new ControllerHelper(emulatorPath);
		this.controller.on('event', (event) => this.emit('sdl', event));
		this.compat = new CompatibilityDatabase(options.compatLocal, options.cwd);
		this.runner.on('state', (state) => {
			this.emit('run', state);
			if (!state.running) {
				this.updateController();
				// Trophies may have been earned.
				void this.loadTrophySummaries();
			}
		});
		this.runner.on('log', (lines) => this.emit('log', lines));
	}

	// ----- Startup -----------------------------------------------------------------------------

	async start(): Promise<void> {
		this.watchSettings();
		if (this.emulator.path !== undefined) {
			this.emulator = await queryEmulatorInfo(this.emulator.path);
			this.emitState();
		}
		if (this.compat.local) {
			await this.compat.load().catch(() => undefined);
		}
		await this.rescan();
		if (!this.compat.local) {
			this.compat
				.load()
				.then(() => this.applyCompat())
				.catch(() => undefined);
		}
		this.updateController();
		if (this.settings.checkUpdatesOnStartup && this.emulator.updateCheckSupported) {
			void this.checkForUpdates().then((result) => {
				if (result.upToDate === false && result.url !== undefined) {
					this.notice({ kind: 'update', title: 'KytyPS5 update', message: `An update is available.\nCurrent: ${result.current}\nLatest: ${result.latest}`, url: result.url });
				}
			});
		}
	}

	dispose(): void {
		this.watcher?.close();
		this.controller.stop();
	}

	notice(notice: Notice): void {
		this.emit('notice', notice);
	}

	// ----- Settings file -------------------------------------------------------------------------

	private readSettingsFile(): KytySettings {
		try {
			this.lastSettingsText = readSettingsText(this.settingsFile);
			this.settingsError = undefined;
			return readKytySettings(IniDocument.parse(this.lastSettingsText), this.platform);
		} catch (error) {
			this.settingsError = `Could not read ${this.settingsFile}: ${(error as Error).message}`;
			return readKytySettings(IniDocument.parse(''), this.platform);
		}
	}

	private watchSettings(): void {
		const dir = path.dirname(this.settingsFile);
		try {
			fs.mkdirSync(dir, { recursive: true });
			this.watcher = fs.watch(dir, (_event, name) => {
				if (name !== null && name.toString() !== path.basename(this.settingsFile)) {
					return;
				}
				clearTimeout(this.reloadTimer);
				this.reloadTimer = setTimeout(() => this.reloadIfChanged(), 300);
			});
		} catch {
			// Watching is best effort.
		}
	}

	private reloadIfChanged(): void {
		let text: string;
		try {
			text = readSettingsText(this.settingsFile);
		} catch {
			return;
		}
		if (text === this.lastSettingsText) {
			return;
		}
		const dirsBefore = JSON.stringify(this.settings.gameDirs);
		this.settings = this.readSettingsFile();
		this.emitState();
		if (JSON.stringify(this.settings.gameDirs) !== dirsBefore) {
			void this.rescan();
		} else {
			this.refreshCustomFlags();
		}
	}

	private async writeSettings(change: (doc: IniDocument) => void): Promise<SaveResult> {
		try {
			const doc = await updateSettingsFile(this.settingsFile, this.platform, change);
			this.lastSettingsText = doc.serialize(this.platform === 'win32' ? '\r\n' : '\n');
			this.settings = readKytySettings(doc, this.platform);
			this.settingsError = undefined;
			this.emitState();
			return { ok: true };
		} catch (error) {
			return { ok: false, error: `Could not save ${this.settingsFile}: ${(error as Error).message}` };
		}
	}

	// Applies legacy re-keys (game folder relative paths used by older Qt launchers) to configs
	// read fresh from the file.
	private freshConfigs(doc: IniDocument): GameConfig[] {
		const configs = readKytySettings(doc, this.platform).gameConfigs;
		for (const config of configs) {
			const target = this.rekeys.get(config.game_path);
			if (target !== undefined && !configs.some((other) => other.game_path === target)) {
				config.game_path = target;
			}
		}
		return configs;
	}

	state(): AppState {
		return {
			platform: this.platform,
			launcherVersion: this.options.launcherVersion,
			settingsFile: this.settingsFile,
			settingsError: this.settingsError,
			emulator: this.emulator,
			global: this.settings.global,
			controller: this.settings.controller,
			gameDirs: this.settings.gameDirs,
			prefs: this.settings.prefs,
			checkUpdatesOnStartup: this.settings.checkUpdatesOnStartup,
			compatLocal: this.compat.local,
			fullscreen: this.fullscreen,
			gpuFeatures: this.options.gpuFeatures(),
			testMode: this.options.testMode,
		};
	}

	emitState(): void {
		this.emit('state', this.state());
	}

	async refreshEmulator(): Promise<AppState> {
		if (this.emulator.path !== undefined) {
			this.emulator = await queryEmulatorInfo(this.emulator.path);
		}
		this.emitState();
		return this.state();
	}

	// ----- Library -------------------------------------------------------------------------------

	library(): Game[] {
		return this.order.map((id) => this.records.get(id)!.game);
	}

	private emitLibrary(): void {
		this.emit('library', this.library());
	}

	private findConfig(found: Pick<FoundGame, 'gamePath' | 'legacyGamePath'>): GameConfig | undefined {
		const configs = this.settings.gameConfigs;
		const exact = configs.find((config) => config.game_path === found.gamePath);
		if (exact !== undefined) {
			return exact;
		}
		const loose = configs.find((config) => sameGamePath(config.game_path, found.gamePath, this.platform));
		if (loose !== undefined) {
			return loose;
		}
		const legacy = configs.find((config) => found.legacyGamePath.length > 0 && config.game_path === found.legacyGamePath);
		if (legacy !== undefined) {
			this.rekeys.set(legacy.game_path, found.gamePath);
			legacy.game_path = found.gamePath;
		}
		return legacy;
	}

	private refreshCustomFlags(): void {
		for (const record of this.records.values()) {
			record.game.hasCustomConfig = this.findConfig(record.found) !== undefined;
		}
		this.emitLibrary();
	}

	private archiveCacheDir(): string {
		return path.join(this.options.cacheDir, 'archives');
	}

	private async archiveMetadata(archives: string[]): Promise<Map<string, ArchiveMeta>> {
		const result = new Map<string, ArchiveMeta>();
		const missing: { archive: string; key: string }[] = [];
		for (const archive of archives) {
			let key: string;
			try {
				const stat = fs.statSync(archive);
				key = hash(`${archive}|${stat.size}|${stat.mtimeMs}`);
			} catch {
				continue;
			}
			const dir = path.join(this.archiveCacheDir(), key);
			try {
				const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) as ArchiveMeta;
				result.set(archive, { ...meta, dir });
			} catch {
				missing.push({ archive, key });
			}
		}
		if (missing.length === 0) {
			return result;
		}
		if (this.emulator.path === undefined || !this.emulator.queryAvailable) {
			for (const { archive } of missing) {
				result.set(archive, { ok: true, hasEboot: true, files: {}, trophyFiles: [] });
			}
			return result;
		}
		const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kyty-archives-'));
		try {
			const response = (await runQuery(this.emulator.path, 'archives', { outDir: temp, archives: missing.map((item) => item.archive) }, 120_000)) as
				| { archives?: { ok: boolean; hasEboot: boolean; files: Record<string, string | null>; trophyFiles?: string[] }[] }
				| undefined;
			missing.forEach(({ archive, key }, index) => {
				const item = response?.archives?.[index];
				if (item === undefined) {
					result.set(archive, { ok: true, hasEboot: true, files: {}, trophyFiles: [] });
					return;
				}
				const dir = path.join(this.archiveCacheDir(), key);
				fs.rmSync(dir, { recursive: true, force: true });
				fs.mkdirSync(path.dirname(dir), { recursive: true });
				const source = path.join(temp, String(index));
				if (fs.existsSync(source)) {
					fs.renameSync(source, dir);
				} else {
					fs.mkdirSync(dir, { recursive: true });
				}
				const meta: ArchiveMeta = {
					ok: item.ok,
					hasEboot: item.hasEboot,
					files: Object.fromEntries(Object.entries(item.files).map(([name, value]) => [name, value !== null])),
					trophyFiles: item.trophyFiles ?? [],
				};
				fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
				result.set(archive, { ...meta, dir });
			});
		} finally {
			fs.rmSync(temp, { recursive: true, force: true });
		}
		return result;
	}

	private folderHasTrophies(basedir: string): boolean {
		try {
			return fs.readdirSync(path.join(basedir, 'sce_sys', 'trophy2')).some((name) => TROPHY_FILE.test(name));
		} catch {
			return false;
		}
	}

	async rescan(): Promise<Game[]> {
		const dirs = this.settings.gameDirs;
		const allFound = scanGameFolders(dirs, this.platform);
		const archives = await this.archiveMetadata(allFound.filter((game) => game.archive).map((game) => game.basedir));
		const previous = this.records;
		this.records = new Map();
		this.mediaFiles.clear();
		for (const found of allFound) {
			let meta: GameMetadata;
			let iconFile: string | undefined;
			let picFile: string | undefined;
			let hasTrophies = false;
			if (found.archive) {
				const info = archives.get(found.basedir);
				if (info === undefined || !info.ok || !info.hasEboot) {
					continue;
				}
				const fileIn = (name: string) => (info.dir !== undefined && info.files[name] === true ? path.join(info.dir, ...name.split('/')) : undefined);
				const param = fileIn('sce_sys/param.json');
				meta = parseParamJson(param === undefined ? undefined : readLimited(param, MAX_METADATA_SIZE), found.fallbackTitle);
				iconFile = fileIn('sce_sys/icon0.png');
				picFile = fileIn('sce_sys/pic0.png');
				hasTrophies = info.trophyFiles.length > 0;
			} else {
				meta = parseParamJson(readLimited(path.join(found.basedir, 'sce_sys', 'param.json'), MAX_METADATA_SIZE), found.fallbackTitle);
				const icon = path.join(found.basedir, 'sce_sys', 'icon0.png');
				const pic = path.join(found.basedir, 'sce_sys', 'pic0.png');
				iconFile = readLimitedSize(icon) ? icon : undefined;
				picFile = readLimitedSize(pic) ? pic : undefined;
				hasTrophies = this.folderHasTrophies(found.basedir);
			}
			const id = hash(found.gamePath);
			const media: GameRecord['media'] = { icon: iconFile, pic: picFile };
			const version = (file: string | undefined) => {
				try {
					return file === undefined ? 0 : Math.round(fs.statSync(file).mtimeMs);
				} catch {
					return 0;
				}
			};
			if (iconFile !== undefined) {
				this.mediaFiles.set(`media/${id}/icon0.png`, iconFile);
			}
			if (picFile !== undefined) {
				this.mediaFiles.set(`media/${id}/pic0.png`, picFile);
			}
			const compat = this.compat.find(meta.titleId);
			const old = previous.get(id);
			const game: Game = {
				id,
				gamePath: found.gamePath,
				basedir: found.basedir,
				archive: found.archive,
				title: meta.title,
				titleId: meta.titleId,
				gameVersion: meta.gameVersion,
				firmwareVersion: meta.firmwareVersion,
				hasCustomConfig: this.findConfig(found) !== undefined,
				icon: iconFile === undefined ? undefined : `kyty://app/media/${id}/icon0.png?v=${version(iconFile)}`,
				background: picFile === undefined ? undefined : `kyty://app/media/${id}/pic0.png?v=${version(picFile)}`,
				size: old?.game.size,
				status: compat?.status ?? 'Unknown',
				comment: compat?.comment ?? '',
				available: found.archive ? fileExists(found.basedir) : fs.existsSync(found.basedir),
				cheatsSupported: isSupportedTitleId(meta.titleId),
				hasCheatFile: this.cheatFile(meta.titleId) !== undefined && fileExists(this.cheatFile(meta.titleId)!),
				trophies: old?.game.trophies,
			};
			this.records.set(id, { game, found, meta, media, hasTrophies });
		}
		this.order = [...this.records.keys()].sort((a, b) => {
			const ta = this.records.get(a)!.game.title;
			const tb = this.records.get(b)!.game.title;
			return ta.localeCompare(tb, undefined, { sensitivity: 'base' });
		});
		this.emitLibrary();
		void this.computeSizes();
		void this.loadTrophySummaries();
		return this.library();
	}

	private async computeSizes(): Promise<void> {
		const job = ++this.sizeJob;
		const selected = this.settings.prefs.last_selected_game;
		const ids = [...this.order].sort((a, b) => Number(this.records.get(b)?.game.gamePath === selected) - Number(this.records.get(a)?.game.gamePath === selected));
		let changed = false;
		let lastEmit = Date.now();
		for (const id of ids) {
			if (job !== this.sizeJob) {
				return;
			}
			const record = this.records.get(id);
			if (record === undefined || record.game.size !== undefined) {
				continue;
			}
			try {
				record.game.size = await gameSize(record.game.basedir, record.game.archive);
				changed = true;
			} catch {
				// Missing games keep an unknown size.
			}
			if (changed && Date.now() - lastEmit > 500) {
				this.emitLibrary();
				changed = false;
				lastEmit = Date.now();
			}
		}
		if (changed && job === this.sizeJob) {
			this.emitLibrary();
		}
	}

	private applyCompat(): void {
		for (const record of this.records.values()) {
			const entry = this.compat.find(record.game.titleId);
			record.game.status = entry?.status ?? 'Unknown';
			record.game.comment = entry?.comment ?? '';
		}
		this.emitLibrary();
	}

	private record(gameId: string): GameRecord {
		const record = this.records.get(gameId);
		if (record === undefined) {
			throw new Error('Unknown game.');
		}
		return record;
	}

	// ConfigurationListWidget::CreateConfiguration.
	effectiveSettings(record: GameRecord): GameSettingsView {
		const custom = this.findConfig(record.found);
		const source = custom ?? this.settings.global;
		const settings: EmulatorSettings = {
			...defaultEmulatorSettings(),
			...source,
			host_input_mapping: [...this.settings.global.host_input_mapping],
			elf: custom !== undefined && custom.elf.length > 0 ? custom.elf : 'eboot.bin',
		};
		return { settings, custom: custom !== undefined };
	}

	async getGameSettings(gameId: string): Promise<GameSettingsView> {
		return this.effectiveSettings(this.record(gameId));
	}

	async saveGameSettings(gameId: string, settings: EmulatorSettings): Promise<SaveResult> {
		const record = this.record(gameId);
		if (this.runner.current.running && this.runner.current.gameId === gameId) {
			return { ok: false, error: 'Stop the game before changing its settings.' };
		}
		const config: GameConfig = {
			...settings,
			host_input_mapping: [...this.settings.global.host_input_mapping],
			name: record.game.title,
			basedir: record.game.basedir,
			game_path: record.game.gamePath,
		};
		const result = await this.writeSettings((doc) => {
			const configs = this.freshConfigs(doc).filter((item) => item.game_path !== config.game_path);
			configs.push(config);
			writeGameConfigs(doc, configs, this.platform);
		});
		this.refreshCustomFlags();
		return result;
	}

	async clearGameSettings(gameId: string): Promise<SaveResult> {
		const record = this.record(gameId);
		const result = await this.writeSettings((doc) => {
			const configs = this.freshConfigs(doc).filter((item) => !sameGamePath(item.game_path, record.game.gamePath, this.platform));
			writeGameConfigs(doc, configs, this.platform);
		});
		this.refreshCustomFlags();
		return result;
	}

	async saveGlobalSettings(input: GlobalSettingsInput): Promise<SaveResult> {
		const dirs = normalizeGameDirectories(input.gameDirs, this.platform);
		const dirsChanged = JSON.stringify(dirs) !== JSON.stringify(this.settings.gameDirs);
		const result = await this.writeSettings((doc) => {
			writeGlobal(doc, input.global, this.settings.globalMeta, input.controller, this.platform);
			writeGameDirs(doc, dirs);
		});
		this.lightbarPreview = null;
		this.updateController();
		if (result.ok && dirsChanged) {
			void this.rescan();
		}
		return result;
	}

	async setPrefs(prefs: Partial<LauncherPrefs>): Promise<SaveResult> {
		const next = { ...this.settings.prefs, ...prefs };
		const result = await this.writeSettings((doc) => writePrefs(doc, next));
		this.updateController();
		return result;
	}

	async saveWindow(bounds: WindowBounds): Promise<void> {
		await this.writeSettings((doc) => writeWindow(doc, bounds));
	}

	async setCheckUpdatesOnStartup(value: boolean): Promise<SaveResult> {
		return this.writeSettings((doc) => writeCheckUpdates(doc, value));
	}

	// ----- Controller helper -----------------------------------------------------------------------

	async previewLightbar(color: string | null): Promise<void> {
		this.lightbarPreview = color;
		this.updateController();
	}

	updateController(): void {
		const color = this.lightbarPreview ?? this.settings.controller.color;
		this.controller.update({
			color,
			input: this.settings.prefs.controller_input_source === 'sdl',
			suspended: this.runner.current.running,
		});
	}

	// ----- Launching -------------------------------------------------------------------------------

	private cheatFile(titleId: string): string | undefined {
		return this.emulator.directory === undefined ? undefined : cheatPath(this.emulator.directory, titleId);
	}

	async launch(gameId: string, decision?: 'recommended' | 'as-configured'): Promise<LaunchResult> {
		if (this.runner.current.running) {
			return { ok: false, error: 'A game is already running.' };
		}
		if (this.emulator.path === undefined) {
			return { ok: false, error: "Can't find the emulator." };
		}
		const record = this.record(gameId);
		const exists = record.game.archive ? fileExists(record.game.basedir) : fs.existsSync(record.game.basedir);
		if (!exists) {
			return { ok: false, error: 'The game folder no longer exists.' };
		}
		let { settings } = this.effectiveSettings(record);
		const missing = missingRecommendedSettings(record.game.titleId, settings, this.platform);
		if (missing.length > 0 && decision === undefined) {
			return { ok: false, missingRecommended: missing };
		}
		if (decision === 'recommended') {
			settings = withRecommendedSettings(settings, this.platform);
		}
		const patch = this.cheatFile(record.game.titleId);
		const args = buildEmulatorArgs(
			{ settings, controller: this.settings.controller, basedir: record.game.basedir },
			this.platform,
			patch !== undefined && fileExists(patch) ? patch : undefined,
		);
		this.controller.update({ color: '', input: false, suspended: true });
		const started = this.runner.start(this.emulator.path, args, { gameId, title: record.game.title });
		if (!started.ok) {
			this.updateController();
			return { ok: false, error: started.error };
		}
		if (this.settings.prefs.last_selected_game !== record.game.gamePath) {
			void this.setPrefs({ last_selected_game: record.game.gamePath });
		}
		return { ok: true };
	}

	// ----- Trophies --------------------------------------------------------------------------------

	private trophyRequest(record: GameRecord) {
		const { settings } = this.effectiveSettings(record);
		return {
			key: record.game.id,
			base: record.game.basedir,
			titleId: record.game.titleId,
			userId: settings.user_id,
			consoleLanguage: settings.console_language,
		};
	}

	private async loadTrophySummaries(): Promise<void> {
		if (this.emulator.path === undefined || !this.emulator.queryAvailable || this.emulator.directory === undefined) {
			return;
		}
		const records = [...this.records.values()].filter((record) => record.hasTrophies);
		if (records.length === 0) {
			return;
		}
		const response = (await runQuery(
			this.emulator.path,
			'trophies',
			{ runtimeRoot: this.emulator.directory, iconDir: null, games: records.map((record) => this.trophyRequest(record)) },
			120_000,
		)) as { games?: { key: string; summary?: TrophySummary }[] } | undefined;
		for (const item of response?.games ?? []) {
			const record = this.records.get(item.key);
			if (record !== undefined && item.summary !== undefined && item.summary.total > 0) {
				record.game.trophies = item.summary;
			}
		}
		this.emitLibrary();
	}

	async getTrophies(gameId: string): Promise<TrophyGame> {
		const record = this.record(gameId);
		if (this.emulator.path === undefined || !this.emulator.queryAvailable || this.emulator.directory === undefined) {
			return { gameId, packages: [], errors: ['This emulator build cannot read trophies; update it.'] };
		}
		type RawTrophy = Omit<Trophy, 'icon' | 'unlockedAt'> & { icon: string | null; unlockedAtMs: number | null };
		type RawGame = { packages: (Omit<TrophyPackage, 'trophies'> & { trophies: RawTrophy[] })[]; errors?: string[]; summary?: TrophySummary };
		const iconDir = path.join(this.options.cacheDir, 'trophy-icons');
		const response = (await runQuery(
			this.emulator.path,
			'trophies',
			{ runtimeRoot: this.emulator.directory, iconDir, games: [this.trophyRequest(record)] },
			120_000,
		)) as { games?: RawGame[] } | undefined;
		const game = response?.games?.[0];
		if (game === undefined) {
			return { gameId, packages: [], errors: ['Could not read the trophy packages.'] };
		}
		const packages: TrophyPackage[] = game.packages.map((pkg) => ({
			...pkg,
			trophies: pkg.trophies.map(({ icon: iconFile, unlockedAtMs, ...trophy }) => {
				let icon: string | undefined;
				if (typeof iconFile === 'string') {
					const token = hash(iconFile);
					this.mediaFiles.set(`trophy/${token}.png`, iconFile);
					icon = `kyty://app/trophy/${token}.png`;
				}
				return { ...trophy, icon, unlockedAt: unlockedAtMs ?? undefined };
			}),
		}));
		if (game.summary !== undefined && game.summary.total > 0) {
			record.game.trophies = game.summary;
		}
		return { gameId, packages, errors: game.errors ?? [], summary: game.summary };
	}

	async getTrophyOverview(): Promise<TrophyGame[]> {
		await this.loadTrophySummaries();
		return this.order
			.map((id) => this.records.get(id)!)
			.filter((record) => record.game.trophies !== undefined && record.game.trophies.total > 0)
			.map((record) => ({ gameId: record.game.id, packages: [], errors: [], summary: record.game.trophies }));
	}

	hasTrophies(gameId: string): boolean {
		return this.records.get(gameId)?.hasTrophies === true;
	}

	// ----- Cheats ----------------------------------------------------------------------------------

	private cheatProcess(record: GameRecord): string {
		const { settings } = this.effectiveSettings(record);
		return path.basename(settings.elf.length > 0 ? settings.elf : 'eboot.bin');
	}

	async cheatsLocal(gameId: string): Promise<LocalCheats> {
		const record = this.record(gameId);
		const file = this.cheatFile(record.game.titleId);
		if (file === undefined) {
			return { exists: false, readable: false, error: 'Unsupported title ID.', mods: [] };
		}
		if (!fs.existsSync(file)) {
			this.cheatState.set(gameId, { data: Buffer.alloc(0), readable: true });
			return { path: file, exists: false, readable: true, mods: [] };
		}
		let data: Buffer;
		try {
			data = fs.readFileSync(file);
		} catch (error) {
			this.cheatState.set(gameId, { data: Buffer.alloc(0), readable: false });
			return { path: file, exists: true, readable: false, error: `Could not read cheat file: ${(error as Error).message}`, mods: [] };
		}
		const parsed = parseCheatDocument(data);
		this.cheatState.set(gameId, { data, document: parsed.document, readable: true });
		if (parsed.document === undefined) {
			return { path: file, exists: true, readable: true, error: parsed.error, mods: [] };
		}
		return { path: file, exists: true, readable: true, mods: cheatMods(parsed.document) };
	}

	async cheatsSave(gameId: string, enabled: boolean[]): Promise<SaveResult> {
		const record = this.record(gameId);
		const file = this.cheatFile(record.game.titleId);
		const state = this.cheatState.get(gameId);
		if (file === undefined || state?.document === undefined) {
			return { ok: false, error: 'Reload the cheats first.' };
		}
		const document = withSelection(state.document, enabled);
		if (document === undefined) {
			return { ok: false, error: 'Reload the cheats first.' };
		}
		const error = saveCheatDocument(file, document, state.data);
		if (error.length > 0) {
			return { ok: false, error };
		}
		this.cheatState.set(gameId, { data: fs.readFileSync(file), document, readable: true });
		record.game.hasCheatFile = true;
		return { ok: true };
	}

	async cheatsCatalog(gameId: string): Promise<{ files: RemoteCheat[]; error: string }> {
		const record = this.record(gameId);
		const catalog = await loadCheatCatalog(record.game.titleId, record.game.gameVersion);
		return {
			files: catalog.files.map((file) => ({ ...file, installed: file.version === record.game.gameVersion })),
			error: catalog.error,
		};
	}

	async cheatsPreview(gameId: string, name: string): Promise<CheatPreview> {
		const record = this.record(gameId);
		const format = name.slice(name.lastIndexOf('.') + 1);
		let data: Buffer;
		try {
			data = await fetchCheatFile({ name, format: format as 'json' });
		} catch (error) {
			return { error: (error as Error).message, mods: [], name: '', credits: '', version: '' };
		}
		const parsed = parseCheatDocument(data);
		if (parsed.document === undefined) {
			return { error: parsed.error, mods: [], name: '', credits: '', version: '' };
		}
		this.cheatPreviews.set(`${gameId}/${name}`, parsed.document);
		const root = parsed.document.root;
		const credits = Array.isArray(root.credits) ? root.credits.filter((item): item is string => typeof item === 'string') : [];
		const importError = validateImport(parsed.document, record.game.titleId, record.game.gameVersion, this.cheatProcess(record));
		return {
			importError: importError.length > 0 ? importError : undefined,
			mods: cheatMods(parsed.document).map((mod) => mod.name),
			name: typeof root.name === 'string' ? root.name : '',
			credits: credits.length > 0 ? credits.join(', ') : typeof root.author === 'string' ? root.author : '',
			version: typeof root.version === 'string' ? root.version : '',
		};
	}

	async cheatsImport(gameId: string, name: string): Promise<SaveResult> {
		const record = this.record(gameId);
		const document = this.cheatPreviews.get(`${gameId}/${name}`);
		const file = this.cheatFile(record.game.titleId);
		if (document === undefined || file === undefined) {
			return { ok: false, error: 'Preview the cheat file first.' };
		}
		const error = validateImport(document, record.game.titleId, record.game.gameVersion, this.cheatProcess(record));
		if (error.length > 0) {
			return { ok: false, error };
		}
		const state = this.cheatState.get(gameId) ?? (await this.cheatsLocal(gameId), this.cheatState.get(gameId));
		if (state === undefined || !state.readable) {
			return { ok: false, error: 'Could not read the local cheat file. Reload it before importing.' };
		}
		const mods = (document.root.mods as unknown[]).length;
		const selection = withSelection(document, new Array<boolean>(mods).fill(false))!;
		const saveError = saveCheatDocument(file, selection, state.data);
		if (saveError.length > 0) {
			return { ok: false, error: saveError };
		}
		record.game.hasCheatFile = true;
		await this.cheatsLocal(gameId);
		return { ok: true };
	}

	// ----- Compatibility, save data, folders ----------------------------------------------------------

	async setCompat(gameId: string, change: { status?: GameStatus; comment?: string }): Promise<SaveResult> {
		const record = this.record(gameId);
		if (!this.compat.local || record.game.titleId.trim().length === 0) {
			return { ok: false, error: 'Compatibility can only be edited with --local.' };
		}
		try {
			this.compat.set(record.game.titleId, change);
		} catch (error) {
			return { ok: false, error: (error as Error).message };
		}
		this.applyCompat();
		return { ok: true };
	}

	private saveRoots(): string[] {
		return [this.options.cwd, ...(this.emulator.directory === undefined ? [] : [this.emulator.directory])];
	}

	async saveDataDirs(gameId: string): Promise<string[]> {
		return saveDataDirs(this.record(gameId).game.titleId, this.saveRoots());
	}

	async removeSaveData(gameId: string): Promise<{ failed: string[] }> {
		if (this.runner.current.running) {
			return { failed: ['Stop the game first.'] };
		}
		return { failed: removeDirs(await this.saveDataDirs(gameId)) };
	}

	gameFolderTarget(gameId: string): { path: string; reveal: boolean } | undefined {
		const record = this.records.get(gameId);
		if (record === undefined) {
			return undefined;
		}
		return record.game.archive ? { path: record.game.basedir, reveal: true } : { path: record.game.basedir, reveal: false };
	}

	async listDir(dir: string | undefined, extensions?: string[]): Promise<DirListing> {
		return listDirectory(dir, this.platform, extensions);
	}

	// ----- Game config import / export -----------------------------------------------------------------

	async previewImport(file: string): Promise<ImportPreview> {
		let root: unknown;
		try {
			root = JSON.parse(fs.readFileSync(file, 'utf8'));
		} catch (error) {
			return { error: (error as Error).message, matched: [], unmatched: [] };
		}
		if (typeof root !== 'object' || root === null || Array.isArray(root) || Object.keys(root).length === 0) {
			return { error: 'Expected a JSON object containing game configs keyed by PPSA code.', matched: [], unmatched: [] };
		}
		const settings = root as Record<string, unknown>;
		for (const [key, value] of Object.entries(settings)) {
			const valid =
				/^PPSA[0-9]{5}$/.test(key) && typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length > 0;
			const check = valid ? applyGameSettings(defaultEmulatorSettings(), value as Record<string, unknown>, this.platform) : undefined;
			if (!valid || check === undefined || !check.ok) {
				return { error: `Invalid game config for ${key}. ${check !== undefined && !check.ok ? check.error : ''}`.trim(), matched: [], unmatched: [] };
			}
		}
		const imports: { gameId: string; settings: EmulatorSettings }[] = [];
		const matched: ImportPreview['matched'] = [];
		const unmatched = new Set(Object.keys(settings));
		for (const id of this.order) {
			const record = this.records.get(id)!;
			const titleId = record.game.titleId.trim().toUpperCase();
			if (!(titleId in settings)) {
				continue;
			}
			const result = applyGameSettings(this.effectiveSettings(record).settings, settings[titleId] as Record<string, unknown>, this.platform);
			if (!result.ok) {
				return { error: `Invalid game config for ${titleId}. ${result.error}`, matched: [], unmatched: [] };
			}
			imports.push({ gameId: id, settings: result.settings });
			matched.push({ titleId, title: record.game.title });
			unmatched.delete(titleId);
		}
		if (imports.length === 0) {
			return { matched, unmatched: [...unmatched] };
		}
		const token = crypto.randomUUID();
		this.pendingImports.set(token, imports);
		return { token, matched, unmatched: [...unmatched] };
	}

	async applyImport(token: string): Promise<SaveResult> {
		const imports = this.pendingImports.get(token);
		this.pendingImports.delete(token);
		if (imports === undefined) {
			return { ok: false, error: 'This import is no longer available.' };
		}
		const result = await this.writeSettings((doc) => {
			let configs = this.freshConfigs(doc);
			for (const item of imports) {
				const record = this.records.get(item.gameId);
				if (record === undefined) {
					continue;
				}
				configs = configs.filter((config) => config.game_path !== record.game.gamePath);
				configs.push({
					...item.settings,
					host_input_mapping: [...this.settings.global.host_input_mapping],
					name: record.game.title,
					basedir: record.game.basedir,
					game_path: record.game.gamePath,
				});
			}
			writeGameConfigs(doc, configs, this.platform);
		});
		this.refreshCustomFlags();
		return result;
	}

	async exportTargets(): Promise<{ gameId: string; titleId: string; title: string; gamePath: string }[]> {
		return this.order
			.map((id) => this.records.get(id)!)
			.filter((record) => record.game.hasCustomConfig && /^PPSA[0-9]{5}$/.test(record.game.titleId.trim().toUpperCase()))
			.map((record) => ({ gameId: record.game.id, titleId: record.game.titleId.trim().toUpperCase(), title: record.game.title, gamePath: record.game.gamePath }));
	}

	async exportGameConfig(gameId: string, file: string, overwrite: boolean): Promise<SaveResult & { exists?: boolean }> {
		const record = this.record(gameId);
		const config = this.findConfig(record.found);
		if (config === undefined) {
			return { ok: false, error: 'This game has no game config.' };
		}
		if (!overwrite && fs.existsSync(file)) {
			return { ok: false, exists: true, error: 'The file already exists.' };
		}
		const titleId = record.game.titleId.trim().toUpperCase();
		try {
			writeFileAtomic(file, `${JSON.stringify({ [titleId]: gameSettingsMap(config, this.platform) }, null, 4)}\n`);
		} catch (error) {
			return { ok: false, error: (error as Error).message };
		}
		return { ok: true };
	}

	// ----- Updates -------------------------------------------------------------------------------------

	async checkForUpdates(): Promise<UpdateResult> {
		if (!this.emulator.updateCheckSupported) {
			return { error: 'Update checks are only available in official release builds.' };
		}
		return checkForUpdates(this.emulator.releaseTag ?? '');
	}

	mediaFile(key: string): string | undefined {
		return this.mediaFiles.get(key);
	}

	normalizeDir(dir: string): string {
		return qtCleanPath(dir, this.platform);
	}

	isArchive(file: string): boolean {
		return isArchivePath(file);
	}
}

function readLimitedSize(file: string): boolean {
	try {
		const stat = fs.statSync(file);
		return stat.isFile() && stat.size <= MAX_IMAGE_SIZE;
	} catch {
		return false;
	}
}
