// Routes the UI's window.kyty calls to the launcher service.
import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { KYTY_METHODS, type KytyMethods } from '../shared/api';
import type { SaveResult } from '../shared/types';
import type { LauncherService } from './service';

export interface WindowControls {
	setFullscreen(value: boolean): void;
	toggleFullscreen(): void;
	quit(stopGame: boolean): void;
	minimize(): void;
}

function isTrustedSender(event: IpcMainInvokeEvent, devUrl: string | undefined): boolean {
	const url = event.senderFrame?.url ?? '';
	return url.startsWith('kyty://app/') || (devUrl !== undefined && url.startsWith(devUrl));
}

export function registerIpc(service: LauncherService, controls: WindowControls, devUrl: string | undefined): void {
	const window = () => BrowserWindow.getAllWindows()[0];
	const handlers: KytyMethods = {
		getState: async () => service.state(),
		getLibrary: async () => service.library(),
		rescan: () => service.rescan(),
		refreshEmulator: () => service.refreshEmulator(),
		getGameSettings: (gameId) => service.getGameSettings(gameId),
		saveGameSettings: (gameId, settings) => service.saveGameSettings(gameId, settings),
		clearGameSettings: (gameId) => service.clearGameSettings(gameId),
		saveGlobalSettings: (input) => service.saveGlobalSettings(input),
		setPrefs: (prefs) => service.setPrefs(prefs),
		setCheckUpdatesOnStartup: (value) => service.setCheckUpdatesOnStartup(value),
		previewLightbar: (color) => service.previewLightbar(color),
		launch: async (gameId, decision) => {
			const result = await service.launch(gameId, decision);
			if (result.ok && service.settings.prefs.minimize_on_launch && !service.state().testMode) {
				window()?.minimize();
			}
			return result;
		},
		stopGame: async () => service.runner.stop(),
		getRunState: async () => service.runner.current,
		getLog: async () => service.runner.log,
		getTrophies: (gameId) => service.getTrophies(gameId),
		getTrophyOverview: () => service.getTrophyOverview(),
		cheatsLocal: (gameId) => service.cheatsLocal(gameId),
		cheatsSave: (gameId, enabled) => service.cheatsSave(gameId, enabled),
		cheatsCatalog: (gameId) => service.cheatsCatalog(gameId),
		cheatsPreview: (gameId, name) => service.cheatsPreview(gameId, name),
		cheatsImport: (gameId, name) => service.cheatsImport(gameId, name),
		setCompat: (gameId, change) => service.setCompat(gameId, change),
		saveDataDirs: (gameId) => service.saveDataDirs(gameId),
		removeSaveData: (gameId) => service.removeSaveData(gameId),
		openGameFolder: async (gameId): Promise<SaveResult> => {
			const target = service.gameFolderTarget(gameId);
			if (target === undefined) {
				return { ok: false, error: 'Unknown game.' };
			}
			if (target.reveal) {
				shell.showItemInFolder(target.path);
				return { ok: true };
			}
			const error = await shell.openPath(target.path);
			return error.length > 0 ? { ok: false, error } : { ok: true };
		},
		listDir: (dir, extensions) => service.listDir(dir, extensions),
		showOpenDialog: async (options) => {
			const parent = window();
			const dialogOptions: Electron.OpenDialogOptions = {
				title: options.title,
				defaultPath: options.defaultPath,
				filters: options.filters,
				properties: [options.directory === true ? 'openDirectory' : 'openFile', ...(options.multiple === true ? (['multiSelections'] as const) : [])],
			};
			const result = parent === undefined ? await dialog.showOpenDialog(dialogOptions) : await dialog.showOpenDialog(parent, dialogOptions);
			return result.canceled ? [] : result.filePaths;
		},
		showSaveDialog: async (options) => {
			const parent = window();
			const dialogOptions: Electron.SaveDialogOptions = { title: options.title, defaultPath: options.defaultPath, filters: options.filters };
			const result = parent === undefined ? await dialog.showSaveDialog(dialogOptions) : await dialog.showSaveDialog(parent, dialogOptions);
			return result.canceled ? undefined : result.filePath;
		},
		previewImport: (file) => service.previewImport(file),
		applyImport: (token) => service.applyImport(token),
		exportTargets: () => service.exportTargets(),
		exportGameConfig: (gameId, file, overwrite) => service.exportGameConfig(gameId, file, overwrite),
		checkForUpdates: () => service.checkForUpdates(),
		openExternal: async (url) => {
			if (/^https:\/\//.test(url)) {
				await shell.openExternal(url);
			}
		},
		setFullscreen: async (value) => controls.setFullscreen(value),
		toggleFullscreen: async () => controls.toggleFullscreen(),
		quit: async (stopGame) => controls.quit(stopGame),
		minimize: async () => controls.minimize(),
	};

	for (const method of KYTY_METHODS) {
		ipcMain.handle(`kyty:${method}`, (event, ...args: unknown[]) => {
			if (!isTrustedSender(event, devUrl)) {
				throw new Error('Untrusted sender');
			}
			const handler = handlers[method] as (...params: unknown[]) => Promise<unknown>;
			return handler(...args);
		});
	}
}
