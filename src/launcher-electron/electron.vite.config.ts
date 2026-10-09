import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
	main: {
		build: {
			rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
		},
	},
	preload: {
		build: {
			// Sandboxed preloads must be CommonJS.
			rollupOptions: {
				input: { index: resolve(__dirname, 'src/preload/index.ts') },
				output: { format: 'cjs', entryFileNames: '[name].js' },
			},
		},
	},
	renderer: {
		root: resolve(__dirname, 'src/renderer'),
		plugins: [react()],
		build: {
			minify: 'esbuild',
			rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
		},
	},
});
