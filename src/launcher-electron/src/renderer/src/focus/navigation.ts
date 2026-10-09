// Spatial navigation for controller and arrow keys. Focusable elements carry data-nav; the
// top-most element with data-nav-scope (an open dialog, else the screen) contains the candidates.
// Moving picks the nearest element in the requested direction. A data-nav-group remembers its
// last focused element, so leaving a row and coming back returns to the same item.

export type Direction = 'up' | 'down' | 'left' | 'right';

const SELECTOR = '[data-nav]';
const groupMemory = new WeakMap<Element, HTMLElement>();

// Remember the last focused element of each group, however it got focus (controller, mouse).
if (typeof document !== 'undefined') {
	document.addEventListener('focusin', (event) => {
		const target = event.target as HTMLElement | null;
		const group = target?.matches?.(SELECTOR) === true ? target.closest('[data-nav-group]') : null;
		if (group !== null && group !== undefined && target !== null) {
			groupMemory.set(group, target);
		}
	});
}

export function activeScope(doc: Document = document): HTMLElement | null {
	const scopes = [...doc.querySelectorAll<HTMLElement>('[data-nav-scope]')].filter((scope) => !scope.hasAttribute('data-nav-inactive'));
	let top: HTMLElement | null = null;
	let topLevel = -Infinity;
	for (const scope of scopes) {
		const level = Number(scope.getAttribute('data-nav-scope') || '0');
		if (level >= topLevel) {
			top = scope;
			topLevel = level;
		}
	}
	return top;
}

function isVisible(element: HTMLElement): boolean {
	if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') {
		return false;
	}
	const rect = element.getBoundingClientRect();
	return rect.width > 0 && rect.height > 0 && element.closest('[hidden]') === null;
}

export function candidates(scope: HTMLElement): HTMLElement[] {
	return [...scope.querySelectorAll<HTMLElement>(SELECTOR)].filter((element) => element.closest('[data-nav-scope]') === scope && isVisible(element));
}

export function currentFocus(scope: HTMLElement | null = activeScope()): HTMLElement | null {
	const active = document.activeElement as HTMLElement | null;
	if (scope === null || active === null || !scope.contains(active) || !active.matches(SELECTOR)) {
		return null;
	}
	return active;
}

function scrollIntoContainer(element: HTMLElement): void {
	const container = element.parentElement?.closest<HTMLElement>('[data-nav-scroll]');
	if (container === null || container === undefined) {
		return;
	}
	const rect = element.getBoundingClientRect();
	const box = container.getBoundingClientRect();
	const margin = Number(container.getAttribute('data-nav-scroll') || '48');
	let top = container.scrollTop;
	if (rect.top < box.top + margin) {
		top -= box.top + margin - rect.top;
	} else if (rect.bottom > box.bottom - margin) {
		top += rect.bottom - (box.bottom - margin);
	}
	if (top !== container.scrollTop) {
		container.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
	}
}

export function focusElement(element: HTMLElement): void {
	element.focus({ preventScroll: true });
	scrollIntoContainer(element);
}

// Focuses the scope's preferred element: data-nav-default, a remembered one, or the first.
export function focusFirst(scope: HTMLElement | null = activeScope()): HTMLElement | null {
	if (scope === null) {
		return null;
	}
	const items = candidates(scope);
	const preferred = items.find((element) => element.hasAttribute('data-nav-default')) ?? items[0];
	if (preferred !== undefined) {
		focusElement(preferred);
		return preferred;
	}
	return null;
}

interface Rect {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

function center(rect: Rect): { x: number; y: number } {
	return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
}

// Score of moving from `from` to `to` in a direction; undefined when `to` is not that way.
export function directionScore(from: Rect, to: Rect, direction: Direction): number | undefined {
	const a = center(from);
	const b = center(to);
	const slack = 2;
	let primary: number;
	let overlap: number;
	let offset: number;
	switch (direction) {
		case 'right':
			if (b.x <= a.x + slack || to.right <= from.right - slack) return undefined;
			primary = Math.max(0, to.left - from.right);
			overlap = Math.min(from.bottom, to.bottom) - Math.max(from.top, to.top);
			offset = Math.abs(b.y - a.y);
			break;
		case 'left':
			if (b.x >= a.x - slack || to.left >= from.left + slack) return undefined;
			primary = Math.max(0, from.left - to.right);
			overlap = Math.min(from.bottom, to.bottom) - Math.max(from.top, to.top);
			offset = Math.abs(b.y - a.y);
			break;
		case 'down':
			if (b.y <= a.y + slack || to.bottom <= from.bottom - slack) return undefined;
			primary = Math.max(0, to.top - from.bottom);
			overlap = Math.min(from.right, to.right) - Math.max(from.left, to.left);
			offset = Math.abs(b.x - a.x);
			break;
		case 'up':
			if (b.y >= a.y - slack || to.top >= from.top + slack) return undefined;
			primary = Math.max(0, from.top - to.bottom);
			overlap = Math.min(from.right, to.right) - Math.max(from.left, to.left);
			offset = Math.abs(b.x - a.x);
			break;
	}
	// Prefer elements that line up with the current one; then the nearest; then the most centered.
	return (overlap > 0 ? 0 : 100_000) + primary * 4 + offset;
}

export function findNext(from: HTMLElement, items: HTMLElement[], direction: Direction): HTMLElement | undefined {
	const fromRect = from.getBoundingClientRect();
	let best: HTMLElement | undefined;
	let bestScore = Infinity;
	for (const item of items) {
		if (item === from) {
			continue;
		}
		const score = directionScore(fromRect, item.getBoundingClientRect(), direction);
		if (score !== undefined && score < bestScore) {
			best = item;
			bestScore = score;
		}
	}
	return best;
}

export function move(direction: Direction): boolean {
	const scope = activeScope();
	if (scope === null) {
		return false;
	}
	const current = currentFocus(scope);
	if (current === null) {
		return focusFirst(scope) !== null;
	}
	const explicit = current.getAttribute(`data-nav-${direction}`);
	if (explicit !== null) {
		const target = scope.querySelector<HTMLElement>(explicit);
		if (target !== null && isVisible(target)) {
			focusElement(target);
			return true;
		}
	}
	const items = candidates(scope);
	let next = findNext(current, items, direction);
	if (next === undefined) {
		return false;
	}
	const targetGroup = next.closest('[data-nav-group]');
	if (targetGroup !== null && targetGroup !== current.closest('[data-nav-group]')) {
		const remembered = groupMemory.get(targetGroup);
		if (remembered !== undefined && remembered.isConnected && items.includes(remembered)) {
			next = remembered;
		}
	}
	focusElement(next);
	return true;
}
