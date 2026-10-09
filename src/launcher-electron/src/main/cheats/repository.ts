// Port of src/launcher/src/cheatRepository.cpp: lists cheat files for a title from the
// TeeKay87/HEN-Cheats-Collection index files.
import { fetchLimited } from '../net/fetch';

export const CHEAT_FORMATS = ['json', 'mc4', 'shn'] as const;
export type CheatFormat = (typeof CHEAT_FORMATS)[number];

const INDEX_LIMIT = 2 * 1024 * 1024;
const FILE_LIMIT = 8 * 1024 * 1024;

export function cheatsBaseUrl(): string {
	return process.env.KYTY_CHEATS_BASE_URL ?? 'https://raw.githubusercontent.com/TeeKay87/HEN-Cheats-Collection/master/cheats/';
}

export interface RemoteCheatFile {
	name: string;
	title: string;
	version: string;
	format: CheatFormat;
	supported: boolean;
}

const NAME_PATTERN = /^([A-Z]{4}[0-9]{5})_([0-9]+(?:\.[0-9]+)+)_[A-Za-z0-9_.-]+\.(json|mc4|shn)$/;

export function remoteFileUrl(file: Pick<RemoteCheatFile, 'name' | 'format'>): string | undefined {
	const match = NAME_PATTERN.exec(file.name);
	if (!CHEAT_FORMATS.includes(file.format) || match === null || match[3] !== file.format) {
		return undefined;
	}
	return `${cheatsBaseUrl()}${file.format}/${file.name}`;
}

export function parseCheatIndex(data: string, format: CheatFormat, titleId: string): { files: RemoteCheatFile[]; error: string } {
	if (data.length === 0 || data.length > INDEX_LIMIT) {
		return { files: [], error: 'Invalid cheat index.' };
	}
	const id = titleId.trim().toUpperCase();
	const text = data.startsWith('﻿') ? data.slice(1) : data;
	const seen = new Set<string>();
	const files: RemoteCheatFile[] = [];
	let invalid = 0;
	for (const line of text.split('\n')) {
		const trimmed = line.trim();
		if (trimmed.length === 0) {
			continue;
		}
		const separator = trimmed.indexOf('=');
		const name = separator < 0 ? trimmed : trimmed.slice(0, separator);
		const match = NAME_PATTERN.exec(name);
		if (separator < 0 || match === null || match[3] !== format) {
			invalid++;
			continue;
		}
		if (match[1] !== id || seen.has(name)) {
			continue;
		}
		seen.add(name);
		files.push({ name, title: trimmed.slice(separator + 1).trim(), version: match[2]!, format, supported: format === 'json' });
	}
	return { files, error: invalid > 0 ? `Skipped ${invalid} invalid cheat index entries.` : '' };
}

// Newest first (compared as text, like Qt), then the installed version on top.
export function sortCheatFiles(files: RemoteCheatFile[], installedVersion: string): RemoteCheatFile[] {
	const sorted = [...files].sort((a, b) => {
		if (a.version !== b.version) {
			return a.version > b.version ? -1 : 1;
		}
		if (a.format !== b.format) {
			return a.format < b.format ? -1 : 1;
		}
		return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
	});
	return sorted.sort((a, b) => Number(b.version === installedVersion) - Number(a.version === installedVersion));
}

export async function loadCheatCatalog(titleId: string, installedVersion: string): Promise<{ files: RemoteCheatFile[]; error: string }> {
	const results = await Promise.all(
		CHEAT_FORMATS.map(async (format) => {
			try {
				const data = await fetchLimited(`${cheatsBaseUrl()}${format}.txt`, { limit: INDEX_LIMIT, sameOrigin: true });
				const parsed = parseCheatIndex(data.toString('utf8'), format, titleId);
				return { files: parsed.files, error: parsed.error.length > 0 ? `${format.toUpperCase()}: ${parsed.error}` : '' };
			} catch (error) {
				return { files: [], error: `${format.toUpperCase()}: ${(error as Error).message}` };
			}
		}),
	);
	return {
		files: sortCheatFiles(results.flatMap((result) => result.files), installedVersion),
		error: results
			.map((result) => result.error)
			.filter((error) => error.length > 0)
			.join('\n'),
	};
}

export async function fetchCheatFile(file: Pick<RemoteCheatFile, 'name' | 'format'>): Promise<Buffer> {
	const url = remoteFileUrl(file);
	if (url === undefined || file.format !== 'json') {
		throw new Error('Only JSON cheat files are supported.');
	}
	return fetchLimited(url, { limit: FILE_LIMIT, sameOrigin: true });
}
