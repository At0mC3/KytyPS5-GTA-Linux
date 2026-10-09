// Builds a throwaway launcher environment: game folders, a .zar archive, Kyty.ini and a fake
// emulator, for end-to-end tests and screenshots.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) {
		c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	}
	return c >>> 0;
});

function crc32(data: Buffer): number {
	let crc = 0xffffffff;
	for (const byte of data) {
		crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, crc]);
}

export function encodePng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Buffer {
	const raw = Buffer.alloc((width * 3 + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (width * 3 + 1)] = 0;
		for (let x = 0; x < width; x++) {
			const [r, g, b] = pixel(x, y);
			const offset = y * (width * 3 + 1) + 1 + x * 3;
			raw[offset] = r;
			raw[offset + 1] = g;
			raw[offset + 2] = b;
		}
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 2;
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function hsl(h: number, s: number, l: number): [number, number, number] {
	const a = s * Math.min(l, 1 - l);
	const f = (n: number) => {
		const k = (n + h / 30) % 12;
		return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
	};
	return [f(0), f(8), f(4)];
}

// A cover-like icon: a diagonal gradient with a ring emblem.
export function iconPng(hue: number, size = 256): Buffer {
	return encodePng(size, size, (x, y) => {
		const t = (x + y) / (2 * size);
		const dx = x - size * 0.5;
		const dy = y - size * 0.46;
		const d = Math.sqrt(dx * dx + dy * dy) / size;
		const ring = d > 0.2 && d < 0.27 ? 0.35 : d <= 0.2 ? 0.12 : 0;
		const [r, g, b] = hsl((hue + t * 50) % 360, 0.75, 0.22 + t * 0.32);
		return [Math.min(255, r + ring * 255), Math.min(255, g + ring * 255), Math.min(255, b + ring * 255)];
	});
}

export function artPng(hue: number, width = 640, height = 360): Buffer {
	return encodePng(width, height, (x, y) => {
		const u = x / width;
		const v = y / height;
		const wave = Math.sin(u * 7 + v * 3) * 0.5 + 0.5;
		return hsl((hue + u * 60 + wave * 30) % 360, 0.6, 0.12 + v * 0.25 + wave * 0.12);
	});
}

export interface FixtureGame {
	folder: string;
	title: string;
	titleId: string;
	version: string;
	hue: number;
	art?: string;
}

export const DEFAULT_GAMES: FixtureGame[] = [
	{ folder: 'GTA V', title: 'Grand Theft Auto V', titleId: 'PPSA04263', version: '01.010.002', hue: 140, art: '../../../ForkImgs/1.png' },
	{ folder: 'Neon Drift', title: 'Neon Drift', titleId: 'PPSA01001', version: '01.000.000', hue: 290 },
	{ folder: 'Skyward Isles', title: 'Skyward Isles', titleId: 'PPSA01002', version: '01.004.000', hue: 200, art: '../../../ForkImgs/2.png' },
	{ folder: 'Crimson Harbor', title: 'Crimson Harbor', titleId: 'PPSA01003', version: '02.000.000', hue: 5 },
	{ folder: 'Echoes of Arden', title: 'Echoes of Arden', titleId: 'PPSA01004', version: '01.000.001', hue: 40 },
	{ folder: 'Pixel Kart', title: 'Pixel Kart Grand Prix', titleId: 'PPSA01005', version: '01.000.000', hue: 95 },
];

export interface Fixture {
	root: string;
	gamesDir: string;
	emulatorDir: string;
	settingsFile: string;
	argvFile: string;
	controllerLog: string;
	env: Record<string, string>;
	cleanup: () => void;
}

export function createFixture(options: { games?: FixtureGame[]; ini?: string; archive?: boolean } = {}): Fixture {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kyty-launcher-e2e-'));
	const gamesDir = path.join(root, 'Games');
	const emulatorDir = path.join(root, 'Kyty');
	fs.mkdirSync(gamesDir, { recursive: true });
	fs.mkdirSync(emulatorDir, { recursive: true });
	const emulator = path.join(emulatorDir, 'kyty_emulator');
	fs.copyFileSync(path.join(__dirname, 'fake-emulator', 'kyty_emulator'), emulator);
	fs.chmodSync(emulator, 0o755);
	const icon = path.join(root, 'trophy.png');
	fs.writeFileSync(icon, iconPng(48, 96));

	for (const game of options.games ?? DEFAULT_GAMES) {
		const dir = path.join(gamesDir, game.folder);
		fs.mkdirSync(path.join(dir, 'sce_sys', 'trophy2'), { recursive: true });
		fs.writeFileSync(path.join(dir, 'eboot.bin'), 'ELF');
		fs.writeFileSync(
			path.join(dir, 'sce_sys', 'param.json'),
			JSON.stringify({
				titleId: game.titleId,
				appVersion: game.version,
				requiredSystemSoftwareVersion: '0x0510000000000000',
				localizedParameters: { defaultLanguage: 'en-US', 'en-US': { titleName: game.title } },
			}),
		);
		fs.writeFileSync(path.join(dir, 'sce_sys', 'icon0.png'), iconPng(game.hue));
		const art = game.art === undefined ? undefined : path.resolve(__dirname, game.art);
		if (art !== undefined && fs.existsSync(art)) {
			fs.copyFileSync(art, path.join(dir, 'sce_sys', 'pic0.png'));
		} else {
			fs.writeFileSync(path.join(dir, 'sce_sys', 'pic0.png'), artPng(game.hue));
		}
		if (game.titleId === 'PPSA04263') {
			fs.writeFileSync(path.join(dir, 'sce_sys', 'trophy2', 'trophy00.ucp'), 'fixture');
		}
	}
	if (options.archive !== false) {
		fs.writeFileSync(path.join(gamesDir, 'Retro Collection.zar'), 'ZAR fixture');
	}

	const settingsFile = path.join(root, 'config', 'Kyty.ini');
	fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
	fs.writeFileSync(
		settingsFile,
		options.ini ?? ['[Launcher]', `game_dirs=${gamesDir}`, '', '[ElectronLauncher]', 'ui_sounds=false', 'minimize_on_launch=false', ''].join('\n'),
	);

	const argvFile = path.join(root, 'argv.jsonl');
	const controllerLog = path.join(root, 'controller.log');
	const env: Record<string, string> = {
		...(process.env as Record<string, string>),
		KYTY_LAUNCHER_TEST: '1',
		KYTY_EMULATOR: emulator,
		KYTY_SETTINGS_FILE: settingsFile,
		KYTY_USER_DATA: path.join(root, 'userData'),
		KYTY_FAKE_ARGV: argvFile,
		KYTY_FAKE_CTRL_LOG: controllerLog,
		KYTY_FAKE_ICON: icon,
		XDG_CONFIG_HOME: path.join(root, 'xdg'),
		ELECTRON_ENABLE_LOGGING: '0',
	};
	return { root, gamesDir, emulatorDir, settingsFile, argvFile, controllerLog, env, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
