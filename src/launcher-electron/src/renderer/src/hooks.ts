import { useEffect, useRef, useState } from 'react';
import { focusElement } from './focus/navigation';
import { pushActionHandler, type ActionHandler } from './input/actions';

// Registers an action handler for the component's lifetime. Later mounts take priority.
export function useActions(handler: ActionHandler, enabled = true): void {
	const ref = useRef(handler);
	ref.current = handler;
	const enabledRef = useRef(enabled);
	enabledRef.current = enabled;
	useEffect(() => pushActionHandler(() => (action, info) => (enabledRef.current ? ref.current(action, info) : false)), []);
}

// Focuses the scope's default element after mount.
export function useInitialFocus(scope: React.RefObject<HTMLElement | null>, deps: unknown[] = []): void {
	useEffect(() => {
		const frame = requestAnimationFrame(() => {
			if (scope.current === null) {
				return;
			}
			const items = [...scope.current.querySelectorAll<HTMLElement>('[data-nav]')].filter(
				(element) => !element.hasAttribute('disabled') && element.getClientRects().length > 0,
			);
			const preferred = items.find((element) => element.hasAttribute('data-nav-default')) ?? items[0];
			if (preferred !== undefined) {
				focusElement(preferred);
			}
		});
		return () => cancelAnimationFrame(frame);
	}, deps);
}

export function useClock(): Date {
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		const timer = setInterval(() => setNow(new Date()), 15_000);
		return () => clearInterval(timer);
	}, []);
	return now;
}

// Focus follows the mouse, like hovering on the console's dashboard with a pointer.
export const hoverFocus = {
	onMouseMove: (event: React.MouseEvent<HTMLElement>) => {
		if (document.activeElement !== event.currentTarget && (event.movementX !== 0 || event.movementY !== 0)) {
			event.currentTarget.focus({ preventScroll: true });
		}
	},
};
