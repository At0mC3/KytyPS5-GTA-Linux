// Folder listings for the in-app file browser, which works with a controller where native
// dialogs do not. Read-only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Platform } from '../../shared/settings';
import type { DirEntry, DirListing } from '../../shared/types';

function exists(dir: string): boolean {
	try {
		return fs.statSync(dir).isDirectory();
	} catch {
		return false;
	}
}

export function rootFolders(platform: Platform): DirEntry[] {
	const home = os.homedir();
	const roots: DirEntry[] = [{ name: 'Home', path: home, directory: true }];
	if (platform === 'win32') {
		for (let code = 65; code <= 90; code++) {
			const drive = `${String.fromCharCode(code)}:\\`;
			if (exists(drive)) {
				roots.push({ name: drive, path: drive, directory: true });
			}
		}
		return roots;
	}
	roots.push({ name: 'Computer', path: '/', directory: true });
	const user = os.userInfo().username;
	const mounts = platform === 'darwin' ? ['/Volumes'] : [`/media/${user}`, `/run/media/${user}`, '/mnt', '/media'];
	for (const mount of mounts) {
		if (!exists(mount)) {
			continue;
		}
		let names: string[] = [];
		try {
			names = fs.readdirSync(mount);
		} catch {
			names = [];
		}
		for (const name of names) {
			const full = path.join(mount, name);
			if (exists(full) && !roots.some((root) => root.path === full)) {
				roots.push({ name, path: full, directory: true });
			}
		}
	}
	return roots;
}

export function listDirectory(dir: string | undefined, platform: Platform, extensions?: string[]): DirListing {
	const target = path.resolve(dir === undefined || dir.length === 0 ? os.homedir() : dir);
	const roots = rootFolders(platform);
	const parent = path.dirname(target) === target ? undefined : path.dirname(target);
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(target, { withFileTypes: true });
	} catch (error) {
		return { path: target, parent, entries: [], roots, error: (error as Error).message };
	}
	const wanted = extensions?.map((ext) => ext.toLowerCase().replace(/^\./, ''));
	const result: DirEntry[] = [];
	for (const entry of entries) {
		if (entry.name.startsWith('.')) {
			continue;
		}
		const full = path.join(target, entry.name);
		let directory = entry.isDirectory();
		if (entry.isSymbolicLink()) {
			directory = exists(full);
		}
		if (directory) {
			result.push({ name: entry.name, path: full, directory: true });
		} else if (wanted !== undefined && wanted.some((ext) => entry.name.toLowerCase().endsWith(`.${ext}`))) {
			result.push({ name: entry.name, path: full, directory: false });
		}
	}
	result.sort((a, b) => (a.directory !== b.directory ? (a.directory ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })));
	return { path: target, parent, entries: result, roots };
}
