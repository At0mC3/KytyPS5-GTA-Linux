import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LogLine } from '../../../shared/types';
import { Hints } from '../components/Glyph';
import { Icon } from '../components/Icon';
import { hoverFocus, useActions, useInitialFocus } from '../hooks';
import { playSound } from '../input/sounds';
import { kyty } from '../kyty';
import { useStore } from '../store';

interface Span {
	text: string;
	className: string;
}

const COLORS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

// Turns ANSI SGR color codes into styled spans.
export function parseAnsi(text: string): Span[] {
	const spans: Span[] = [];
	let classes: string[] = [];
	const pattern = /\x1b\[([0-9;]*)m/g;
	let last = 0;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(text)) !== null) {
		if (match.index > last) {
			spans.push({ text: text.slice(last, match.index), className: classes.join(' ') });
		}
		for (const code of (match[1] || '0').split(';').map(Number)) {
			if (code === 0) classes = [];
			else if (code === 1) classes.push('ansi-bold');
			else if (code >= 30 && code <= 37) classes = classes.filter((item) => !item.startsWith('ansi-fg')).concat(`ansi-fg-${COLORS[code - 30]}`);
			else if (code >= 90 && code <= 97) classes = classes.filter((item) => !item.startsWith('ansi-fg')).concat(`ansi-fg-bright-${COLORS[code - 90]}`);
		}
		last = pattern.lastIndex;
	}
	if (last < text.length) {
		spans.push({ text: text.slice(last), className: classes.join(' ') });
	}
	return spans;
}

const VISIBLE = 1500;

function Line({ line }: { line: LogLine }) {
	const spans = useMemo(() => parseAnsi(line.text), [line.text]);
	return (
		<div className={`log-line log-${line.stream}`}>
			{spans.map((span, index) => (
				<span key={index} className={span.className}>
					{span.text}
				</span>
			))}
		</div>
	);
}

export function LogConsole() {
	const log = useStore((state) => state.log);
	const run = useStore((state) => state.run);
	const [follow, setFollow] = useState(true);
	const scroller = useRef<HTMLDivElement>(null);
	const ref = useRef<HTMLDivElement>(null);
	useInitialFocus(ref);

	const lines = log.slice(-VISIBLE);
	useLayoutEffect(() => {
		if (follow && scroller.current !== null) {
			scroller.current.scrollTop = scroller.current.scrollHeight;
		}
	}, [log, follow]);

	useEffect(() => {
		void kyty.getLog().then((lines) => useStore.getState().setLog(lines));
	}, []);

	useActions((action) => {
		const element = scroller.current;
		if (element === null) return false;
		if (action === 'up' || action === 'down' || action === 'pagePrev' || action === 'pageNext') {
			const step = action === 'up' || action === 'down' ? 60 : element.clientHeight * 0.9;
			element.scrollTop += action === 'up' || action === 'pagePrev' ? -step : step;
			setFollow(element.scrollTop + element.clientHeight >= element.scrollHeight - 4);
			return true;
		}
		if (action === 'details') {
			setFollow(!follow);
			return true;
		}
		return false;
	});

	const copy = async () => {
		await navigator.clipboard.writeText(log.map((line) => line.text.replace(/\x1b\[[0-9;]*m/g, '')).join('\n'));
		playSound('confirm');
		useStore.getState().toast('Log copied to the clipboard.');
	};

	return (
		<div className="screen log-screen" data-nav-scope="1" ref={ref}>
			<header className="settings-header">
				<button className="button button-round" data-nav aria-label="Back" onClick={() => useStore.getState().pop()} {...hoverFocus}>
					<Icon name="chevronLeft" />
				</button>
				<div>
					<h1>Emulator log</h1>
					<p>
						{run.running
							? `${run.title} is running`
							: run.exitCode !== undefined || run.signal !== undefined
								? `${run.title ?? 'The game'} ${run.signal != null ? `stopped (${run.signal})` : `exited with code ${run.exitCode}`}`
								: 'No game has run yet'}
					</p>
				</div>
				<div className="log-actions" data-nav-group>
					{run.running && (
						<button className="button button-danger" data-nav data-nav-default onClick={() => void kyty.stopGame()} {...hoverFocus}>
							<Icon name="stop" size={20} /> Stop game
						</button>
					)}
					<button className="button" data-nav onClick={() => setFollow(!follow)} {...hoverFocus}>
						{follow ? 'Pause scrolling' : 'Follow output'}
					</button>
					<button className="button" data-nav onClick={() => void copy()} {...hoverFocus}>
						Copy all
					</button>
				</div>
			</header>
			<div className="log-output" ref={scroller} onScroll={(event) => setFollow(event.currentTarget.scrollTop + event.currentTarget.clientHeight >= event.currentTarget.scrollHeight - 4)}>
				{log.length > lines.length && <div className="log-line log-sys">… {log.length - lines.length} earlier lines (Copy all includes them)</div>}
				{lines.map((line, index) => (
					<Line key={log.length - lines.length + index} line={line} />
				))}
			</div>
			<Hints
				items={[
					{ action: 'up', label: 'Scroll' },
					{ action: 'details', label: follow ? 'Pause' : 'Follow' },
					{ action: 'back', label: 'Back' },
				]}
			/>
		</div>
	);
}
