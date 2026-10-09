import type { Action, InputDevice } from '../input/actions';
import { useStore } from '../store';

// Button glyphs for the hint bar, drawn for the input device in use.
function PlayStationGlyph({ action }: { action: Action }) {
	const swap = useStore((state) => state.app?.prefs.confirm_button === 'circle');
	const shape = action === 'confirm' ? (swap ? 'circle' : 'cross') : action === 'back' ? (swap ? 'cross' : 'circle') : action === 'search' ? 'square' : action === 'details' ? 'triangle' : undefined;
	if (shape !== undefined) {
		return (
			<svg className="glyph glyph-face" viewBox="0 0 24 24" aria-hidden="true">
				<circle cx="12" cy="12" r="11" />
				{shape === 'cross' && <path d="M8 8l8 8M16 8l-8 8" />}
				{shape === 'circle' && <circle cx="12" cy="12" r="4.5" />}
				{shape === 'square' && <rect x="7.5" y="7.5" width="9" height="9" />}
				{shape === 'triangle' && <path d="M12 6.8 17 15.5H7Z" />}
			</svg>
		);
	}
	const labels: Partial<Record<Action, string>> = {
		options: 'OPTIONS',
		fullscreen: 'CREATE',
		tabPrev: 'L1',
		tabNext: 'R1',
		pagePrev: 'L2',
		pageNext: 'R2',
		home: 'PS',
	};
	return <span className="glyph glyph-pill">{labels[action] ?? action}</span>;
}

function XboxGlyph({ action }: { action: Action }) {
	const swap = useStore((state) => state.app?.prefs.confirm_button === 'circle');
	const letters: Partial<Record<Action, string>> = { confirm: swap ? 'B' : 'A', back: swap ? 'A' : 'B', search: 'X', details: 'Y' };
	const letter = letters[action];
	if (letter !== undefined) {
		return <span className="glyph glyph-letter">{letter}</span>;
	}
	const labels: Partial<Record<Action, string>> = { options: 'MENU', fullscreen: 'VIEW', tabPrev: 'LB', tabNext: 'RB', pagePrev: 'LT', pageNext: 'RT', home: 'GUIDE' };
	return <span className="glyph glyph-pill">{labels[action] ?? action}</span>;
}

const KEY_LABELS: Partial<Record<Action, string>> = {
	confirm: 'Enter',
	back: 'Esc',
	search: 'S',
	details: 'I',
	options: 'O',
	fullscreen: 'F11',
	tabPrev: 'Q',
	tabNext: 'E',
	pagePrev: 'PgUp',
	pageNext: 'PgDn',
	home: 'Home',
};

export function Glyph({ action, device }: { action: Action; device?: InputDevice }) {
	const current = useStore((state) => state.device);
	const kind = device ?? current;
	if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
		const arrows = action === 'up' || action === 'down' ? '↕' : '↔';
		return <span className={kind === 'keyboard' || kind === 'mouse' ? 'glyph glyph-key' : 'glyph glyph-pill'}>{arrows}</span>;
	}
	if (kind === 'playstation') {
		return <PlayStationGlyph action={action} />;
	}
	if (kind === 'xbox') {
		return <XboxGlyph action={action} />;
	}
	return <span className="glyph glyph-key">{KEY_LABELS[action] ?? action}</span>;
}

export interface Hint {
	action: Action;
	label: string;
}

export function Hints({ items }: { items: Hint[] }) {
	return (
		<div className="hints" role="note">
			{items.map((item) => (
				<span key={`${item.action}-${item.label}`} className="hint">
					<Glyph action={item.action} />
					<span>{item.label}</span>
				</span>
			))}
		</div>
	);
}
