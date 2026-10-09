// Finds kyty_emulator like MainDialogPrivate::FindInterpreter (next to the launcher or one folder
// up), plus the layouts this launcher ships in: <install>/launcher-electron/ and, on macOS, next
// to KytyPS5.app so save data and cheats are shared with the Qt launcher.
import fs from 'node:fs';
import path from 'node:path';
import type { Platform } from '../../shared/settings';

export function emulatorExeName(platform: Platform): string {
	return platform === 'win32' ? 'kyty_emulator.exe' : 'kyty_emulator';
}

function isFile(file: string): boolean {
	try {
		return fs.statSync(file).isFile();
	} catch {
		return false;
	}
}

export function findEmulator(platform: Platform, launcherDir: string, override?: string): string | undefined {
	if (override !== undefined && override.length > 0) {
		return isFile(override) ? path.resolve(override) : undefined;
	}
	const exe = emulatorExeName(platform);
	const candidates: string[] = [];
	if (platform === 'darwin') {
		// launcherDir is ".../KytyPS5 Launcher.app/Contents/MacOS" when packaged.
		const appParent = path.resolve(launcherDir, '..', '..', '..');
		candidates.push(path.join(appParent, 'KytyPS5.app', 'Contents', 'MacOS', exe));
	}
	let dir = launcherDir;
	for (let depth = 0; depth < 4; depth++) {
		candidates.push(path.join(dir, exe));
		const parent = path.dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}
	return candidates.find(isFile);
}
