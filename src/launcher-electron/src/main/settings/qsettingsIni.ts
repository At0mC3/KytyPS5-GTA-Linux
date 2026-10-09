// Reader and writer for the INI dialect Qt's QSettings (IniFormat) uses, so this launcher and the
// Qt launcher can share Kyty.ini. The escaping follows QSettingsPrivate::iniEscapedString,
// iniEscapedStringList, iniUnescapedStringList and iniEscapedKey in Qt 6 qsettings.cpp.
// Entries this launcher does not change keep their exact text.

// A decoded value: a string, a string list, null for "@Invalid()", or an opaque Qt type such as
// "@ByteArray(...)" kept verbatim.
export type IniValue = string | string[] | null | { opaque: string };

interface Entry {
	key: string;
	raw: string;
}

interface Section {
	name: string;
	entries: Entry[];
}

const GENERAL = 'General';

function isHexDigit(ch: string): boolean {
	return /^[0-9a-fA-F]$/.test(ch);
}

export function escapeKey(key: string): string {
	let out = '';
	for (const ch of key) {
		const code = ch.codePointAt(0) ?? 0;
		if (ch === '/') {
			out += '\\';
		} else if (/^[A-Za-z0-9_.-]$/.test(ch)) {
			out += ch;
		} else if (code <= 0xff) {
			out += `%${code.toString(16).toUpperCase().padStart(2, '0')}`;
		} else {
			for (let i = 0; i < ch.length; i++) {
				out += `%U${ch.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')}`;
			}
		}
	}
	return out;
}

export function unescapeKey(key: string): string {
	let out = '';
	for (let i = 0; i < key.length; i++) {
		const ch = key[i]!;
		if (ch === '\\') {
			out += '/';
		} else if (ch === '%' && key[i + 1] === 'U' && /^[0-9a-fA-F]{4}$/.test(key.slice(i + 2, i + 6))) {
			out += String.fromCharCode(parseInt(key.slice(i + 2, i + 6), 16));
			i += 5;
		} else if (ch === '%' && /^[0-9a-fA-F]{2}$/.test(key.slice(i + 1, i + 3))) {
			out += String.fromCharCode(parseInt(key.slice(i + 1, i + 3), 16));
			i += 2;
		} else {
			out += ch;
		}
	}
	return out;
}

const ESCAPES: Record<string, string> = {
	'\x07': 'a',
	'\b': 'b',
	'\f': 'f',
	'\n': 'n',
	'\r': 'r',
	'\t': 't',
	'\v': 'v',
	'"': '"',
	'\\': '\\',
};

export function escapeString(text: string): string {
	const useCodec = !(text.startsWith('@ByteArray(') || text.startsWith('@Variant(') || text.startsWith('@DateTime('));
	let needsQuotes = false;
	let escapeNextIfDigit = false;
	let out = '';
	for (const ch of text) {
		const code = ch.codePointAt(0) ?? 0;
		if (ch === ';' || ch === ',' || ch === '=') {
			needsQuotes = true;
		}
		if (escapeNextIfDigit && isHexDigit(ch)) {
			out += `\\x${code.toString(16)}`;
			continue;
		}
		escapeNextIfDigit = false;
		if (ch === '\0') {
			out += '\\0';
			escapeNextIfDigit = true;
		} else if (ESCAPES[ch] !== undefined) {
			out += `\\${ESCAPES[ch]}`;
		} else if (code <= 0x1f || (code >= 0x7f && !useCodec)) {
			out += `\\x${code.toString(16)}`;
			escapeNextIfDigit = true;
		} else {
			out += ch;
		}
	}
	if (needsQuotes || (out.length > 0 && (out.startsWith(' ') || out.endsWith(' ')))) {
		out = `"${out}"`;
	}
	return out;
}

// QSettingsPrivate::variantToString for strings: a leading '@' is doubled.
function stringToRaw(text: string): string {
	return escapeString(text.startsWith('@') ? `@${text}` : text);
}

export function encodeValue(value: IniValue): string {
	if (value === null) {
		return '@Invalid()';
	}
	if (typeof value === 'object' && !Array.isArray(value)) {
		return value.opaque;
	}
	if (Array.isArray(value)) {
		return value.length === 0 ? '@Invalid()' : value.map(stringToRaw).join(', ');
	}
	return stringToRaw(value);
}

