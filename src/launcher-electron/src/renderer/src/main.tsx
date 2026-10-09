import '@fontsource-variable/inter';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { GamepadSource, installKeyboard } from './input/sources';
import { kyty } from './kyty';
import { useStore } from './store';

async function boot(): Promise<void> {
	const store = useStore.getState();
	const [app, games, run, log] = await Promise.all([kyty.getState(), kyty.getLibrary(), kyty.getRunState(), kyty.getLog()]);
	store.setApp(app);
	store.setGames(games);
	store.setRun(run);
	store.setLog(log);
	const last = games.find((game) => game.gamePath === app.prefs.last_selected_game);
	if (last !== undefined) {
		store.select(last.id);
	}

	kyty.on('state', (state) => useStore.getState().setApp(state));
	kyty.on('library', (list) => useStore.getState().setGames(list));
	kyty.on('run', (state) => useStore.getState().setRun(state));
	kyty.on('log', (lines) => useStore.getState().appendLog(lines));

	installKeyboard();
	const gamepad = new GamepadSource({
		enabled: () => true,
		swapConfirm: () => useStore.getState().app?.prefs.confirm_button === 'circle',
	});
	kyty.on('sdl', (event) => gamepad.handleSdl(event));
	gamepad.start();

	createRoot(document.getElementById('root')!).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}

void boot();
