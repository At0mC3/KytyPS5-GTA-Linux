// HTTP GET with the limits the Qt launcher applies: a size cap, a transfer timeout and an overall
// timeout, a User-Agent, and optionally same-origin redirects only.
type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

let fetchImpl: FetchFn = (input, init) => fetch(input, init);

// The main process swaps in Electron's net.fetch so system proxy settings apply.
export function setFetchImplementation(fn: FetchFn): void {
	fetchImpl = fn;
}

export interface FetchOptions {
	limit: number;
	timeoutMs?: number;
	overallTimeoutMs?: number;
	sameOrigin?: boolean;
	headers?: Record<string, string>;
}

export class FetchError extends Error {}

export async function fetchLimited(url: string, options: FetchOptions): Promise<Buffer> {
	const controller = new AbortController();
	let reason = '';
	const abort = (why: string) => {
		reason = why;
		controller.abort();
	};
	const overall = setTimeout(() => abort('Download timed out.'), options.overallTimeoutMs ?? 30_000);
	let idle: NodeJS.Timeout | undefined;
	const resetIdle = () => {
		clearTimeout(idle);
		idle = setTimeout(() => abort('Download timed out.'), options.timeoutMs ?? 15_000);
	};
	resetIdle();
	try {
		const response = await fetchImpl(url, {
			signal: controller.signal,
			redirect: 'follow',
			headers: { 'User-Agent': 'Kyty-Launcher', ...options.headers },
		});
		if (options.sameOrigin === true && response.url.length > 0 && new URL(response.url).origin !== new URL(url).origin) {
			throw new FetchError('Redirected to another site.');
		}
		if (response.status !== 200) {
			throw new FetchError(`Unexpected response (HTTP ${response.status}).`);
		}
		const declared = Number(response.headers.get('content-length') ?? '0');
		if (declared > options.limit) {
			throw new FetchError('Download exceeds the size limit.');
		}
		const chunks: Buffer[] = [];
		let size = 0;
		if (response.body !== null) {
			const reader = response.body.getReader();
			for (;;) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				resetIdle();
				size += value.byteLength;
				if (size > options.limit) {
					controller.abort();
					throw new FetchError('Download exceeds the size limit.');
				}
				chunks.push(Buffer.from(value));
			}
		}
		return Buffer.concat(chunks);
	} catch (error) {
		if (error instanceof FetchError) {
			throw error;
		}
		throw new FetchError(reason.length > 0 ? reason : (error as Error).message);
	} finally {
		clearTimeout(overall);
		clearTimeout(idle);
	}
}
