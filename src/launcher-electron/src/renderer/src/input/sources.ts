// Input sources: the Gamepad API (standard mapping), the keyboard, and the SDL helper that the
// main process runs when the Gamepad API cannot see the controller.
import type { SdlControllerEvent } from '../../../shared/types';
import { RepeatTracker, dispatchAction, setInputDevice, type Action, type InputDevice } from './actions';

const STICK_PRESS = 0.5;
const STICK_RELEASE = 0.35;

// Standard Gamepad mapping: 0 Cross/A, 1 Circle/B, 2 Square/X, 3 Triangle/Y, 4 L1, 5 R1, 6 L2,
// 7 R2, 8 Create/Back, 9 Options/Start, 10 L3, 11 R3, 12-15 D-pad, 16 PS/Guide.
function buttonAction(index: number, swapConfirm: boolean): Action | undefined {
	switch (index) {
		case 0:
			return swapConfirm ? 'back' : 'confirm';
		case 1:
			return swapConfirm ? 'confirm' : 'back';
		case 2:
			return 'search';
		case 3:
			return 'details';
		case 4:
			return 'tabPrev';
		case 5:
			return 'tabNext';
		case 6:
			return 'pagePrev';
		case 7:
			return 'pageNext';
		case 8:
			return 'fullscreen';
		case 9:
			return 'options';
		case 12:
			return 'up';
		case 13:
			return 'down';
		case 14:
			return 'left';
		case 15:
			return 'right';
		case 16:
			return 'home';
		default:
			return undefined;
	}
}

export function gamepadKind(id: string): InputDevice {
	return /054c|playstation|dualsense|dualshock|wireless controller|sony/i.test(id) ? 'playstation' : 'xbox';
}

export interface InputOptions {
	enabled: () => boolean;
	swapConfirm: () => boolean;
}

export class GamepadSource {
	private repeat = new RepeatTracker();
	private stickHeld = new Map<string, boolean>();
	private frame = 0;
	private sdlPressed = new Set<Action>();
	private sdlAxes = { leftx: 0, lefty: 0 };
	private activeKind: InputDevice = 'playstation';
	connected = false;

	constructor(private readonly options: InputOptions) {}

	start(): void {
		const loop = () => {
			this.poll();
			this.frame = requestAnimationFrame(loop);
		};
		this.frame = requestAnimationFrame(loop);
		window.addEventListener('gamepadconnected', (event) => {
			this.connected = true;
			setInputDevice(gamepadKind(event.gamepad.id));
		});
	}

	stop(): void {
		cancelAnimationFrame(this.frame);
	}

	private stick(key: string, value: number, negative: boolean): boolean {
		const held = this.stickHeld.get(key) ?? false;
		const amount = negative ? -value : value;
		const next = held ? amount > STICK_RELEASE : amount > STICK_PRESS;
		this.stickHeld.set(key, next);
		return next;
	}

	private poll(): void {
		if (!this.options.enabled() || !document.hasFocus() || document.hidden) {
			this.repeat.reset();
			return;
		}
		const pressed = new Set<Action>();
		const pads = navigator.getGamepads?.() ?? [];
		let kind: InputDevice | undefined;
		for (const pad of pads) {
			if (pad === null || !pad.connected) {
				continue;
			}
			const swap = this.options.swapConfirm();
			pad.buttons.forEach((button, index) => {
				if (button.pressed) {
					const action = buttonAction(index, swap);
					if (action !== undefined) {
						pressed.add(action);
						kind = gamepadKind(pad.id);
					}
				}
			});
			const x = pad.axes[0] ?? 0;
			const y = pad.axes[1] ?? 0;
			const id = `${pad.index}`;
			if (this.stick(`${id}x-`, x, true)) pressed.add('left');
			if (this.stick(`${id}x+`, x, false)) pressed.add('right');
			if (this.stick(`${id}y-`, y, true)) pressed.add('up');
			if (this.stick(`${id}y+`, y, false)) pressed.add('down');
			if (pressed.size > 0 && kind === undefined) {
				kind = gamepadKind(pad.id);
			}
		}
		for (const action of this.sdlPressed) {
			pressed.add(action);
		}
		if (this.stick('sdlx-', this.sdlAxes.leftx, true)) pressed.add('left');
		if (this.stick('sdlx+', this.sdlAxes.leftx, false)) pressed.add('right');
		if (this.stick('sdly-', this.sdlAxes.lefty, true)) pressed.add('up');
		if (this.stick('sdly+', this.sdlAxes.lefty, false)) pressed.add('down');
		if (kind !== undefined) {
			this.activeKind = kind;
		}
		for (const { action, repeat } of this.repeat.update(pressed, performance.now())) {
			dispatchAction(action, { repeat, device: kind ?? this.activeKind });
		}
	}

