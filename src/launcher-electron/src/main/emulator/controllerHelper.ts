// Drives "kyty_emulator --query controller": previews the DualSense lightbar color over SDL, the
// way the Qt launcher's ControllerLightbar does, and can relay controller input when the
// Chromium Gamepad API does not see the controller. Stopped while a game runs.
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import type { SdlControllerEvent } from '../../shared/types';

const EVENT_PREFIX = 'KYTY_CTRL ';

export class ControllerHelper extends EventEmitter<{ event: [SdlControllerEvent] }> {
	private child: ChildProcess | undefined;
	private color = '';
	private input = false;
	private buffer = '';

	constructor(private emulator: string | undefined) {
		super();
	}

	setEmulator(emulator: string | undefined): void {
		this.emulator = emulator;
	}

	// Applies the desired state, starting or stopping the helper as needed.
	update(options: { color: string; input: boolean; suspended: boolean }): void {
		const wanted = !options.suspended && (options.color.length > 0 || options.input);
		if (!wanted) {
			this.stop();
			this.color = options.color;
			this.input = options.input;
			return;
		}
		const started = this.child === undefined;
		if (started && !this.start()) {
			return;
		}
		if (started || options.color !== this.color) {
			this.send(options.color.length > 0 ? `led ${options.color}` : 'led off');
		}
		if (started || options.input !== this.input) {
			this.send(options.input ? 'input on' : 'input off');
		}
		this.color = options.color;
		this.input = options.input;
	}

	private start(): boolean {
		if (this.emulator === undefined) {
			return false;
		}
		try {
			const child = spawn(this.emulator, ['--query', 'controller'], {
				cwd: path.dirname(this.emulator),
				windowsHide: true,
				stdio: ['pipe', 'pipe', 'ignore'],
			});
			this.child = child;
			this.buffer = '';
			child.stdout?.setEncoding('utf8').on('data', (chunk: string) => this.onData(chunk));
			child.stdin?.on('error', () => undefined);
			child.on('error', () => undefined);
			child.on('close', () => {
				if (this.child === child) {
					this.child = undefined;
				}
			});
			return true;
		} catch {
			return false;
		}
	}

	private onData(chunk: string): void {
		this.buffer += chunk;
		const lines = this.buffer.split(/\r?\n/);
		this.buffer = lines.pop() ?? '';
		for (const line of lines) {
			if (!line.startsWith(EVENT_PREFIX)) {
				continue;
			}
			try {
				this.emit('event', JSON.parse(line.slice(EVENT_PREFIX.length)) as SdlControllerEvent);
			} catch {
				// Ignore malformed lines.
			}
		}
	}

	private send(command: string): void {
		this.child?.stdin?.write(`${command}\n`);
	}

	stop(): void {
		const child = this.child;
		if (child === undefined) {
			return;
		}
		this.child = undefined;
		// Closing stdin ends the helper cleanly; kill it if it lingers.
		child.stdin?.end();
		setTimeout(() => {
			if (child.exitCode === null && child.signalCode === null) {
				child.kill();
			}
		}, 1000);
	}
}
