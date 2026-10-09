// Exposes the launcher API to the sandboxed UI as window.kyty.
import { contextBridge, ipcRenderer } from 'electron';
import { KYTY_EVENTS, KYTY_METHODS, type KytyApi, type KytyEvents } from '../shared/api';

const methods = Object.fromEntries(KYTY_METHODS.map((method) => [method, (...args: unknown[]) => ipcRenderer.invoke(`kyty:${method}`, ...args)]));

const api = {
	...methods,
	platform: process.platform,
	on<K extends keyof KytyEvents>(event: K, listener: (payload: KytyEvents[K]) => void): () => void {
		if (!KYTY_EVENTS.includes(event)) {
			return () => undefined;
		}
		const channel = `kyty:event:${event}`;
		const handler = (_event: Electron.IpcRendererEvent, payload: KytyEvents[K]) => listener(payload);
		ipcRenderer.on(channel, handler);
		return () => ipcRenderer.removeListener(channel, handler);
	},
} as KytyApi;

contextBridge.exposeInMainWorld('kyty', api);
