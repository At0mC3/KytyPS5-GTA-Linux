import { useEffect, useRef, useState } from 'react';
import { utf8Length } from '../../../shared/settings';
import { activeScope, move, currentFocus } from '../focus/navigation';
import { hoverFocus } from '../hooks';
import { playSound } from '../input/sounds';
import { showModal } from '../store';
import { ModalFrame } from './Modal';

const LETTERS = ['1234567890-', 'qwertyuiop/', 'asdfghjkl:_', 'zxcvbnm,.@\\'];
const SYMBOLS = ['!#$%&*()=+', '[]{}<>;\'"`', '~^|?€£¥§°', '.,:@/\\_-'];
const DIGITS = ['123', '456', '789', '-0'];

interface Options {
	title: string;
	value: string;
	numeric?: boolean;
	maxBytes?: number;
	placeholder?: string;
	description?: string;
}

function Keyboard({ options, close }: { options: Options; close: (value?: string) => void }) {
	const [text, setText] = useState(options.value);
	const [shift, setShift] = useState(false);
	const [symbols, setSymbols] = useState(false);
	const input = useRef<HTMLInputElement>(null);
	const textRef = useRef(text);
	textRef.current = text;

	const insert = (chars: string) => {
		const next = textRef.current + chars;
		if (options.maxBytes !== undefined && utf8Length(next) > options.maxBytes) {
			playSound('error');
			return;
		}
		if (options.numeric === true && !/^-?\d*$/.test(next)) {
			playSound('error');
			return;
		}
		setText(next);
		if (shift) {
			setShift(false);
		}
	};
	const erase = () => setText((value) => [...value].slice(0, -1).join(''));
	const done = () => {
		playSound('confirm');
		close(textRef.current);
	};

	// Physical keyboard typing while a virtual key has focus.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.target === input.current) {
				if (event.key === 'Enter') {
					event.preventDefault();
					done();
				} else if (event.key === 'Escape') {
					event.preventDefault();
					close();
				} else if (event.key === 'ArrowDown') {
					event.preventDefault();
					move('down');
				}
				return;
			}
			if (activeScope()?.contains(event.target as Node) !== true) {
				return;
			}
			const directions: Record<string, 'up' | 'down' | 'left' | 'right'> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
			if (directions[event.key] !== undefined) {
				event.preventDefault();
				move(directions[event.key]!);
			} else if (event.key === 'Enter') {
				event.preventDefault();
				currentFocus()?.click();
			} else if (event.key === 'Escape') {
				event.preventDefault();
				close();
			} else if (event.key === 'Backspace') {
				event.preventDefault();
				erase();
			} else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
				event.preventDefault();
				insert(event.key);
			}
		};
		window.addEventListener('keydown', onKey, true);
		return () => window.removeEventListener('keydown', onKey, true);
	});

	const rows = options.numeric === true ? DIGITS : symbols ? SYMBOLS : LETTERS;
	const label = (key: string) => (shift && !symbols ? key.toUpperCase() : key);

	return (
		<ModalFrame
			title={options.title}
			subtitle={options.description}
			variant="wide"
			onClose={() => close()}
			hints={[
				{ action: 'confirm', label: 'Type' },
				{ action: 'search', label: 'Delete' },
				...(options.numeric === true ? [] : [{ action: 'details' as const, label: 'Space' }, { action: 'tabPrev' as const, label: 'Shift' }, { action: 'tabNext' as const, label: 'Symbols' }]),
				{ action: 'options', label: 'Done' },
				{ action: 'back', label: 'Cancel' },
			]}
			onAction={(action) => {
				switch (action) {
					case 'search':
						erase();
						return true;
					case 'details':
						if (options.numeric !== true) insert(' ');
						return true;
					case 'tabPrev':
						setShift((value) => !value);
						return true;
					case 'tabNext':
						setSymbols((value) => !value);
						return true;
					case 'options':
						done();
						return true;
					default:
						return false;
				}
			}}
		>
			<div className="osk" data-raw-keys>
				<input
					ref={input}
					className="osk-input"
					value={text}
					placeholder={options.placeholder}
					inputMode={options.numeric === true ? 'numeric' : 'text'}
					onChange={(event) => {
						const value = event.target.value;
						if (options.maxBytes !== undefined && utf8Length(value) > options.maxBytes) return;
						if (options.numeric === true && !/^-?\d*$/.test(value)) return;
						setText(value);
					}}
					spellCheck={false}
				/>
				<div className={`osk-keys ${options.numeric === true ? 'osk-numeric' : ''}`}>
					{rows.map((row, rowIndex) => (
						<div className="osk-row" key={`${symbols}-${rowIndex}`}>
							{[...row].map((key, index) => (
								<button
									key={key}
									className="osk-key"
									data-nav
									data-nav-default={rowIndex === 1 && index === 0 ? '' : undefined}
									onClick={() => {
										playSound('move');
										insert(label(key));
									}}
									{...hoverFocus}
								>
									{label(key)}
								</button>
							))}
						</div>
					))}
					<div className="osk-row osk-actions">
						{options.numeric !== true && (
							<>
								<button className={`osk-key osk-wide ${shift ? 'osk-active' : ''}`} data-nav onClick={() => setShift((value) => !value)} {...hoverFocus}>
									Shift
								</button>
								<button className={`osk-key osk-wide ${symbols ? 'osk-active' : ''}`} data-nav onClick={() => setSymbols((value) => !value)} {...hoverFocus}>
									{symbols ? 'ABC' : '#+='}
								</button>
								<button className="osk-key osk-space" data-nav onClick={() => insert(' ')} {...hoverFocus}>
									Space
								</button>
							</>
						)}
						<button className="osk-key osk-wide" data-nav onClick={erase} {...hoverFocus}>
							⌫
						</button>
						<button className="osk-key osk-wide osk-done" data-nav onClick={done} {...hoverFocus}>
							Done
						</button>
					</div>
				</div>
			</div>
		</ModalFrame>
	);
}

export function editText(options: Options): Promise<string | undefined> {
	return showModal<string>((close) => <Keyboard options={options} close={close} />);
}
