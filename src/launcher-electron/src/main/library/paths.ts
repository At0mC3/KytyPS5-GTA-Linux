// Path handling that matches the Qt launcher, which stores Qt-style paths in Kyty.ini:
// absolute, cleaned, '/' separators, no trailing separator.
import fs from 'node:fs';
import path from 'node:path';
import type { Platform } from '../../shared/settings';

export function qtCleanPath(input: string, platform: Platform, cwd = process.cwd()): string {
	const trimmed = input.trim();
	if (trimmed.length === 0) {
		return '';
	}
	if (platform === 'win32') {
		let resolved = path.win32.resolve(cwd, trimmed).replace(/\\/g, '/');
		if (/^[a-z]:/.test(resolved)) {
			resolved = resolved[0]!.toUpperCase() + resolved.slice(1);
		}
		return resolved.length > 3 ? resolved.replace(/\/+$/, '') : resolved;
	}
	return path.posix.resolve(cwd, trimmed);
}

// QDir::toNativeSeparators() for paths shown or passed to the OS.
export function toNative(p: string, platform: Platform): string {
	return platform === 'win32' ? p.replace(/\//g, '\\') : p;
}

// PathKey(): canonical path, case-folded except on Linux.
export function pathKey(input: string, platform: Platform): string {
	const normalized = qtCleanPath(input, platform);
	if (normalized.length === 0) {
		return '';
	}
	let canonical = normalized;
	try {
		canonical = qtCleanPath(fs.realpathSync.native(normalized), platform);
	} catch {
		// Missing paths keep their normalized form.
	}
	return platform === 'linux' ? canonical : canonical.toLowerCase();
}

export function normalizeGameDirectories(dirs: string[], platform: Platform): string[] {
	const result: string[] = [];
	const seen = new Set<string>();
	for (const dir of dirs) {
		const normalized = qtCleanPath(dir, platform);
		const key = pathKey(normalized, platform);
		if (normalized.length === 0 || key.length === 0 || seen.has(key)) {
			continue;
		}
		seen.add(key);
		result.push(normalized);
	}
	return result;
}

export function isArchivePath(p: string): boolean {
	return /\.zar$/i.test(p);
}

export function sameGamePath(a: string, b: string, platform: Platform): boolean {
	return platform === 'linux' ? a === b : a.toLowerCase() === b.toLowerCase();
}
