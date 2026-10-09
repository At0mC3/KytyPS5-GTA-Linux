import { useRef, type ReactNode } from 'react';
import { hoverFocus, useActions, useInitialFocus } from '../hooks';
import { playSound } from '../input/sounds';
import { showModal, useStore } from '../store';
import { Hints, type Hint } from './Glyph';
import { Icon, type IconName } from './Icon';

export function ModalHost() {
	const modals = useStore((state) => state.modals);
	const close = useStore((state) => state.closeModal);
	return (
		<>
			{modals.map((modal, index) => (
				<div key={modal.id} className="modal-layer" data-nav-scope={100 + index} data-nav-inactive={index < modals.length - 1 ? '' : undefined}>
					{modal.render((value) => close(modal.id, value))}
				</div>
			))}
		</>
	);
}

interface FrameProps {
	title?: ReactNode;
	subtitle?: ReactNode;
	children: ReactNode;
	onClose: () => void;
	variant?: 'dialog' | 'sheet' | 'full' | 'wide';
	hints?: Hint[];
	dismissable?: boolean;
	onAction?: Parameters<typeof useActions>[0];
	focusKey?: unknown;
}

// A dialog in the console's style; Back closes it unless the content handles the action.
export function ModalFrame({ title, subtitle, children, onClose, variant = 'dialog', hints, dismissable = true, onAction, focusKey }: FrameProps) {
	const ref = useRef<HTMLDivElement>(null);
	useInitialFocus(ref, [focusKey]);
	useActions((action, info) => {
		if (onAction?.(action, info) === true) {
			return true;
		}
		if (action === 'back' && dismissable) {
			playSound('back');
			onClose();
			return true;
		}
		return false;
	});
	return (
		<div className={`modal modal-${variant}`} ref={ref} role="dialog" aria-modal="true">
			<div className="modal-backdrop" onClick={dismissable ? onClose : undefined} />
			<div className="modal-panel">
				{(title !== undefined || subtitle !== undefined) && (
					<header className="modal-header">
						{title !== undefined && <h2>{title}</h2>}
						{subtitle !== undefined && <p className="modal-subtitle">{subtitle}</p>}
					</header>
				)}
				<div className="modal-body">{children}</div>
			</div>
			<Hints items={hints ?? [{ action: 'confirm', label: 'OK' }, ...(dismissable ? [{ action: 'back' as const, label: 'Back' }] : [])]} />
		</div>
	);
}

export interface Choice<T> {
	label: string;
	value: T;
	primary?: boolean;
	destructive?: boolean;
}

export function choose<T>(options: { title: string; message?: ReactNode; choices: Choice<T>[]; dismissable?: boolean }): Promise<T | undefined> {
	return showModal<T>(
		(close) => (
			<ModalFrame title={options.title} onClose={() => close()} dismissable={options.dismissable ?? true}>
				{options.message !== undefined && <div className="dialog-message">{options.message}</div>}
				<div className="dialog-buttons">
					{options.choices.map((choice, index) => (
						<button
							key={index}
							data-nav
							data-nav-default={choice.primary === true ? '' : undefined}
							className={`button ${choice.primary === true ? 'button-primary' : ''} ${choice.destructive === true ? 'button-danger' : ''}`}
							onClick={() => {
								playSound('confirm');
								close(choice.value);
							}}
							{...hoverFocus}
						>
							{choice.label}
						</button>
					))}
				</div>
			</ModalFrame>
		),
		{ dismissable: options.dismissable },
	);
}

export async function confirm(title: string, message: ReactNode, confirmLabel = 'OK', options: { destructive?: boolean; cancelLabel?: string } = {}): Promise<boolean> {
	const result = await choose({
		title,
		message,
		choices: [
			{ label: confirmLabel, value: true, primary: options.destructive !== true, destructive: options.destructive },
			{ label: options.cancelLabel ?? 'Cancel', value: false, primary: options.destructive === true },
		],
	});
	return result === true;
}

export function alert(title: string, message: ReactNode): Promise<boolean | undefined> {
	return choose({ title, message, choices: [{ label: 'OK', value: true, primary: true }] });
}

export interface MenuItem<T> {
	label: string;
	value: T;
	icon?: IconName;
	disabled?: boolean;
	detail?: string;
	destructive?: boolean;
}

// A side sheet menu, like the console's options menu.
export function menu<T>(title: string, items: MenuItem<T>[], subtitle?: string): Promise<T | undefined> {
	return showModal<T>((close) => (
		<ModalFrame title={title} subtitle={subtitle} variant="sheet" onClose={() => close()} hints={[{ action: 'confirm', label: 'Select' }, { action: 'back', label: 'Back' }]}>
			<div className="menu-list" data-nav-scroll="24">
				{items.map((item, index) => (
					<button
						key={index}
						data-nav
						data-nav-default={index === items.findIndex((candidate) => candidate.disabled !== true) ? '' : undefined}
						className={`menu-item ${item.destructive === true ? 'menu-item-danger' : ''}`}
						disabled={item.disabled}
						onClick={() => {
							playSound('confirm');
							close(item.value);
						}}
						{...hoverFocus}
					>
						{item.icon !== undefined && <Icon name={item.icon} size={22} />}
						<span className="menu-label">{item.label}</span>
						{item.detail !== undefined && <span className="menu-detail">{item.detail}</span>}
					</button>
				))}
			</div>
		</ModalFrame>
	));
}

export interface PickOption<T> {
	label: string;
	value: T;
	description?: string;
	disabled?: boolean;
}

// A list picker for settings values.
export function pick<T>(title: string, options: PickOption<T>[], current: T): Promise<T | undefined> {
	return showModal<T>((close) => (
		<ModalFrame title={title} variant="sheet" onClose={() => close()} hints={[{ action: 'confirm', label: 'Select' }, { action: 'back', label: 'Back' }]}>
			<div className="menu-list" data-nav-scroll="24">
				{options.map((option, index) => (
					<button
						key={index}
						data-nav
						data-nav-default={Object.is(option.value, current) ? '' : undefined}
						className={`menu-item pick-item ${Object.is(option.value, current) ? 'pick-current' : ''}`}
						disabled={option.disabled}
						onClick={() => {
							playSound('confirm');
							close(option.value);
						}}
						{...hoverFocus}
					>
						<span className="pick-radio" aria-hidden="true" />
						<span className="menu-label">
							{option.label}
							{option.description !== undefined && <small>{option.description}</small>}
						</span>
					</button>
				))}
			</div>
		</ModalFrame>
	));
}
