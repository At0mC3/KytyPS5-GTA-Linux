// Base-1024 sizes with two decimals, like the Qt launcher's size column.
export function formatSize(bytes: number | undefined): string {
	if (bytes === undefined) {
		return '…';
	}
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return unit === 0 ? `${value} B` : `${value.toFixed(2)} ${units[unit]}`;
}

export function formatDate(ms: number | undefined): string {
	if (ms === undefined) {
		return '';
	}
	return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function initials(name: string): string {
	const trimmed = name.trim();
	return trimmed.length === 0 ? '?' : [...trimmed][0]!.toUpperCase();
}