	// Events from the SDL helper (SDL gamepad button names: a = south, b = east...).
	handleSdl(event: SdlControllerEvent): void {
		if (event.event === 'button' && event.button !== undefined) {
			const map: Record<string, number> = {
				a: 0,
				b: 1,
				x: 2,
				y: 3,
				leftshoulder: 4,
				rightshoulder: 5,
				back: 8,
				start: 9,
				dpup: 12,
				dpdown: 13,
				dpleft: 14,
				dpright: 15,
				guide: 16,
			};
			const index = map[event.button];
			const action = index === undefined ? undefined : buttonAction(index, this.options.swapConfirm());
			if (action !== undefined) {
				if (event.down === true) {
					this.sdlPressed.add(action);
				} else {
					this.sdlPressed.delete(action);
				}
			}
		} else if (event.event === 'axis' && event.axis !== undefined) {
			if (event.axis === 'leftx') this.sdlAxes.leftx = event.value ?? 0;
			if (event.axis === 'lefty') this.sdlAxes.lefty = event.value ?? 0;
			if (event.axis === 'lefttrigger' && (event.value ?? 0) > 0.5) this.sdlPressed.add('pagePrev');
			else if (event.axis === 'lefttrigger') this.sdlPressed.delete('pagePrev');
			if (event.axis === 'righttrigger' && (event.value ?? 0) > 0.5) this.sdlPressed.add('pageNext');
			else if (event.axis === 'righttrigger') this.sdlPressed.delete('pageNext');
		} else if (event.event === 'removed') {
			this.sdlPressed.clear();
		}
	}
}

const KEY_ACTIONS: Record<string, Action> = {
	ArrowUp: 'up',
	ArrowDown: 'down',
	ArrowLeft: 'left',
	ArrowRight: 'right',
	Enter: 'confirm',
	' ': 'confirm',
	Escape: 'back',
	Backspace: 'back',
	ContextMenu: 'options',
	PageUp: 'pagePrev',
	PageDown: 'pageNext',
	Home: 'home',
};

export function keyAction(event: KeyboardEvent): Action | undefined {
	if (event.ctrlKey || event.altKey || event.metaKey) {
		if (event.ctrlKey && event.key.toLowerCase() === 'f') {
			return 'search';
		}
		return undefined;
	}
	if (event.key === 'Tab') {
		return event.shiftKey ? 'tabPrev' : 'tabNext';
	}
	if (event.key === 'q' || event.key === 'Q') return 'tabPrev';
	if (event.key === 'e' || event.key === 'E') return 'tabNext';
	if (event.key === 'o' || event.key === 'O' || event.key === 'm' || event.key === 'M') return 'options';
	if (event.key === '/' || event.key === 's' || event.key === 'S') return 'search';
	if (event.key === 'i' || event.key === 'I') return 'details';
	return KEY_ACTIONS[event.key];
}

// Keys go to text fields and key-capture dialogs untouched.
export function installKeyboard(): () => void {
	const onKey = (event: KeyboardEvent) => {
		const target = event.target as HTMLElement | null;
		if (target?.closest('[data-raw-keys]') !== null && target?.closest('[data-raw-keys]') !== undefined) {
			return;
		}
		const isText = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
		if (isText && !['ArrowUp', 'ArrowDown', 'Escape', 'Enter', 'Tab'].includes(event.key)) {
			return;
		}
		const action = keyAction(event);
		if (action === undefined) {
			return;
		}
		event.preventDefault();
		dispatchAction(action, { repeat: event.repeat, device: 'keyboard' });
	};
	const onMouse = () => setInputDevice('mouse');
	window.addEventListener('keydown', onKey);
	window.addEventListener('mousedown', onMouse, { capture: true });
	return () => {
		window.removeEventListener('keydown', onKey);
		window.removeEventListener('mousedown', onMouse, { capture: true });
	};
}
