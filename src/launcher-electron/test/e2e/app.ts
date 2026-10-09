import path from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import type { Fixture } from '../fixture';

export interface Launched {
	app: ElectronApplication;
	page: Page;
}

export async function launchApp(fixture: Fixture, args: string[] = [], size = { width: 1280, height: 720 }): Promise<Launched> {
	const app = await electron.launch({
		args: [path.join(__dirname, '..', '..', 'out', 'main', 'index.js'), '--no-sandbox', ...(process.env.KYTY_E2E_SWIFTSHADER === '1' ? ['--enable-unsafe-swiftshader'] : []), ...args],
		cwd: fixture.root,
		env: fixture.env,
	});
	const page = await app.firstWindow();
	await app.evaluate(({ BrowserWindow }, { width, height }) => {
		const window = BrowserWindow.getAllWindows()[0];
		if (window !== undefined && !window.isFullScreen()) {
			window.setContentSize(width, height);
		}
	}, size);
	await page.waitForSelector('.screen');
	return { app, page };
}

// Simulates a controller: replaces navigator.getGamepads with a pad whose buttons the test sets.
export async function installFakeGamepad(page: Page): Promise<void> {
	await page.evaluate(() => {
		const state = { buttons: new Array<boolean>(17).fill(false), axes: [0, 0, 0, 0] };
		(window as unknown as { __pad: typeof state }).__pad = state;
		navigator.getGamepads = () =>
			[
				{
					id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)',
					index: 0,
					connected: true,
					mapping: 'standard',
					timestamp: performance.now(),
					axes: state.axes,
					buttons: state.buttons.map((pressed) => ({ pressed, touched: pressed, value: pressed ? 1 : 0 })),
					hapticActuators: [],
					vibrationActuator: null,
				},
			] as unknown as Gamepad[];
	});
}

export const BUTTONS = { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, create: 8, options: 9, up: 12, down: 13, left: 14, right: 15 } as const;

export async function press(page: Page, button: keyof typeof BUTTONS): Promise<void> {
	const index = BUTTONS[button];
	await page.evaluate((i) => ((window as unknown as { __pad: { buttons: boolean[] } }).__pad.buttons[i] = true), index);
	await page.waitForTimeout(80);
	await page.evaluate((i) => ((window as unknown as { __pad: { buttons: boolean[] } }).__pad.buttons[i] = false), index);
	await page.waitForTimeout(160);
}
