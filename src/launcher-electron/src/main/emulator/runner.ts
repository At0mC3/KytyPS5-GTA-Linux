// Runs one game at a time and collects its output for the in-app log console. The emulator is
// started directly (no terminal window); its output must always be drained, or a full pipe would
// stall the game.
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import type { LogLine, RunState } from '../../shared/types';

const MAX_LINES = 20_000;
const FLUSH_MS = 50;
const STOP_GRACE_MS = 3_000;

export interface RunnerEvents {
	state: [RunState];
	log: [LogLine[]];
}

export class GameRunner extends EventEmitter<RunnerEvents> {
	private child: ChildProcess | undefined;
	private state: RunState = { running: false };
	private lines: LogLine[] = [];
	private pending: LogLine[] = [];
	private partial: Record<'out' | 'err', string> = { out: '', err: '' };
	private flushTimer: NodeJS.Timeout | undefined;
	private killTimer: NodeJS.Timeout | undefined;

	get current(): RunState {
		return this.state;
	}

	get log(): LogLine[] {
		return this.lines;
	}

	private setState(state: RunState): void {
		this.state = state;
		this.emit('state', state);
	}

	private push(line: LogLine): void {
		this.lines.push(line);
		if (this.lines.length > MAX_LINES) {
			this.lines.splice(0, this.lines.length - MAX_LINES);
		}
		this.pending.push(line);
		if (this.flushTimer === undefined) {
			this.flushTimer = setTimeout(() => this.flush(), FLUSH_MS);
		}
	}

	private flush(): void {
		this.flushTimer = undefined;
		if (this.pending.length > 0) {
			const batch = this.pending;
			this.pending = [];
			this.emit('log', batch);
		}
	}

	private onData(stream: 'out' | 'err', chunk: string): void {
		const text = this.partial[stream] + chunk;
		const parts = text.split(/\r?\n/);
		this.partial[stream] = parts.pop() ?? '';
		for (const part of parts) {
			this.push({ stream, text: part });
		}
		// Keep long partial lines (progress output) from growing without bound.
		if (this.partial[stream].length > 64 * 1024) {
			this.push({ stream, text: this.partial[stream] });
			this.partial[stream] = '';
		}
	}

	system(text: string): void {
		this.push({ stream: 'sys', text });
	}

	start(emulator: string, args: string[], meta: { gameId: string; title: string }): { ok: boolean; error?: string } {
		if (this.child !== undefined) {
			return { ok: false, error: 'A game is already running.' };
		}
		this.lines = [];
		this.partial = { out: '', err: '' };
		this.system(`$ ${[emulator, ...args].map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg)).join(' ')}`);
		let child: ChildProcess;
		try {
			child = spawn(emulator, args, {
				cwd: path.dirname(emulator),
				windowsHide: true,
				stdio: ['ignore', 'pipe', 'pipe'],
				env: { ...process.env, FORCE_COLOR: '1' },
			});
		} catch (error) {
			return { ok: false, error: (error as Error).message };
		}
		this.child = child;
		child.stdout?.setEncoding('utf8').on('data', (chunk: string) => this.onData('out', chunk));
		child.stderr?.setEncoding('utf8').on('data', (chunk: string) => this.onData('err', chunk));
		child.on('error', (error) => {
			this.system(`Failed to start: ${error.message}`);
			this.finish(null, null, error.message);
		});
		child.on('close', (code, signal) => this.finish(code, signal));
		this.setState({ running: true, gameId: meta.gameId, title: meta.title, pid: child.pid, startedAt: Date.now() });
		return { ok: true };
	}

	private finish(code: number | null, signal: NodeJS.Signals | null, error?: string): void {
		if (this.child === undefined) {
			return;
		}
		this.child = undefined;
		clearTimeout(this.killTimer);
		for (const stream of ['out', 'err'] as const) {
			if (this.partial[stream].length > 0) {
				this.push({ stream, text: this.partial[stream] });
				this.partial[stream] = '';
			}
		}
		this.system(signal !== null ? `Emulator stopped (${signal}).` : `Emulator exited with code ${code ?? '?'}.`);
		this.flush();
		this.setState({ ...this.state, running: false, exitCode: code, signal, error });
	}

	stop(): void {
		const child = this.child;
		if (child === undefined) {
			return;
		}
		this.system('Stopping the emulator…');
		child.kill('SIGTERM');
		clearTimeout(this.killTimer);
		this.killTimer = setTimeout(() => {
			if (this.child === child) {
				child.kill('SIGKILL');
			}
		}, STOP_GRACE_MS);
	}
}
