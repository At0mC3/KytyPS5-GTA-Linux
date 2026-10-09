// Controller, keyboard and SDL input become the same UI actions. Screens and dialogs push
// handlers; the most recently pushed handler sees an action first and returns true to consume it.

export type Action =
	| 'up'
	| 'down'
	| 'left'
	| 'right'
	| 'confirm'
	| 'back'
	| 'options'
	| 'search'
	| 'details'
	| 'tabPrev'
	| 'tabNext'
	| 'pagePrev'
	| 'pageNext'
	| 'fullscreen'
	| 'home';

export type InputDevice = 'keyboard' | 'mouse' | 'playstation' | 'xbox';

export interface ActionInfo {
	repeat: boolean;
	device: InputDevice;
}

export type ActionHandler = (action: Action, info: ActionInfo) => boolean | void;

interface Entry {
	id: number;
	handler: () => ActionHandler;
}

let nextId = 1;
let stack: Entry[] = [];
let fallback: ActionHandler = () => false;
const deviceListeners = new Set<(device: InputDevice) => void>();
let lastDevice: InputDevice = 'keyboard';

export function pushActionHandler(handler: () => ActionHandler): () => void {
	const id = nextId++;
	stack.push({ id, handler });
	return () => {
		stack = stack.filter((entry) => entry.id !== id);
	};
}

export function setFallbackHandler(handler: ActionHandler): void {
	fallback = handler;
}

export function dispatchAction(action: Action, info: ActionInfo): void {
	setInputDevice(info.device);
	for (let i = stack.length - 1; i >= 0; i--) {
		if (stack[i]!.handler()(action, info) === true) {
			return;
		}
	}
	fallback(action, info);
}

export function setInputDevice(device: InputDevice): void {
	if (device !== lastDevice) {
		lastDevice = device;
		for (const listener of deviceListeners) {
			listener(device);
		}
	}
}

export function inputDevice(): InputDevice {
	return lastDevice;
}

export function onInputDevice(listener: (device: InputDevice) => void): () => void {
	deviceListeners.add(listener);
	return () => deviceListeners.delete(listener);
}

// Held directions repeat after a delay, then faster the longer they are held.
export class RepeatTracker {
	private held = new Map<Action, { since: number; next: number; count: number }>();

	constructor(
		private readonly initialDelay = 400,
		private readonly interval = 90,
		private readonly minInterval = 50,
	) {}

	// Returns the actions to fire for the set of currently held actions at `now`.
	update(pressed: Set<Action>, now: number): { action: Action; repeat: boolean }[] {
		const fired: { action: Action; repeat: boolean }[] = [];
		for (const action of pressed) {
			const state = this.held.get(action);
			if (state === undefined) {
				this.held.set(action, { since: now, next: now + this.initialDelay, count: 0 });
				fired.push({ action, repeat: false });
			} else if (REPEATABLE.has(action) && now >= state.next) {
				state.count++;
				state.next = now + Math.max(this.minInterval, this.interval - state.count * 4);
				fired.push({ action, repeat: true });
			}
		}
		for (const action of [...this.held.keys()]) {
			if (!pressed.has(action)) {
				this.held.delete(action);
			}
		}
		return fired;
	}

	reset(): void {
		this.held.clear();
	}
}

const REPEATABLE = new Set<Action>(['up', 'down', 'left', 'right', 'pagePrev', 'pageNext']);
