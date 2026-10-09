// Client for "kyty_emulator --query <command>" (src/query/launcherQuery.h in the emulator).
// Builds without --query print their usage text and exit with an error; callers fall back then.
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { EmulatorInfo, GpuInfo } from '../../shared/types';

const RESULT_PREFIX = 'KYTY_QUERY_RESULT ';

export interface ProcessOutput {
	code: number | null;
	stdout: string;
	stderr: string;
}

export function runProcess(file: string, args: string[], input?: string, timeoutMs = 20_000): Promise<ProcessOutput> {
	return new Promise((resolve) => {
		let stdout = '';
		let stderr = '';
		let settled = false;
		const child = spawn(file, args, { cwd: path.dirname(file), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
		const finish = (code: number | null) => {
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				resolve({ code, stdout, stderr });
			}
		};
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			finish(null);
		}, timeoutMs);
		child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
			stderr += chunk;
		});
		child.on('error', (error) => {
			stderr += error.message;
			finish(null);
		});
		child.on('close', (code) => finish(code));
		child.stdin.on('error', () => undefined);
		child.stdin.end(input ?? '');
	});
}

export function parseQueryResult(stdout: string): unknown {
	for (const line of stdout.split(/\r?\n/)) {
		if (line.startsWith(RESULT_PREFIX)) {
			try {
				return JSON.parse(line.slice(RESULT_PREFIX.length));
			} catch {
				return undefined;
			}
		}
	}
	return undefined;
}

export async function runQuery(emulator: string, command: string, request?: unknown, timeoutMs?: number): Promise<unknown> {
	const output = await runProcess(emulator, ['--query', command], request === undefined ? '' : JSON.stringify(request), timeoutMs);
	return parseQueryResult(output.stdout);
}

// The version line the Qt launcher shows: the first line of the usage text, or the second
// when the first is an "exe_name" line.
export function parseVersionOutput(stdout: string): string | undefined {
	const lines = stdout.split(/[\r\n]+/).filter((line) => line.length > 0);
	if (lines.length < 2) {
		return undefined;
	}
	return lines[0]!.startsWith('exe_name') ? lines[1] : lines[0];
}

interface InfoResult {
	version?: string;
	gitVersion?: string;
	buildLabel?: string;
	releaseTag?: string;
	updateCheckSupported?: boolean;
	gpus?: { index: number; name: string; type: string; meetsRequirements: boolean }[];
	gpuError?: string;
	microphones?: string[];
	micError?: string;
}

export async function queryEmulatorInfo(emulator: string): Promise<EmulatorInfo> {
	const usage = await runProcess(emulator, [], undefined, 15_000);
	const version = parseVersionOutput(usage.stdout);
	const info: EmulatorInfo = {
		found: true,
		path: emulator,
		directory: path.dirname(emulator),
		version,
		buildString: version,
		queryAvailable: false,
		updateCheckSupported: false,
		gpus: [],
		microphones: [],
	};
	const result = (await runQuery(emulator, 'info', undefined, 30_000)) as InfoResult | undefined;
	if (result === undefined || typeof result !== 'object') {
		info.gpuError = 'This emulator build cannot list GPUs; update it to choose one.';
		info.micError = 'This emulator build cannot list microphones.';
		return info;
	}
	info.queryAvailable = true;
	info.updateCheckSupported = result.updateCheckSupported === true;
	info.releaseTag = result.releaseTag;
	if (result.buildLabel !== undefined) {
		info.buildString = `${result.buildLabel} (v${result.version ?? '?'})`;
	}
	info.gpus = (result.gpus ?? []).map(
		(gpu): GpuInfo => ({ index: gpu.index, name: gpu.name, type: gpu.type, meetsRequirements: gpu.meetsRequirements }),
	);
	info.gpuError = result.gpuError;
	info.microphones = result.microphones ?? [];
	info.micError = result.micError;
	return info;
}
