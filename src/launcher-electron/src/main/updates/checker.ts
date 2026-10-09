// Port of src/launcher/src/updateChecker.cpp. Only official release builds check for updates;
// the emulator reports that through "--query info".
import type { UpdateResult } from '../../shared/types';
import { fetchLimited } from '../net/fetch';

const PRIMARY_FEED = 'https://kytyps5.github.io/data/updates.json';
const FALLBACK_FEED = 'https://api.github.com/repos/KytyPS5/KytyPS5/releases/latest';

interface FeedInfo {
	tag: string;
	url: string;
	error?: string;
}

export function parseUpdateFeed(data: string): FeedInfo {
	let root: unknown;
	try {
		root = JSON.parse(data);
	} catch {
		return { tag: '', url: '', error: 'Invalid update feed' };
	}
	if (typeof root !== 'object' || root === null) {
		return { tag: '', url: '', error: 'Invalid update feed' };
	}
	const object = root as Record<string, unknown>;
	const tag = typeof object.tag === 'string' && object.tag.length > 0 ? object.tag : typeof object.tag_name === 'string' ? object.tag_name : '';
	const url = typeof object.html_url === 'string' ? object.html_url : '';
	let valid = false;
	try {
		valid = new URL(url).protocol === 'https:';
	} catch {
		valid = false;
	}
	return tag.length === 0 || !valid ? { tag, url, error: 'Incomplete update feed' } : { tag, url };
}

async function fetchFeed(url: string): Promise<FeedInfo> {
	try {
		const data = await fetchLimited(url, { limit: 1024 * 1024, headers: { Accept: 'application/vnd.github+json' } });
		return parseUpdateFeed(data.toString('utf8'));
	} catch (error) {
		return { tag: '', url: '', error: (error as Error).message };
	}
}

export async function checkForUpdates(currentTag: string): Promise<UpdateResult> {
	let info = await fetchFeed(PRIMARY_FEED);
	if (info.error !== undefined || info.tag !== currentTag) {
		const primary = info.error === undefined ? info : undefined;
		const fallback = await fetchFeed(FALLBACK_FEED);
		info = fallback.error !== undefined && primary !== undefined ? primary : fallback;
	}
	if (info.error !== undefined) {
		return { error: info.error, current: currentTag };
	}
	return { current: currentTag, latest: info.tag, url: info.url, upToDate: info.tag === currentTag };
}