function chopTrailingSpaces(text: string, limit: number): string {
	let end = text.length;
	while (end > limit && (text[end - 1] === ' ' || text[end - 1] === '\t')) {
		end--;
	}
	return text.slice(0, end);
}

const UNESCAPES: Record<string, string> = {
	a: '\x07',
	b: '\b',
	f: '\f',
	n: '\n',
	r: '\r',
	t: '\t',
	v: '\v',
	'"': '"',
	'?': '?',
	"'": "'",
	'\\': '\\',
};

// Port of QSettingsPrivate::iniUnescapedStringList. Returns a list when the value contains an
// unquoted comma.
export function unescapeValue(raw: string): string | string[] {
	let isList = false;
	let inQuotes = false;
	let quoted = false;
	let current = '';
	let chopLimit = 0;
	const list: string[] = [];
	let i = 0;

	const skipSpaces = () => {
		while (i < raw.length && (raw[i] === ' ' || raw[i] === '\t')) {
			i++;
		}
		chopLimit = current.length;
	};

	skipSpaces();
	while (i < raw.length) {
		const ch = raw[i]!;
		if (ch === '\\') {
			i++;
			if (i >= raw.length) {
				break;
			}
			const esc = raw[i++]!;
			if (UNESCAPES[esc] !== undefined) {
				current += UNESCAPES[esc];
			} else if (esc === 'x') {
				let value = 0;
				let digits = 0;
				while (i < raw.length && isHexDigit(raw[i]!)) {
					value = (value << 4) + parseInt(raw[i]!, 16);
					i++;
					digits++;
				}
				if (digits > 0) {
					current += String.fromCharCode(value & 0xffff);
				}
			} else if (/[0-7]/.test(esc)) {
				let value = parseInt(esc, 8);
				while (i < raw.length && /[0-7]/.test(raw[i]!)) {
					value = (value << 3) + parseInt(raw[i]!, 8);
					i++;
				}
				current += String.fromCharCode(value & 0xffff);
			} else if (esc === '\n' || esc === '\r') {
				const next = raw[i];
				if ((next === '\n' || next === '\r') && next !== esc) {
					i++;
				}
			}
			chopLimit = current.length;
		} else if (ch === '"') {
			i++;
			quoted = true;
			inQuotes = !inQuotes;
			if (!inQuotes) {
				skipSpaces();
			}
		} else if (ch === ',' && !inQuotes) {
			if (!quoted) {
				current = chopTrailingSpaces(current, chopLimit);
			}
			isList = true;
			list.push(current);
			current = '';
			quoted = false;
			i++;
			skipSpaces();
		} else {
			let j = i + 1;
			while (j < raw.length && raw[j] !== '\\' && raw[j] !== '"' && raw[j] !== ',') {
				j++;
			}
			current += raw.slice(i, j);
			i = j;
		}
	}
	if (!quoted) {
		current = chopTrailingSpaces(current, chopLimit);
	}
	if (isList) {
		list.push(current);
		return list;
	}
	return current;
}

// QSettingsPrivate::stringToVariant for one string.
function rawStringToValue(text: string): string | null | { opaque: string } {
	if (text.startsWith('@')) {
		if (text.startsWith('@@')) {
			return text.slice(1);
		}
		if (text === '@Invalid()') {
			return null;
		}
		if (/^@[A-Za-z]+\(/.test(text)) {
			return { opaque: text };
		}
	}
	return text;
}

export function decodeValue(raw: string): IniValue {
	const unescaped = unescapeValue(raw);
	if (Array.isArray(unescaped)) {
		return unescaped.map((item) => {
			const value = rawStringToValue(item);
			return typeof value === 'string' ? value : item;
		});
	}
	const value = rawStringToValue(unescaped);
	// Byte arrays and other Qt types keep their original encoded text.
	return typeof value === 'object' && value !== null ? { opaque: raw.trim() } : value;
}

// Splits the file into logical lines: a backslash before a line break continues the line, and a
// semicolon outside quotes starts a comment.
function logicalLines(text: string): string[] {
	const lines: string[] = [];
	let current = '';
	let inQuotes = false;
	let comment = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]!;
		if (ch === '\n' || ch === '\r') {
			if (!comment && inQuotes) {
				current += ch;
				continue;
			}
			lines.push(current);
			current = '';
			inQuotes = false;
			comment = false;
			continue;
		}
		if (comment) {
			continue;
		}
		if (ch === '\\' && i + 1 < text.length) {
			// Keep escapes whole; an escaped line break continues the value on the next line.
			let end = i + 2;
			const next = text[i + 1]!;
			if ((next === '\n' || next === '\r') && (text[end] === '\n' || text[end] === '\r') && text[end] !== next) {
				end++;
			}
			current += text.slice(i, end);
			i = end - 1;
			continue;
		}
		if (ch === '"') {
			inQuotes = !inQuotes;
		} else if (ch === ';' && !inQuotes) {
			comment = true;
			continue;
		}
		current += ch;
	}
	lines.push(current);
	return lines;
}

