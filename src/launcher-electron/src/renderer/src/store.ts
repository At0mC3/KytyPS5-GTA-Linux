import type { ReactNode } from 'react';
import { create } from 'zustand';
import type { AppState, Game, LogLine, RunState } from '../../shared/types';
import type { InputDevice } from './input/actions';

export type ScreenName = 'home' | 'library' | 'settings' | 'gameSettings' | 'trophyOverview' | 'trophies' | 'cheats' | 'log';

export interface Screen {
	key: number;
	name: ScreenName;
	gameId?: string;
	section?: string;
}

export interface Modal {
	id: number;
	render: (close: (value?: unknown) => void) => ReactNode;
	resolve: (value: unknown) => void;
	restoreFocus: HTMLElement | null;
	dismissable: boolean;
}

export interface Toast {
	id: number;
	text: string;
	kind: 'info' | 'error';
}

interface Store {
	app?: AppState;
	games: Game[];
	run: RunState;
	log: LogLine[];
	selectedId?: string;
	screens: Screen[];
	modals: Modal[];
	toasts: Toast[];
	device: InputDevice;
	renderer: 'webgl' | 'css' | 'pending';
	launching?: string;
	setApp(app: AppState): void;
	setGames(games: Game[]): void;
	setRun(run: RunState): void;
	appendLog(lines: LogLine[]): void;
	setLog(lines: LogLine[]): void;
	select(id: string | undefined): void;
	push(screen: Omit<Screen, 'key'>): void;
	replace(screen: Omit<Screen, 'key'>): void;
	pop(): void;
	goHome(): void;
	openModal(modal: Omit<Modal, 'id'>): number;
	closeModal(id: number, value?: unknown): void;
	toast(text: string, kind?: Toast['kind']): void;
	setDevice(device: InputDevice): void;
	setRenderer(renderer: Store['renderer']): void;
	setLaunching(id: string | undefined): void;
}

let key = 1;
const MAX_LOG = 20_000;

export const useStore = create<Store>((set, get) => ({
	games: [],
	run: { running: false },
	log: [],
	screens: [{ key: 0, name: 'home' }],
	modals: [],
	toasts: [],
	device: 'keyboard',
	renderer: 'pending',
	setApp: (app) => set({ app }),
	setGames: (games) => {
		const selected = get().selectedId;
		set({ games, selectedId: selected !== undefined && games.some((game) => game.id === selected) ? selected : games[0]?.id });
	},
	setRun: (run) => set({ run }),
	appendLog: (lines) => {
		const log = get().log.concat(lines);
		set({ log: log.length > MAX_LOG ? log.slice(log.length - MAX_LOG) : log });
	},
	setLog: (log) => set({ log }),
	select: (selectedId) => set({ selectedId }),
	push: (screen) => set({ screens: [...get().screens, { ...screen, key: key++ }] }),
	replace: (screen) => set({ screens: [...get().screens.slice(0, -1), { ...screen, key: key++ }] }),
	pop: () => {
		const screens = get().screens;
		if (screens.length > 1) {
			set({ screens: screens.slice(0, -1) });
		}
	},
	goHome: () => set({ screens: [get().screens[0]!] }),
	openModal: (modal) => {
		const id = key++;
		set({ modals: [...get().modals, { ...modal, id }] });
		return id;
	},
	closeModal: (id, value) => {
		const modal = get().modals.find((item) => item.id === id);
		if (modal === undefined) {
			return;
		}
		set({ modals: get().modals.filter((item) => item.id !== id) });
		modal.resolve(value);
		const restore = modal.restoreFocus;
		if (restore !== null && restore.isConnected) {
			requestAnimationFrame(() => restore.focus({ preventScroll: true }));
		}
	},
	toast: (text, kind = 'info') => {
		const id = key++;
		set({ toasts: [...get().toasts, { id, text, kind }] });
		setTimeout(() => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }), 3500);
	},
	setDevice: (device) => set({ device }),
	setRenderer: (renderer) => set({ renderer }),
	setLaunching: (launching) => set({ launching }),
}));

// Opens a dialog and resolves with the value it closes with (undefined when dismissed).
export function showModal<T>(render: (close: (value?: T) => void) => ReactNode, options: { dismissable?: boolean } = {}): Promise<T | undefined> {
	return new Promise((resolve) => {
		useStore.getState().openModal({
			render: render as Modal['render'],
			resolve: resolve as (value: unknown) => void,
			restoreFocus: document.activeElement as HTMLElement | null,
			dismissable: options.dismissable ?? true,
		});
	});
}

export function selectedGame(): Game | undefined {
	const { games, selectedId } = useStore.getState();
	return games.find((game) => game.id === selectedId);
}
