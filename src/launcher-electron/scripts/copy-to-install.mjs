// Copies the packaged launcher (npm run package) into an emulator install tree:
//   Linux:   <install>/launcher-electron/ and <install>/kyty-launcher.sh
//   Windows: <install>/launcher-electron/ and <install>/KytyPS5 Launcher.cmd
//   macOS:   <install>/KytyPS5 Launcher.app next to KytyPS5.app
// Usage: node scripts/copy-to-install.mjs <install-dir>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const install = process.argv[2];
if (install === undefined) {
	console.error('Usage: node scripts/copy-to-install.mjs <install-dir>');
	process.exit(2);
}
const dist = path.join(root, 'dist');
const copy = (from, to) => {
	if (!fs.existsSync(from)) {
		console.error(`Missing ${from}; run "npm run package" first.`);
		process.exit(1);
	}
	fs.rmSync(to, { recursive: true, force: true });
	fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
	console.log(`Copied ${from} -> ${to}`);
};

fs.mkdirSync(install, { recursive: true });
if (process.platform === 'darwin') {
	const app = fs.readdirSync(dist).map((name) => path.join(dist, name, 'KytyPS5 Launcher.app')).find((file) => fs.existsSync(file));
	copy(app ?? path.join(dist, 'mac', 'KytyPS5 Launcher.app'), path.join(install, 'KytyPS5 Launcher.app'));
} else if (process.platform === 'win32') {
	copy(path.join(dist, 'win-unpacked'), path.join(install, 'launcher-electron'));
	fs.writeFileSync(path.join(install, 'KytyPS5 Launcher.cmd'), '@echo off\r\nstart "" "%~dp0launcher-electron\\kyty-launcher.exe" %*\r\n');
} else {
	copy(path.join(dist, 'linux-unpacked'), path.join(install, 'launcher-electron'));
	const wrapper = path.join(install, 'kyty-launcher.sh');
	fs.copyFileSync(path.join(root, 'scripts', 'kyty-launcher.sh'), wrapper);
	fs.chmodSync(wrapper, 0o755);
}
