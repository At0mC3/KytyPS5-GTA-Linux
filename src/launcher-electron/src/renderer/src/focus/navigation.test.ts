// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { RepeatTracker } from '../input/actions';
import { directionScore, findNext, move } from './navigation';

function rect(left: number, top: number, width = 100, height = 50) {
	return { left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

function element(id: string, box: DOMRect): HTMLElement {
	const el = document.createElement('button');
	el.id = id;
	el.setAttribute('data-nav', '');
	el.getBoundingClientRect = () => box;
	el.getClientRects = () => [box] as unknown as DOMRectList;
	return el;
}

describe('directionScore', () => {
	it('only accepts elements in the direction', () => {
		const from = rect(100, 100);
		expect(directionScore(from, rect(300, 100), 'right')).toBeDefined();
		expect(directionScore(from, rect(0, 100), 'right')).toBeUndefined();
		expect(directionScore(from, rect(100, 300), 'down')).toBeDefined();
		expect(directionScore(from, rect(100, 0), 'down')).toBeUndefined();
	});

	it('prefers aligned and nearer elements', () => {
		const from = rect(100, 100);
		const aligned = directionScore(from, rect(100, 200), 'down')!;
		const diagonal = directionScore(from, rect(400, 180), 'down')!;
		expect(aligned).toBeLessThan(diagonal);
		expect(directionScore(from, rect(100, 160), 'down')!).toBeLessThan(aligned);
	});
});

describe('findNext and move', () => {
	it('moves through a grid', () => {
		const items = [element('a', rect(0, 0)), element('b', rect(120, 0)), element('c', rect(0, 70)), element('d', rect(120, 70))];
		expect(findNext(items[0]!, items, 'right')?.id).toBe('b');
		expect(findNext(items[0]!, items, 'down')?.id).toBe('c');
		expect(findNext(items[3]!, items, 'up')?.id).toBe('b');
		expect(findNext(items[3]!, items, 'right')).toBeUndefined();
	});

	it('moves focus inside the top-most scope and returns to remembered group items', () => {
		document.body.innerHTML = '';
		const scope = document.createElement('div');
		scope.setAttribute('data-nav-scope', '1');
		const row = document.createElement('div');
		row.setAttribute('data-nav-group', '');
		const tiles = [element('t0', rect(0, 0)), element('t1', rect(120, 0)), element('t2', rect(240, 0))];
		row.append(...tiles);
		const play = element('play', rect(0, 100, 300, 50));
		scope.append(row, play);
		document.body.append(scope);

		tiles[2]!.focus();
		expect(move('down')).toBe(true);
		expect(document.activeElement?.id).toBe('play');
		move('left');
		move('up');
		// Up from the wide button returns to the tile that had focus.
		expect(document.activeElement?.id).toBe('t2');

		const dialog = document.createElement('div');
		dialog.setAttribute('data-nav-scope', '100');
		const ok = element('ok', rect(500, 500));
		dialog.append(ok);
		document.body.append(dialog);
		expect(move('down')).toBe(true);
		expect(document.activeElement?.id).toBe('ok');
	});
});

describe('RepeatTracker', () => {
	it('repeats held directions after a delay', () => {
		const tracker = new RepeatTracker(400, 90, 50);
		const held = new Set(['down' as const]);
		expect(tracker.update(held, 0)).toEqual([{ action: 'down', repeat: false }]);
		expect(tracker.update(held, 300)).toEqual([]);
		expect(tracker.update(held, 400)).toEqual([{ action: 'down', repeat: true }]);
		expect(tracker.update(held, 450)).toEqual([]);
		expect(tracker.update(held, 490)).toEqual([{ action: 'down', repeat: true }]);
		expect(tracker.update(new Set(), 500)).toEqual([]);
		expect(tracker.update(held, 510)).toEqual([{ action: 'down', repeat: false }]);
	});

	it('does not repeat buttons', () => {
		const tracker = new RepeatTracker();
		const held = new Set(['confirm' as const]);
		expect(tracker.update(held, 0)).toHaveLength(1);
		expect(tracker.update(held, 2000)).toEqual([]);
	});
});
