// Electron entry point of the KytyPS5 launcher.
import path from 'node:path';
import { app, BrowserWindow, Menu, session, shell } from 'electron';
import { KYTY_EVENTS, type KytyEvents } from '../shared/api';
import type { Platform } from '../shared/settings';
import { registerIpc } from './ipc';
import { setFetchImplementation } from './net/fetch';
import { APP_ORIGIN, handleProtocol, registerScheme } from './protocol';
import { LauncherService } from './service';

function argValue(name: string): string | undefined {
	const prefix = `--${name}=`;
	for (let i = 0; i < process.argv.length; i++) {
		const arg = process.argv[i]!;
		if (arg.startsWith(prefix)) {
			return arg.slice(prefix.length);
		}
		if (arg === `--${name}` && i + 1 < process.argv.length && !process.argv[i + 1]!.startsWith('--')) {
			return process.argv[i + 1];
		}
	}
	return undefined;
}

const hasFlag = (name: string) => process.argv.includes(`--${name}`);
const platform = process.platform as Platform;
const testMode = process.env.KYTY_LAUNCHER_TEST === '1';
const selfTest = hasFlag('self-test');
const devUrl = process.env.ELECTRON_RENDERER_URL;

if (!testMode && !selfTest && !app.requestSingleInstanceLock()) {
	app.quit();
	process.exit(0);
}

registerScheme();

if (process.env.KYTY_USER_DATA !== undefined) {
	app.setPath('userData', process.env.KYTY_USER_DATA);
}

const launcherDir = app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath();
const service = new LauncherService({
	platform,
	cwd: process.cwd(),
	launcherDir,
	cacheDir: path.join(app.getPath('userData'), 'cache'),
	compatLocal: hasFlag('local'),
	emulatorOverride: argValue('emulator') ?? process.env.KYTY_EMULATOR,
	launcherVersion: app.getVersion(),
	testMode,
	gpuFeatures: () => (app.isReady() ? (app.getGPUFeatureStatus() as unknown as Record<string, string>) : {}),
});

// Render the UI on the GPU: rasterize on the GPU and upload images without extra copies.
switch (service.settings.prefs.gpu_acceleration) {
	case 'off':
		app.disableHardwareAcceleration();
		break;
	case 'force':
		app.commandLine.appendSwitch('ignore-gpu-blocklist');
		app.commandLine.appendSwitch('enable-gpu-rasterization');
		app.commandLine.appendSwitch('enable-zero-copy');
		break;
	default:
		app.commandLine.appendSwitch('enable-gpu-rasterization');
		app.commandLine.appendSwitch('enable-zero-copy');
		break;
}

let window: BrowserWindow | undefined;
let quitting = false;
let boundsTimer: NodeJS.Timeout | undefined;

function send<K extends keyof KytyEvents>(event: K, payload: KytyEvents[K]): void {
	if (window !== undefined && !window.isDestroyed()) {
		window.webContents.send(`kyty:event:${event}`, payload);
	}
}

function setFullscreen(value: boolean): void {
	if (window === undefined) {
		return;
	}
	window.setFullScreen(value);
}

const controls = {
	setFullscreen,
	toggleFullscreen: () => setFullscreen(!(window?.isFullScreen() ?? false)),
	quit: (stopGame: boolean) => {
		quitting = true;
		if (stopGame && service.runner.current.running) {
			service.runner.once('state', () => app.quit());
			service.runner.stop();
			return;
		}
		app.quit();
	},
	minimize: () => window?.minimize(),
};

function saveBounds(): void {
	clearTimeout(boundsTimer);
	boundsTimer = setTimeout(() => {
		if (window === undefined || window.isDestroyed() || window.isFullScreen() || window.isMinimized()) {
			return;
		}
		const maximized = window.isMaximized();
		const bounds = window.getNormalBounds();
		void service.saveWindow({ ...bounds, maximized });
	}, 800);
}

function createWindow(): void {
	const bounds = service.settings.window;
	const startFullscreen = hasFlag('fullscreen') || service.settings.prefs.fullscreen;
	window = new BrowserWindow({
		x: bounds.x,
		y: bounds.y,
		width: bounds.width,
		height: bounds.height,
		minWidth: 960,
		minHeight: 540,
		show: false,
		backgroundColor: '#03060d',
		title: 'KytyPS5',
		icon: path.join(__dirname, '../../resources/icon.png'),
		autoHideMenuBar: true,
		fullscreen: startFullscreen,
		webPreferences: {
			preload: path.join(__dirname, '../preload/index.js'),
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			spellcheck: false,
		},
	});
	service.fullscreen = startFullscreen;
	if (bounds.maximized && !startFullscreen) {
		window.maximize();
	}
	if (platform !== 'darwin') {
		window.removeMenu();
	}

	window.once('ready-to-show', () => window?.show());
	window.on('enter-full-screen', () => {
		service.fullscreen = true;
		service.emitState();
		void service.setPrefs({ fullscreen: true });
	});
	window.on('leave-full-screen', () => {
		service.fullscreen = false;
		service.emitState();
		void service.setPrefs({ fullscreen: false });
	});
	window.on('resize', saveBounds);
	window.on('move', saveBounds);
	window.on('close', (event) => {
		if (!quitting && service.runner.current.running) {
			event.preventDefault();
			send('confirmQuit', undefined);
		}
	});
	window.webContents.on('before-input-event', (event, input) => {
		if (input.type === 'keyDown' && input.key === 'F11') {
			event.preventDefault();
			controls.toggleFullscreen();
		}
	});
	window.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith('https://')) {
			void shell.openExternal(url);
		}
		return { action: 'deny' };
	});
	window.webContents.on('will-navigate', (event, url) => {
		if (!url.startsWith(APP_ORIGIN) && (devUrl === undefined || !url.startsWith(devUrl))) {
			event.preventDefault();
		}
	});

	if (devUrl !== undefined) {
		void window.loadURL(devUrl);
	} else {
		void window.loadURL(`${APP_ORIGIN}/index.html`);
	}
}

function bringBack(): void {
	if (window === undefined || window.isDestroyed()) {
		return;
	}
	if (window.isMinimized()) {
		window.restore();
	}
	window.show();
	window.focus();
}

for (const event of KYTY_EVENTS) {
	(service.on as (name: string, listener: (payload: unknown) => void) => void).call(service, event, (payload) => send(event, payload as never));
}
service.on('run', (state) => {
	if (!state.running) {
		bringBack();
	}
});

app.on('second-instance', bringBack);

app.whenReady().then(async () => {
	setFetchImplementation((input, init) => (testMode ? fetch(input, init) : session.defaultSession.fetch(input, init)));
	session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
	handleProtocol(path.join(__dirname, '../renderer'), (key) => service.mediaFile(key));
	registerIpc(service, controls, devUrl);
	if (platform === 'darwin') {
		Menu.setApplicationMenu(
			Menu.buildFromTemplate([
				{ role: 'appMenu' },
				{ role: 'editMenu' },
				{ label: 'View', submenu: [{ role: 'togglefullscreen' }] },
			]),
		);
	}
	if (selfTest) {
		await service.start();
		process.stdout.write(
			`${JSON.stringify({ emulator: service.emulator, settingsFile: service.settingsFile, games: service.library().length, gpu: app.getGPUFeatureStatus() })}\n`,
		);
		service.dispose();
		app.exit(0);
		return;
	}
	createWindow();
	await service.start();
});

app.on('before-quit', () => {
	quitting = true;
	service.dispose();
});

app.on('window-all-closed', () => {
	app.quit();
});
