// Keyboard and mouse to DualSense mapping, ported from src/launcher/src/inputMappingDialog.cpp.
// Bindings use SDL key names, which the emulator resolves with SDL_GetKeyFromName.

export interface PadControl {
	id: string;
	label: string;
	defaultBinding: string;
}

export const PAD_CONTROLS: readonly PadControl[] = [
	{ id: 'Up', label: 'D-pad Up', defaultBinding: 'Up' },
	{ id: 'Down', label: 'D-pad Down', defaultBinding: 'Down' },
	{ id: 'Left', label: 'D-pad Left', defaultBinding: 'Left' },
	{ id: 'Right', label: 'D-pad Right', defaultBinding: 'Right' },
	{ id: 'LeftStickUp', label: 'Left stick Up', defaultBinding: 'W' },
	{ id: 'LeftStickDown', label: 'Left stick Down', defaultBinding: 'S' },
	{ id: 'LeftStickLeft', label: 'Left stick Left', defaultBinding: 'A' },
	{ id: 'LeftStickRight', label: 'Left stick Right', defaultBinding: 'D' },
	{ id: 'RightStickUp', label: 'Right stick Up', defaultBinding: 'T' },
	{ id: 'RightStickDown', label: 'Right stick Down', defaultBinding: 'G' },
	{ id: 'RightStickLeft', label: 'Right stick Left', defaultBinding: 'F' },
	{ id: 'RightStickRight', label: 'Right stick Right', defaultBinding: 'H' },
	{ id: 'Triangle', label: 'Triangle', defaultBinding: 'I' },
	{ id: 'Circle', label: 'Circle', defaultBinding: 'L' },
	{ id: 'Cross', label: 'Cross', defaultBinding: 'J' },
	{ id: 'Square', label: 'Square', defaultBinding: 'K' },
	{ id: 'L1', label: 'L1', defaultBinding: 'Q' },
	{ id: 'R1', label: 'R1', defaultBinding: 'E' },
	{ id: 'L2', label: 'L2', defaultBinding: 'Z' },
	{ id: 'R2', label: 'R2', defaultBinding: 'C' },
	{ id: 'L3', label: 'L3', defaultBinding: 'Left Shift' },
	{ id: 'R3', label: 'R3', defaultBinding: 'Left Ctrl' },
	{ id: 'Options', label: 'Options', defaultBinding: 'Return' },
	{ id: 'TouchPad', label: 'Touch pad left (SELECT)', defaultBinding: 'Backspace' },
	{ id: 'TouchPadRight', label: 'Touch pad right (START)', defaultBinding: 'Tab' },
	{ id: 'SpeakerVolume', label: 'Speaker volume (cycle)', defaultBinding: '1' },
	{ id: 'VibrationIntensity', label: 'Vibration intensity (cycle)', defaultBinding: '2' },
	{ id: 'TriggerEffectIntensity', label: 'Trigger effect intensity (cycle)', defaultBinding: '3' },
];

const MOUSE_SENSITIVITY = 'MouseSensitivity=';
export const DEFAULT_MOUSE_SENSITIVITY = 1.0;
export const MIN_MOUSE_SENSITIVITY = 0.1;
export const MAX_MOUSE_SENSITIVITY = 5.0;

export interface InputMapping {
	// Control id to binding; an empty string means unbound.
	bindings: Record<string, string>;
	// False while the user keeps the emulator's default bindings: nothing is saved then.
	custom: boolean;
	sensitivity: number;
}

export function defaultBindings(): Record<string, string> {
	return Object.fromEntries(PAD_CONTROLS.map((control) => [control.id, control.defaultBinding]));
}

function clampSensitivity(value: number): number {
	if (!Number.isFinite(value)) {
		return MIN_MOUSE_SENSITIVITY;
	}
	return Math.round(Math.min(MAX_MOUSE_SENSITIVITY, Math.max(MIN_MOUSE_SENSITIVITY, value)) * 10) / 10;
}

