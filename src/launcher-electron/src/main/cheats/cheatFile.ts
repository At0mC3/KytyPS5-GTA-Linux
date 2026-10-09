// Port of src/launcher/src/cheatFile.cpp: validation and saving of ETAHen cheat JSON files in
// <emulator>/_Patches/<TITLE_ID>.json.
import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from '../settings/settingsFile';

type JsonObject = Record<string, unknown>;

export interface CheatDocument {
	root: JsonObject;
}

export interface CheatMod {
	name: string;
	enabled: boolean;
}

function isObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isSupportedTitleId(titleId: string): boolean {
	return /^PPSA[0-9]{5}$/.test(titleId.trim().toUpperCase());
}

export function cheatPath(patchesRoot: string, titleId: string): string | undefined {
	if (!isSupportedTitleId(titleId)) {
		return undefined;
	}
	return path.join(patchesRoot, '_Patches', `${titleId.trim().toUpperCase()}.json`);
}

function validateDocument(root: unknown): string {
	if (!isObject(root)) {
		return 'Invalid cheat JSON.';
	}
	const mods = root.mods;
	if (!Array.isArray(mods)) {
		return 'Cheat JSON has no "mods" array.';
	}
	for (const mod of mods) {
		if (!isObject(mod) || typeof mod.name !== 'string' || mod.name.length === 0 || (mod.enabled !== undefined && typeof mod.enabled !== 'boolean')) {
			return 'Invalid cheat entry.';
		}
	}
	return '';
}

export function parseCheatDocument(data: Buffer | string): { document?: CheatDocument; error: string } {
	let root: unknown;
	try {
		root = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'));
	} catch {
		return { error: 'Invalid cheat JSON.' };
	}
	const error = validateDocument(root);
	return error.length > 0 ? { error } : { document: { root: root as JsonObject }, error: '' };
}

export function cheatMods(document: CheatDocument): CheatMod[] {
	return (document.root.mods as JsonObject[]).map((mod) => ({
		name: mod.name as string,
		enabled: mod.enabled === undefined ? true : (mod.enabled as boolean),
	}));
}

function same(a: unknown, b: string): boolean {
	return typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
}

export function validateImport(document: CheatDocument, titleId: string, version: string, processName: string): string {
	const parseError = validateDocument(document.root);
	if (parseError.length > 0) {
		return parseError;
	}
	const root = document.root;
	if (!isSupportedTitleId(titleId) || !same(root.id ?? '', titleId.trim())) {
		return "The cheat file does not match this game's title ID.";
	}
	if (version.length === 0 || root.version !== version) {
		return `The cheat file does not match this game's version (${version}).`;
	}
	if (processName.length === 0 || !same(root.process ?? '', processName)) {
		return `The cheat file does not match this game's executable (${processName}).`;
	}
	const mods = root.mods as JsonObject[];
	if (mods.length === 0) {
		return 'The cheat file contains no cheats.';
	}
	if ('master' in root) {
		return 'This JSON uses master codes, which are not supported yet.';
	}
	const offsetPattern = /^(?:0[xX])?[0-9a-fA-F]{1,16}$/;
	const bytesPattern = /^(?:[0-9a-fA-F]{2})+$/;
	for (const mod of mods) {
		const memory = mod.memory;
		if ('module_name' in mod) {
			return 'This JSON uses module-specific cheats, which are not supported yet.';
		}
		if (!Array.isArray(memory) || memory.length === 0) {
			return `Unsupported memory entries in cheat "${String(mod.name)}".`;
		}
		for (const entry of memory) {
			const write: JsonObject = isObject(entry) ? entry : {};
			const str = (key: string) => (typeof write[key] === 'string' ? (write[key] as string) : '');
			const off = str('off');
			if (
				(write.absolute !== undefined && write.absolute !== false) ||
				(write.expected !== undefined && (typeof write.expected !== 'string' || write.expected.toLowerCase() !== off.toLowerCase())) ||
				['section', 'sectionName', 'sectionProtection', 'logicalOffset', 'sectionOffset'].some((key) => key in write)
			) {
				return 'This JSON uses memory addressing features that are not supported yet.';
			}
			if (!isObject(entry) || !offsetPattern.test(str('offset')) || !bytesPattern.test(off) || !bytesPattern.test(str('on')) || off.length !== str('on').length) {
				return `Unsupported memory entries in cheat "${String(mod.name)}".`;
			}
		}
	}
	return '';
}

export function withSelection(document: CheatDocument, enabled: boolean[]): CheatDocument | undefined {
	const mods = document.root.mods as JsonObject[];
	if (mods.length !== enabled.length) {
		return undefined;
	}
	return { root: { ...document.root, mods: mods.map((mod, index) => ({ ...mod, enabled: enabled[index] })) } };
}

export function serializeCheatDocument(document: CheatDocument): string {
	return `${JSON.stringify(document.root, null, 4)}\n`;
}

// Refuses to replace a file changed since it was loaded; empty expected data allows creating it.
export function saveCheatDocument(file: string, document: CheatDocument, expected: Buffer): string {
	if (fs.existsSync(file)) {
		let current: Buffer;
		try {
			current = fs.readFileSync(file);
		} catch (error) {
			return `Could not read cheat file: ${(error as Error).message}`;
		}
		if (!current.equals(expected)) {
			return 'Cheat file changed; reload the cheats.';
		}
	} else if (expected.length > 0) {
		return 'Cheat file changed; reload the cheats.';
	}
	try {
		writeFileAtomic(file, serializeCheatDocument(document));
	} catch (error) {
		return `Could not save cheat file: ${(error as Error).message}`;
	}
	return '';
}
