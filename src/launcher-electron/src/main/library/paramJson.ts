// Reads sce_sys/param.json like GetGameMetadata in src/launcher/src/configurationListWidget.cpp.
export interface GameMetadata {
	title: string;
	titleId: string;
	gameVersion: string;
	firmwareVersion: string;
}

export const MAX_METADATA_SIZE = 1 << 20;
export const MAX_IMAGE_SIZE = 32 << 20;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(obj: unknown, key: string): string {
	if (!isObject(obj)) {
		return '';
	}
	const value = obj[key];
	return typeof value === 'string' ? value.trim() : '';
}

function localizedTitle(root: JsonObject): string {
	const localized = root.localizedParameters;
	if (!isObject(localized) || Object.keys(localized).length === 0) {
		return '';
	}
	const defaultLanguage = str(localized, 'defaultLanguage');
	if (defaultLanguage.length > 0) {
		const title = str(localized[defaultLanguage], 'titleName');
		if (title.length > 0) {
			return title;
		}
	}
	const english = str(localized['en-US'], 'titleName');
	if (english.length > 0) {
		return english;
	}
	// QJsonObject iterates keys in sorted order.
	for (const key of Object.keys(localized).sort()) {
		const title = str(localized[key], 'titleName');
		if (title.length > 0) {
			return title;
		}
	}
	return '';
}

export function firmwareVersion(encoded: string): string {
	const match = /^0[xX]([0-9]{6})[0-9A-Fa-f]{10}$/.exec(encoded);
	if (match === null) {
		return '';
	}
	const digits = match[1]!;
	let version = `${parseInt(digits.slice(0, 2), 10)}.${digits.slice(2, 4)}`;
	const patch = digits.slice(4, 6);
	if (patch !== '00') {
		version += `.${patch}`;
	}
	return version;
}

export function parseParamJson(data: Buffer | string | undefined, fallbackTitle: string): GameMetadata {
	const result: GameMetadata = { title: fallbackTitle, titleId: '', gameVersion: '', firmwareVersion: '' };
	if (data === undefined || data.length === 0) {
		return result;
	}
	let root: unknown;
	try {
		root = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'));
	} catch {
		return result;
	}
	if (!isObject(root)) {
		return result;
	}
	const title = localizedTitle(root);
	if (title.length > 0) {
		result.title = title;
	}
	result.titleId = str(root, 'titleId');
	result.gameVersion = str(root, 'appVersion') || str(root, 'contentVersion');
	result.firmwareVersion = firmwareVersion(str(root, 'requiredSystemSoftwareVersion'));
	return result;
}