export function parseMapping(mapping: string[]): InputMapping {
	const parsed = new Map<string, string>();
	let sensitivity = DEFAULT_MOUSE_SENSITIVITY;
	let sensitivitySeen = false;
	for (const entry of mapping) {
		if (entry.startsWith(MOUSE_SENSITIVITY)) {
			if (!sensitivitySeen) {
				sensitivity = clampSensitivity(Number(entry.slice(MOUSE_SENSITIVITY.length)) || 0);
				sensitivitySeen = true;
			}
			continue;
		}
		const separator = entry.indexOf('=');
		if (separator > 0 && separator + 1 < entry.length) {
			const binding = entry.slice(separator + 1);
			for (const [control, value] of parsed) {
				if (value.toLowerCase() === binding.toLowerCase()) {
					parsed.delete(control);
				}
			}
			parsed.set(entry.slice(0, separator), binding);
		}
	}
	const custom = parsed.size > 0;
	const bindings = custom
		? Object.fromEntries(PAD_CONTROLS.map((control) => [control.id, parsed.get(control.id) ?? '']))
		: defaultBindings();
	return { bindings, custom, sensitivity };
}

export function formatMapping(mapping: InputMapping): string[] {
	const result: string[] = [];
	if (mapping.custom) {
		for (const control of PAD_CONTROLS) {
			const binding = mapping.bindings[control.id] ?? '';
			if (binding.length > 0) {
				result.push(`${control.id}=${binding}`);
			}
		}
	}
	const sensitivity = clampSensitivity(mapping.sensitivity);
	if (sensitivity !== DEFAULT_MOUSE_SENSITIVITY) {
		result.push(`${MOUSE_SENSITIVITY}${sensitivity.toFixed(1)}`);
	}
	return result;
}

// Assigns a binding, removing it from any other control.
export function assignBinding(mapping: InputMapping, controlId: string, binding: string): InputMapping {
	const bindings = { ...mapping.bindings };
	if (binding.length > 0) {
		for (const [control, value] of Object.entries(bindings)) {
			if (control !== controlId && value.toLowerCase() === binding.toLowerCase()) {
				bindings[control] = '';
			}
		}
	}
	bindings[controlId] = binding;
	return { ...mapping, bindings, custom: true };
}

export const RESERVED_KEYS = ['F1', 'F7', 'F11'];

export interface KeyLike {
	key: string;
	code?: string;
	location?: number;
	shiftKey?: boolean;
	ctrlKey?: boolean;
	altKey?: boolean;
	metaKey?: boolean;
}

const NAMED_KEYS: Record<string, string> = {
	' ': 'Space',
	Enter: 'Return',
	Backspace: 'Backspace',
	Tab: 'Tab',
	Shift: 'Left Shift',
	Control: 'Left Ctrl',
	Alt: 'Left Alt',
	AltGraph: 'Left Alt',
	Meta: 'Left GUI',
	Insert: 'Insert',
	Delete: 'Delete',
	Home: 'Home',
	End: 'End',
	PageUp: 'PageUp',
	PageDown: 'PageDown',
	ArrowLeft: 'Left',
	ArrowRight: 'Right',
	ArrowUp: 'Up',
	ArrowDown: 'Down',
	CapsLock: 'CapsLock',
	NumLock: 'Numlock',
	ScrollLock: 'ScrollLock',
	Pause: 'Pause',
	PrintScreen: 'PrintScreen',
};

const KEYPAD_KEYS: Record<string, string> = {
	Enter: 'Keypad Enter',
	'/': 'Keypad /',
	'*': 'Keypad *',
	'-': 'Keypad -',
	'+': 'Keypad +',
	'.': 'Keypad .',
	'=': 'Keypad =',
	',': 'Keypad ,',
};

// Port of KeyName(): the SDL key name for a key press, or '' when unsupported.
export function keyName(event: KeyLike): string {
	const key = event.key;
	if (event.location === 3) {
		if (/^[0-9]$/.test(key)) {
			return `Keypad ${key}`;
		}
		return KEYPAD_KEYS[key] ?? '';
	}
	if (/^[a-zA-Z]$/.test(key)) {
		return key.toUpperCase();
	}
	if (/^[0-9]$/.test(key)) {
		return key;
	}
	if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) {
		return key;
	}
	const named = NAMED_KEYS[key];
	if (named !== undefined) {
		return named;
	}
	if (event.shiftKey === true || event.ctrlKey === true || event.altKey === true || event.metaKey === true) {
		return '';
	}
	return [...key].length === 1 ? key.toUpperCase() : '';
}

export function mouseButtonName(button: number): string {
	switch (button) {
		case 0:
			return 'Mouse:Left';
		case 1:
			return 'Mouse:Middle';
		case 2:
			return 'Mouse:Right';
		case 3:
			return 'Mouse:X1';
		case 4:
			return 'Mouse:X2';
		default:
			return '';
	}
}
