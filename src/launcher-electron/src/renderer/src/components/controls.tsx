import { useEffect, useRef, type ReactNode } from 'react';
import { hoverFocus } from '../hooks';
import { playSound } from '../input/sounds';
import { Icon, type IconName } from './Icon';
import { pick, type PickOption } from './Modal';
import { editText } from './OnScreenKeyboard';

// Rows that react to left/right (pickers, numbers, sliders) mark themselves adjustable; the
// focused row receives a "kyty-adjust" event with the step direction.
export const ADJUST_EVENT = 'kyty-adjust';

function useAdjust(onAdjust: ((delta: number, repeat: boolean) => void) | undefined) {
	const ref = useRef<HTMLDivElement>(null);
	const handler = useRef(onAdjust);
	handler.current = onAdjust;
	useEffect(() => {
		const element = ref.current;
		if (element === null) {
			return;
		}
		const listener = (event: Event) => {
			const detail = (event as CustomEvent<{ delta: number; repeat: boolean }>).detail;
			handler.current?.(detail.delta, detail.repeat);
		};
		element.addEventListener(ADJUST_EVENT, listener);
		return () => element.removeEventListener(ADJUST_EVENT, listener);
	}, []);
	return ref;
}

interface RowProps {
	label: string;
	description?: ReactNode;
	disabled?: boolean;
	invalid?: boolean;
	icon?: IconName;
	children?: ReactNode;
	onClick?: () => void;
	onAdjust?: (delta: number, repeat: boolean) => void;
	testId?: string;
	control?: string;
}

export function Row({ label, description, disabled, invalid, icon, children, onClick, onAdjust, testId, control }: RowProps) {
	const ref = useAdjust(onAdjust);
	return (
		<div
			ref={ref}
			role="button"
			tabIndex={disabled === true ? -1 : 0}
			aria-disabled={disabled === true ? 'true' : undefined}
			className={`row ${invalid === true ? 'row-invalid' : ''} ${disabled === true ? 'row-disabled' : ''}`}
			data-nav
			data-adjustable={onAdjust !== undefined ? '' : undefined}
			data-testid={testId}
			data-control={control}
			onClick={() => {
				if (disabled === true) {
					return;
				}
				if (onClick !== undefined) {
					playSound('confirm');
					onClick();
				}
			}}
			{...hoverFocus}
		>
			{icon !== undefined && <Icon name={icon} className="row-icon" />}
			<span className="row-text">
				<span className="row-label">{label}</span>
				{description !== undefined && <span className="row-description">{description}</span>}
			</span>
			<span className="row-value">{children}</span>
		</div>
	);
}

export function ToggleRow({ value, onChange, ...props }: Omit<RowProps, 'children' | 'onClick'> & { value: boolean; onChange: (value: boolean) => void }) {
	return (
		<Row {...props} onClick={() => onChange(!value)}>
			<span className={`toggle ${value ? 'toggle-on' : ''}`} role="switch" aria-checked={value}>
				<span className="toggle-knob" />
			</span>
		</Row>
	);
}

export function SelectRow<T>({
	value,
	options,
	onChange,
	...props
}: Omit<RowProps, 'children' | 'onClick' | 'onAdjust'> & { value: T; options: PickOption<T>[]; onChange: (value: T) => void }) {
	const index = options.findIndex((option) => Object.is(option.value, value));
	const current = options[index];
	return (
		<Row
			{...props}
			onClick={async () => {
				const picked = await pick(props.label, options, value);
				if (picked !== undefined) {
					onChange(picked);
				}
			}}
			onAdjust={(delta) => {
				const enabled = options.filter((option) => option.disabled !== true);
				const position = enabled.findIndex((option) => Object.is(option.value, value));
				const next = enabled[Math.min(enabled.length - 1, Math.max(0, position + delta))];
				if (next !== undefined && !Object.is(next.value, value)) {
					playSound('move');
					onChange(next.value);
				}
			}}
		>
			<span className="value-chip">
				<Icon name="chevronLeft" size={16} className="value-arrow" />
				<span>{current?.label ?? String(value)}</span>
				<Icon name="chevronRight" size={16} className="value-arrow" />
			</span>
		</Row>
	);
}

export function NumberRow({
	value,
	min,
	max,
	step = 1,
	onChange,
	suffix,
	...props
}: Omit<RowProps, 'children' | 'onClick' | 'onAdjust'> & { value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void }) {
	return (
		<Row
			{...props}
			onClick={async () => {
				const text = await editText({ title: props.label, value: String(value), numeric: true, description: `${min} – ${max}` });
				if (text !== undefined && text.trim().length > 0) {
					const parsed = Number(text);
					if (Number.isFinite(parsed)) {
						onChange(Math.min(max, Math.max(min, Math.round(parsed))));
					}
				}
			}}
			onAdjust={(delta, repeat) => {
				const amount = repeat ? step * 5 : step;
				const next = Math.min(max, Math.max(min, value + delta * amount));
				if (next !== value) {
					playSound('move');
					onChange(next);
				}
			}}
		>
			<span className="value-chip">
				<Icon name="chevronLeft" size={16} className="value-arrow" />
				<span>
					{value}
					{suffix}
				</span>
				<Icon name="chevronRight" size={16} className="value-arrow" />
			</span>
		</Row>
	);
}

export function SliderRow({
	value,
	min,
	max,
	step,
	format,
	onChange,
	...props
}: Omit<RowProps, 'children' | 'onClick' | 'onAdjust'> & { value: number; min: number; max: number; step: number; format: (value: number) => string; onChange: (value: number) => void }) {
	const percent = ((value - min) / (max - min)) * 100;
	const round = (number: number) => Math.round(number / step) * step;
	return (
		<Row
			{...props}
			onAdjust={(delta) => {
				const next = Math.min(max, Math.max(min, round(value + delta * step)));
				if (next !== value) {
					playSound('move');
					onChange(Number(next.toFixed(4)));
				}
			}}
		>
			<span className="slider">
				<span className="slider-track">
					<span className="slider-fill" style={{ transform: `scaleX(${percent / 100})` }} />
					<span className="slider-thumb" style={{ left: `${percent}%` }} />
				</span>
				<input
					type="range"
					className="slider-input"
					min={min}
					max={max}
					step={step}
					value={value}
					tabIndex={-1}
					aria-label={props.label}
					onClick={(event) => event.stopPropagation()}
					onChange={(event) => onChange(Number(event.target.value))}
				/>
				<span className="slider-value">{format(value)}</span>
			</span>
		</Row>
	);
}

export function TextRow({
	value,
	onChange,
	required,
	maxBytes,
	placeholder,
	...props
}: Omit<RowProps, 'children' | 'onClick'> & { value: string; required?: boolean; maxBytes?: number; placeholder?: string; onChange: (value: string) => void }) {
	const missing = required === true && props.disabled !== true && value.length === 0;
	return (
		<Row
			{...props}
			invalid={missing}
			onClick={async () => {
				const text = await editText({ title: props.label, value, maxBytes, placeholder, description: typeof props.description === 'string' ? props.description : undefined });
				if (text !== undefined) {
					onChange(text);
				}
			}}
		>
			<span className={`value-text ${missing ? 'value-missing' : ''}`}>{value.length > 0 ? value : missing ? 'Required' : placeholder ?? 'Not set'}</span>
		</Row>
	);
}

export function SectionTitle({ children }: { children: ReactNode }) {
	return <h3 className="section-title">{children}</h3>;
}
