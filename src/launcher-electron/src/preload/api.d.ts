import type { KytyApi } from '../shared/api';

declare global {
	interface Window {
		kyty: KytyApi;
	}
}

export {};
