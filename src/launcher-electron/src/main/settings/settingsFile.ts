// Locates, locks, reads and atomically writes Kyty.ini, cooperating with Qt's QSettings, which
// locks the file with "<file>.lock" (QLockFile) and replaces it through a temporary file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Platform } from '../../shared/settings';
import { IniDocument } from './qsettingsIni';

export const SETTINGS_FILE_NAME = 'Kyty.ini';
const LOCK_STALE_MS = 30_000;
const LOCK_TIMEOUT_MS = 10_000;

export function defaultSettingsPath(platform: Platform, env: NodeJS.ProcessEnv = process.env): string {
	if (platform === 'win32') {
		const programData = env.ProgramData ?? env.ALLUSERSPROFILE ?? 'C:\\ProgramData';
		return path.win32.join(programData, 'Kyty', SETTINGS_FILE_NAME);
	}
	if (platform === 'darwin') {
		// QSettings::SystemScope with IniFormat in the official Qt macOS builds.
		return path.posix.join('/Library/Preferences/Qt', 'Kyty', SETTINGS_FILE_NAME);
	}
	const xdg = env.XDG_CONFIG_HOME;
	const base = xdg !== undefined && path.isAbsolute(xdg) ? xdg : path.join(env.HOME ?? os.homedir(), '.config');
	return path.join(base, 'Kyty', SETTINGS_FILE_NAME);
}

// The Qt launcher uses ./Kyty.ini when it exists ("portable" mode). This launcher also checks the
// emulator's folder because the packaged app runs from a subfolder of the install.
export function resolveSettingsPath(
	platform: Platform,
	cwd: string,
	emulatorDir: string | undefined,
	env: NodeJS.ProcessEnv = process.env,
): string {
	if (env.KYTY_SETTINGS_FILE !== undefined && env.KYTY_SETTINGS_FILE.length > 0) {
		return env.KYTY_SETTINGS_FILE;
	}
	const candidates = [path.join(cwd, SETTINGS_FILE_NAME)];
	if (emulatorDir !== undefined) {
		candidates.push(path.join(emulatorDir, SETTINGS_FILE_NAME));
	}
	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}
	return defaultSettingsPath(platform, env);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}

function lockIsStale(lockPath: string): boolean {
	try {
		const stat = fs.statSync(lockPath);
		if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
			return true;
		}
		const [pidText, , host] = fs.readFileSync(lockPath, 'utf8').split('\n');
		const pid = Number(pidText);
		return host === os.hostname() && Number.isInteger(pid) && pid > 0 && !processAlive(pid);
	} catch {
		return false;
	}
}

export async function withLock<T>(file: string, action: () => T | Promise<T>): Promise<T> {
	const lockPath = `${file}.lock`;
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const deadline = Date.now() + LOCK_TIMEOUT_MS;
	for (;;) {
		try {
			const fd = fs.openSync(lockPath, 'wx');
			fs.writeSync(fd, `${process.pid}\nkyty-launcher\n${os.hostname()}\n`);
			fs.closeSync(fd);
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
				throw error;
			}
			if (lockIsStale(lockPath)) {
				fs.rmSync(lockPath, { force: true });
				continue;
			}
			if (Date.now() > deadline) {
				throw new Error(`Settings file is locked: ${lockPath}`);
			}
			await sleep(50);
		}
	}
	try {
		return await action();
	} finally {
		fs.rmSync(lockPath, { force: true });
	}
}

export function readSettingsText(file: string): string {
	try {
		return fs.readFileSync(file, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return '';
		}
		throw error;
	}
}

export function writeFileAtomic(file: string, text: string): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const temp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
	const fd = fs.openSync(temp, 'w');
	try {
		fs.writeSync(fd, text);
		fs.fsyncSync(fd);
	} finally {
		fs.closeSync(fd);
	}
	try {
		fs.renameSync(temp, file);
	} catch (error) {
		fs.rmSync(temp, { force: true });
		throw error;
	}
}

// Re-reads the file under the lock, applies `change`, and writes it back.
export async function updateSettingsFile(
	file: string,
	platform: Platform,
	change: (doc: IniDocument) => void,
): Promise<IniDocument> {
	return withLock(file, () => {
		const doc = IniDocument.parse(readSettingsText(file));
		change(doc);
		writeFileAtomic(file, doc.serialize(platform === 'win32' ? '\r\n' : '\n'));
		return doc;
	});
}