export class IniDocument {
	private sections: Section[] = [];

	static parse(text: string): IniDocument {
		const doc = new IniDocument();
		let section = doc.ensureSection(GENERAL);
		const body = text.startsWith('﻿') ? text.slice(1) : text;
		for (const line of logicalLines(body)) {
			const trimmed = line.trim();
			if (trimmed.length === 0) {
				continue;
			}
			if (trimmed.startsWith('[')) {
				const end = trimmed.indexOf(']');
				const name = unescapeKey(trimmed.slice(1, end < 0 ? undefined : end).trim());
				section = doc.ensureSection(name.length === 0 ? GENERAL : name);
				continue;
			}
			const eq = line.indexOf('=');
			if (eq < 0) {
				continue;
			}
			const key = unescapeKey(line.slice(0, eq).trim());
			if (key.length === 0) {
				continue;
			}
			const raw = line.slice(eq + 1);
			const existing = section.entries.find((entry) => entry.key === key);
			if (existing !== undefined) {
				existing.raw = raw;
			} else {
				section.entries.push({ key, raw });
			}
		}
		return doc;
	}

	private ensureSection(name: string): Section {
		let section = this.sections.find((item) => item.name === name);
		if (section === undefined) {
			section = { name, entries: [] };
			this.sections.push(section);
		}
		return section;
	}

	hasSection(name: string): boolean {
		return this.sections.some((item) => item.name === name && item.entries.length > 0);
	}

	// Keys directly in the section, excluding array or group children ("1/key").
	childKeys(sectionName: string): string[] {
		const section = this.sections.find((item) => item.name === sectionName);
		return section === undefined ? [] : section.entries.map((entry) => entry.key).filter((key) => !key.includes('/'));
	}

	keys(sectionName: string): string[] {
		const section = this.sections.find((item) => item.name === sectionName);
		return section === undefined ? [] : section.entries.map((entry) => entry.key);
	}

	getRaw(sectionName: string, key: string): string | undefined {
		return this.sections.find((item) => item.name === sectionName)?.entries.find((entry) => entry.key === key)?.raw;
	}

	// Returns undefined when the key is missing, like QSettings::contains() being false.
	get(sectionName: string, key: string): IniValue | undefined {
		const raw = this.getRaw(sectionName, key);
		return raw === undefined ? undefined : decodeValue(raw);
	}

	set(sectionName: string, key: string, value: IniValue): void {
		const section = this.ensureSection(sectionName);
		const raw = encodeValue(value);
		const entry = section.entries.find((item) => item.key === key);
		if (entry !== undefined) {
			entry.raw = raw;
		} else {
			section.entries.push({ key, raw });
		}
	}

	remove(sectionName: string, key: string): void {
		const section = this.sections.find((item) => item.name === sectionName);
		if (section !== undefined) {
			section.entries = section.entries.filter((entry) => entry.key !== key);
		}
	}

	clearSection(sectionName: string): void {
		const section = this.sections.find((item) => item.name === sectionName);
		if (section !== undefined) {
			section.entries = [];
		}
	}

	serialize(eol = '\n'): string {
		const blocks: string[] = [];
		for (const section of this.sections) {
			if (section.entries.length === 0) {
				continue;
			}
			const entries = [...section.entries].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
			const lines = [`[${escapeKey(section.name)}]`];
			for (const entry of entries) {
				lines.push(`${escapeKey(entry.key)}=${entry.raw}`);
			}
			blocks.push(lines.join(eol) + eol);
		}
		return blocks.join(eol);
	}
}
