// Finds games in the configured folders like ConfigurationListWidget::ScanGameDirectory
// (src/launcher/src/configurationListWidget.cpp): .zar archives directly in any scanned folder,
// and folders containing eboot.bin, searched breadth-first without descending into games.
import fs from 'node:fs';
import path from 'node:path';
import type { Platform } from '../../shared/settings';
import { isArchivePath, pathKey, qtCleanPath } from './paths';

export interface FoundGame {
	// Launcher-unique path, also the key of the per-game config.
	gamePath: string;
	// The folder or archive the emulator loads.
	basedir: string;
	// Path relative to the game folder; older Qt launchers keyed per-game configs by it.
	legacyGamePath: string;
	// Folder name, or archive name without its last extension.
	fallbackTitle: string;
	archive: boolean;
}

function isHidden(name: string): boolean {
	return name.startsWith('.');
}

function listEntries(dir: string): fs.Dirent[] {
	try {
		return fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
}

function caseInsensitiveCompare(a: string, b: string): number {
	const la = a.toLowerCase();
	const lb = b.toLowerCase();
	return la < lb ? -1 : la > lb ? 1 : a < b ? -1 : a > b ? 1 : 0;
}

function subdirectories(dir: string): string[] {
	return listEntries(dir)
		.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !isHidden(entry.name))
		.map((entry) => entry.name)
		.sort(caseInsensitiveCompare)
		.map((name) => path.join(dir, name));
}

function archives(dir: string): string[] {
	return listEntries(dir)
		.filter((entry) => entry.isFile() && !entry.isSymbolicLink() && !isHidden(entry.name) && isArchivePath(entry.name))
		.map((entry) => entry.name)
		.sort()
		.map((name) => path.join(dir, name));
}

function relativeQtPath(root: string, target: string, platform: Platform): string {
	const rel = (platform === 'win32' ? path.win32 : path.posix).relative(root, target);
	return rel.replace(/\\/g, '/');
}

export function scanGameFolders(
	gameDirs: string[],
	platform: Platform,
	archiveHasEboot: (archive: string) => boolean = () => true,
): FoundGame[] {
	const found: FoundGame[] = [];
	const seen = new Set<string>();

	const add = (game: FoundGame) => {
		const key = pathKey(game.gamePath, platform);
		if (key.length === 0 || seen.has(key)) {
			return;
		}
		if (game.archive && !archiveHasEboot(game.basedir)) {
			return;
		}
		seen.add(key);
		found.push(game);
	};

	const scanArchives = (dir: string, root: string) => {
		for (const archive of archives(dir)) {
			const base = qtCleanPath(archive, platform);
			const name = path.basename(archive);
			add({
				gamePath: base,
				basedir: base,
				legacyGamePath: relativeQtPath(root, base, platform),
				fallbackTitle: name.slice(0, name.lastIndexOf('.')),
				archive: true,
			});
		}
	};

	for (const rootPath of gameDirs) {
		if (rootPath.length === 0 || !fs.existsSync(rootPath)) {
			continue;
		}
		const root = qtCleanPath(rootPath, platform);
		scanArchives(root, root);
		const pending = subdirectories(root);
		while (pending.length > 0) {
			const dir = pending.shift()!;
			scanArchives(dir, root);
			if (fs.existsSync(path.join(dir, 'eboot.bin'))) {
				const gamePath = qtCleanPath(dir, platform);
				add({
					gamePath,
					basedir: gamePath,
					legacyGamePath: relativeQtPath(root, gamePath, platform),
					fallbackTitle: path.basename(dir),
					archive: false,
				});
				continue;
			}
			pending.push(...subdirectories(dir));
		}
	}
	return found;
}

// Recursive size of a folder game, or the size of an archive file.
export async function gameSize(basedir: string, archive: boolean): Promise<number> {
	if (archive) {
		return (await fs.promises.stat(basedir)).size;
	}
	let total = 0;
	const stack = [basedir];
	while (stack.length > 0) {
		const dir = stack.pop()!;
		let entries: fs.Dirent[];
		try {
			entries = await fs.promises.readdir(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isSymbolicLink()) {
				continue;
			}
			if (entry.isDirectory()) {
				stack.push(full);
			} else if (entry.isFile()) {
				try {
					total += (await fs.promises.stat(full)).size;
				} catch {
					// Skip files that disappear during the scan.
				}
			}
		}
	}
	return total;
}
