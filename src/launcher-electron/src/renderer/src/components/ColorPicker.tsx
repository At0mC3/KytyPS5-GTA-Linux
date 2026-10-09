import { useEffect, useState } from 'react';
import { hoverFocus } from '../hooks';
import { playSound } from '../input/sounds';
import { kyty } from '../kyty';
import { showModal } from '../store';
import { SliderRow } from './controls';
import { ModalFrame } from './Modal';
import { editText } from './OnScreenKeyboard';

const PRESETS = ['#0070d1', '#00b4ff', '#00d18f', '#36d100', '#ffd400', '#ff8a00', '#ff2d2d', '#ff3c9e', '#b14cff', '#ffffff'];

function hexToHsv(hex: string): { h: number; s: number; v: number } {
	const value = parseInt(hex.slice(1), 16);
	const r = ((value >> 16) & 255) / 255;
	const g = ((value >> 8) & 255) / 255;
	const b = (value & 255) / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	let h = 0;
	if (d !== 0) {
		h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
		h *= 60;
		if (h < 0) h += 360;
	}
	return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToHex(h: number, s: number, v: number): string {
	const c = v * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = v - c;
	const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
	const hex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
	return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function Picker({ current, close }: { current: string; close: (value?: string) => void }) {
	const [color, setColor] = useState(current.length > 0 ? current : '#0070d1');
	const hsv = hexToHsv(color);

	useEffect(() => {
		void kyty.previewLightbar(color);
	}, [color]);

	const finish = (value?: string) => {
		void kyty.previewLightbar(null);
		close(value);
	};

	return (
		<ModalFrame
			title="DualSense lightbar"
			subtitle="Bluetooth controllers may take a few seconds to show the new color."
			onClose={() => finish()}
			hints={[
				{ action: 'confirm', label: 'Select' },
				{ action: 'left', label: 'Adjust' },
				{ action: 'options', label: 'Use color' },
				{ action: 'back', label: 'Cancel' },
			]}
			onAction={(action) => {
				if (action === 'options') {
					finish(color);
					return true;
				}
				return false;
			}}
		>
			<div className="color-picker">
				<div className="color-preview" style={{ background: color, boxShadow: `0 0 60px ${color}88` }}>
					<span>{color.toUpperCase()}</span>
				</div>
				<div className="color-presets" data-nav-group>
					{PRESETS.map((preset, index) => (
						<button
							key={preset}
							className={`color-swatch ${preset === color ? 'color-swatch-current' : ''}`}
							style={{ background: preset }}
							data-nav
							data-nav-default={index === 0 ? '' : undefined}
							aria-label={preset}
							onClick={() => {
								playSound('move');
								setColor(preset);
							}}
							{...hoverFocus}
						/>
					))}
				</div>
				<div className="color-sliders">
					<SliderRow label="Hue" value={Math.round(hsv.h)} min={0} max={359} step={6} format={(value) => `${value}°`} onChange={(value) => setColor(hsvToHex(value, hsv.s || 1, hsv.v || 1))} />
					<SliderRow label="Saturation" value={Math.round(hsv.s * 100)} min={0} max={100} step={5} format={(value) => `${value}%`} onChange={(value) => setColor(hsvToHex(hsv.h, value / 100, hsv.v))} />
					<SliderRow label="Brightness" value={Math.round(hsv.v * 100)} min={5} max={100} step={5} format={(value) => `${value}%`} onChange={(value) => setColor(hsvToHex(hsv.h, hsv.s, value / 100))} />
				</div>
				<div className="dialog-buttons">
					<button className="button button-primary" data-nav onClick={() => finish(color)} {...hoverFocus}>
						Use color
					</button>
					<button
						className="button"
						data-nav
						onClick={async () => {
							const value = await editText({ title: 'Color (#RRGGBB)', value: color });
							if (value !== undefined && /^#?[0-9a-fA-F]{6}$/.test(value.trim())) {
								setColor(`#${value.trim().replace('#', '').toLowerCase()}`);
							}
						}}
						{...hoverFocus}
					>
						Enter hex…
					</button>
					<button className="button" data-nav onClick={() => finish('')} {...hoverFocus}>
						Let the game control it
					</button>
				</div>
			</div>
		</ModalFrame>
	);
}

// Resolves with "#rrggbb", "" for "let the game control the lightbar", or undefined when canceled.
export function pickColor(current: string): Promise<string | undefined> {
	return showModal<string>((close) => <Picker current={current} close={close} />);
}
