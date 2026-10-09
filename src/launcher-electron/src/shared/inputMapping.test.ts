import { describe, expect, it } from 'vitest';
import { PAD_CONTROLS, assignBinding, formatMapping, keyName, mouseButtonName, parseMapping } from './inputMapping';

describe('input mapping', () => {
	it('shows defaults and saves nothing for an empty mapping', () => {
		const mapping = parseMapping([]);
		expect(mapping.custom).toBe(false);
		expect(mapping.bindings.Cross).toBe('J');
		expect(formatMapping(mapping)).toEqual([]);
		expect(PAD_CONTROLS).toHaveLength(28);
	});

	it('round-trips custom bindings in table order', () => {
		const mapping = parseMapping(['Circle=L', 'Up=Up', 'MouseSensitivity=1.5']);
		expect(mapping.custom).toBe(true);
		expect(mapping.bindings.Cross).toBe('');
		expect(mapping.sensitivity).toBe(1.5);
		expect(formatMapping(mapping)).toEqual(['Up=Up', 'Circle=L', 'MouseSensitivity=1.5']);
	});

	it('moves a binding away from other controls', () => {
		const mapping = assignBinding(parseMapping([]), 'Cross', 'w');
		expect(mapping.bindings.Cross).toBe('w');
		expect(mapping.bindings.LeftStickUp).toBe('');
		expect(mapping.custom).toBe(true);
	});

	it('keeps only the last control bound to a key when parsing', () => {
		const mapping = parseMapping(['Cross=J', 'Circle=j']);
		expect(mapping.bindings.Cross).toBe('');
		expect(mapping.bindings.Circle).toBe('j');
	});

	it('names keys like the Qt launcher', () => {
		expect(keyName({ key: 'a' })).toBe('A');
		expect(keyName({ key: '5' })).toBe('5');
		expect(keyName({ key: '5', location: 3 })).toBe('Keypad 5');
		expect(keyName({ key: 'Enter', location: 3 })).toBe('Keypad Enter');
		expect(keyName({ key: 'Enter' })).toBe('Return');
		expect(keyName({ key: 'Shift', location: 2 })).toBe('Left Shift');
		expect(keyName({ key: 'ArrowUp' })).toBe('Up');
		expect(keyName({ key: 'F12' })).toBe('F12');
		expect(keyName({ key: ';' })).toBe(';');
		expect(keyName({ key: ':', shiftKey: true })).toBe('');
		expect(keyName({ key: 'Unidentified' })).toBe('');
		expect(mouseButtonName(3)).toBe('Mouse:X1');
	});
});
