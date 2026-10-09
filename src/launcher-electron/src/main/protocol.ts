// The kyty://app/ scheme serves the UI and the game images it shows. One origin for both lets
// WebGL use game art as textures. Media is served only for files the library registered.
import fs from 'node:fs';
import path from 'node:path';
import { net, protocol } from 'electron';
import { pathToFileURL } from 'node:url';

export const APP_ORIGIN = 'kyty://app';

export function registerScheme(): void {
	protocol.registerSchemesAsPrivileged([
		{ scheme: 'kyty', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
	]);
}

const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.woff2': 'font/woff2',
	'.json': 'application/json',
	'.wav': 'audio/wav',
};

export function handleProtocol(rendererDir: string, mediaFile: (key: string) => string | undefined): void {
	protocol.handle('kyty', async (request) => {
		const url = new URL(request.url);
		if (url.host !== 'app') {
			return new Response('Not found', { status: 404 });
		}
		const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
		const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' };
		if (relative.startsWith('media/') || relative.startsWith('trophy/')) {
			const file = mediaFile(relative);
			if (file === undefined) {
				return new Response('Not found', { status: 404, headers });
			}
			const response = await net.fetch(pathToFileURL(file).toString());
			return new Response(response.body, { status: response.status, headers: { ...headers, 'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' } });
		}
		const target = path.normalize(path.join(rendererDir, relative.length === 0 ? 'index.html' : relative));
		if (!target.startsWith(rendererDir) || !fs.existsSync(target)) {
			return new Response('Not found', { status: 404 });
		}
		const response = await net.fetch(pathToFileURL(target).toString());
		return new Response(response.body, { status: response.status, headers: { 'Content-Type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream' } });
	});
}
