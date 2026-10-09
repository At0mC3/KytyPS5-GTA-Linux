// QVariant conversions as Qt applies them to values read from an INI file. A missing key is
// undefined; "@Invalid()" is null.
import type { IniValue } from './qsettingsIni';

export type Raw = IniValue | undefined;

function plain(value: Raw): string | string[] | null | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? value.opaque : value;
}

export function toQString(value: Raw): string {
	const v = plain(value);
	if (typeof v === 'string') {
		return v;
	}
	// QStringList converts to QString only when it has exactly one item.
	return Array.isArray(v) && v.length === 1 ? v[0]! : '';
}

export function toQBool(value: Raw): boolean {
	const v = plain(value);
	if (typeof v !== 'string') {
		return false;
	}
	return !(v.length === 0 || v === '0' || v.toLowerCase() === 'false');
}

export function toQInt(value: Raw): { ok: boolean; value: number } {
	const v = plain(value);
	const text = typeof v === 'string' ? v : Array.isArray(v) && v.length === 1 ? v[0]! : undefined;
	if (text === undefined) {
		return { ok: false, value: 0 };
	}
	const trimmed = text.trim();
	if (!/^[+-]?\d+$/.test(trimmed)) {
		return { ok: false, value: 0 };
	}
	const parsed = Number(trimmed);
	if (!Number.isSafeInteger(parsed) || parsed < -2147483648 || parsed > 2147483647) {
		return { ok: false, value: 0 };
	}
	return { ok: true, value: parsed };
}

export function toQStringList(value: Raw): string[] {
	const v = plain(value);
	if (Array.isArray(v)) {
		return [...v];
	}
	return typeof v === 'string' ? [v] : [];
}

// QVariant::value<Enum>(): the key name, or its number; anything else becomes the first value.
// Returns undefined for a number outside the enum, which Qt keeps as an invalid value.
export function toQEnum<T extends string>(value: Raw, keys: readonly T[]): T | undefined {
	const v = plain(value);
	const text = typeof v === 'string' ? v : Array.isArray(v) && v.length === 1 ? v[0]! : undefined;
	if (text === undefined) {
		return keys[0]!;
	}
	const index = keys.indexOf(text as T);
	if (index >= 0) {
		return keys[index]!;
	}
	const number = toQInt(text);
	if (number.ok) {
		return keys[number.value];
	}
	return keys[0]!;
}

// QColor(text).name(): "#rrggbb" for the hex forms QColor accepts, or "" when invalid.
export function normalizeColor(text: string): string {
	const value = text.trim().toLowerCase();
	const hex = value.startsWith('#') ? value.slice(1) : '';
	if (!/^[0-9a-f]+$/.test(hex)) {
		return '';
	}
	const component = (part: string) => {
		const max = 16 ** part.length - 1;
		return Math.round((parseInt(part, 16) * 255) / max)
			.toString(16)
			.padStart(2, '0');
	};
	switch (hex.length) {
		case 3:
			return `#${[...hex].map((c) => c + c).join('')}`;
		case 6:
			return `#${hex}`;
		case 8:
			return `#${hex.slice(2)}`;
		case 9:
			return `#${component(hex.slice(0, 3))}${component(hex.slice(3, 6))}${component(hex.slice(6, 9))}`;
		case 12:
			return `#${component(hex.slice(0, 4))}${component(hex.slice(4, 8))}${component(hex.slice(8, 12))}`;
		default:
			return '';
	}
}
