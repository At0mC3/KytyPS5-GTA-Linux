// Save data folders of a game: _SaveData/<TITLE_ID> under the working folder, the emulator folder,
// and their parents, like GetSaveDataDirs in src/launcher/src/configurationListWidget.cpp.
import fs from 'node:fs';
import path from 'node:path';

export function saveDataDirs(titleId: string, roots: string[]): string[] {
	const id = titleId.trim();
	if (id.length === 0) {
		return [];
	}
	const candidates: string[] = [];
	for (const root of roots) {
		candidates.push(root);
	}
	for (const root of roots) {
		const parent = path.dirname(root);
		if (parent !== root) {
			candidates.push(parent);
		}
	}
	const result: string[] = [];
	const seen = new Set<string>();
	for (const root of candidates) {
		const dir = path.resolve(root, '_SaveData', id);
		let stat: fs.Stats;
		try {
			stat = fs.statSync(dir);
		} catch {
			continue;
		}
		if (!stat.isDirectory()) {
			continue;
		}
		let canonical = dir;
		try {
			canonical = fs.realpathSync.native(dir);
		} catch {
			// Keep the absolute path.
		}
		if (!seen.has(canonical)) {
			seen.add(canonical);
			result.push(dir);
		}
	}
	return result;
}

export function removeDirs(dirs: string[]): string[] {
	const failed: string[] = [];
	for (const dir of dirs) {
		try {
			fs.rmSync(dir, { recursive: true, force: true });
		} catch {
			failed.push(dir);
		}
	}
	return failed;
}
