// Port of src/launcher/src/compatibilityDatabase.cpp. Statuses come from the KytyPS5 website,
// or from ./compatibility_db.json with the --local flag, which also makes them editable.
import fs from 'node:fs';
import path from 'node:path';
import type { GameStatus } from '../../shared/types';
import { fetchLimited } from '../net/fetch';
import { writeFileAtomic } from '../settings/settingsFile';

export interface CompatEntry {
	status: GameStatus;
	comment: string;
}

const LOCAL_FILE = 'compatibility_db.json';
const RETRIES = 3;
const RETRY_DELAY_MS = 750;

function compatUrl(): string {
	return process.env.KYTY_COMPAT_URL ?? 'https://kytyps5.github.io/data/compatibility.json';
}

export function statusFromText(text: unknown): GameStatus {
	const value = typeof text === 'string' ? text.trim() : '';
	if (value === 'InGame' || value === 'In game') return 'InGame';
	if (value === 'MainMenu' || value === 'Main menu') return 'MainMenu';
	if (value === 'Logo') return 'Logo';
	if (value === 'DoesntBoot' || value === "Doesn't boot") return 'DoesntBoot';
	return 'Unknown';
}

export function parseCompat(data: string): Map<string, CompatEntry> {
	const root: unknown = JSON.parse(data);
	if (typeof root !== 'object' || root === null || Array.isArray(root)) {
		throw new Error('Invalid compatibility JSON');
	}
	const entries = new Map<string, CompatEntry>();
	for (const [key, value] of Object.entries(root as Record<string, unknown>)) {
		const titleId = key.trim().toUpperCase();
		if (titleId.length === 0 || typeof value !== 'object' || value === null || Object.keys(value).length === 0) {
			continue;
		}
		const entry = value as Record<string, unknown>;
		entries.set(titleId, { status: statusFromText(entry.status), comment: typeof entry.comment === 'string' ? entry.comment : '' });
	}
	return entries;
}

export class CompatibilityDatabase {
	private entries = new Map<string, CompatEntry>();

	constructor(
		readonly local: boolean,
		private readonly cwd: string,
	) {}

	private get localFile(): string {
		return path.join(this.cwd, LOCAL_FILE);
	}

	find(titleId: string): CompatEntry | undefined {
		return this.entries.get(titleId.trim().toUpperCase());
	}

	async load(): Promise<void> {
		if (this.local) {
			if (fs.existsSync(this.localFile)) {
				this.entries = parseCompat(fs.readFileSync(this.localFile, 'utf8'));
			}
			return;
		}
		let lastError: unknown;
		for (let attempt = 0; attempt <= RETRIES; attempt++) {
			if (attempt > 0) {
				await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
			}
			try {
				const data = await fetchLimited(compatUrl(), { limit: 16 * 1024 * 1024, timeoutMs: 15_000, overallTimeoutMs: 15_000 });
				this.entries = parseCompat(data.toString('utf8'));
				return;
			} catch (error) {
				lastError = error;
			}
		}
		throw lastError;
	}

	set(titleId: string, change: Partial<CompatEntry>): void {
		const key = titleId.trim().toUpperCase();
		if (!this.local || key.length === 0) {
			return;
		}
		const entry = this.entries.get(key) ?? { status: 'Unknown', comment: '' };
		this.entries.set(key, { ...entry, ...change });
		const root: Record<string, CompatEntry> = {};
		for (const id of [...this.entries.keys()].sort()) {
			root[id] = this.entries.get(id)!;
		}
		writeFileAtomic(this.localFile, `${JSON.stringify(root, null, 4)}\n`);
	}
}
