import { useEffect } from 'react';
import { searchGames } from './actions';
import { Background } from './gfx/Background';
import { ADJUST_EVENT } from './components/controls';
import { Icon } from './components/Icon';
import { choose, ModalHost } from './components/Modal';
import { currentFocus, move } from './focus/navigation';
import { onInputDevice, setFallbackHandler } from './input/actions';
import { playSound, setSoundsEnabled } from './input/sounds';
import { kyty } from './kyty';
import { Cheats } from './screens/Cheats';
import { Home } from './screens/Home';
import { Library } from './screens/Library';
import { LogConsole } from './screens/LogConsole';
import { SettingsScreen } from './screens/Settings';
import { GameTrophies, TrophyOverview } from './screens/Trophies';
import { useStore, type Screen } from './store';

function ScreenView({ screen }: { screen: Screen }) {
	switch (screen.name) {
		case 'home':
			return <Home />;
		case 'library':
			return <Library />;
		case 'settings':
			return <SettingsScreen initialSection={screen.section} />;
		case 'gameSettings':
			return <SettingsScreen gameId={screen.gameId} initialSection={screen.section} />;
		case 'trophyOverview':
			return <TrophyOverview />;
		case 'trophies':
			return <GameTrophies gameId={screen.gameId!} />;
		case 'cheats':
			return <Cheats gameId={screen.gameId!} />;
		case 'log':
			return <LogConsole />;
	}
}

function installFallback(): void {
	setFallbackHandler((action, info) => {
		const store = useStore.getState();
		switch (action) {
			case 'up':
			case 'down':
			case 'left':
			case 'right': {
				const focused = currentFocus();
				if ((action === 'left' || action === 'right') && focused?.hasAttribute('data-adjustable') === true) {
					focused.dispatchEvent(new CustomEvent(ADJUST_EVENT, { detail: { delta: action === 'left' ? -1 : 1, repeat: info.repeat } }));
					return true;
				}
				if (move(action)) {
					playSound('move');
				}
				return true;
			}
			case 'confirm': {
				const focused = currentFocus();
				if (focused !== null && focused.getAttribute('aria-disabled') !== 'true' && !focused.hasAttribute('disabled')) {
					focused.click();
				} else {
					move('down');
				}
				return true;
			}
			case 'back': {
				const top = store.modals[store.modals.length - 1];
				if (top !== undefined) {
					if (top.dismissable) {
						playSound('back');
						store.closeModal(top.id);
					}
					return true;
				}
				if (store.screens.length > 1) {
					playSound('back');
					store.pop();
				}
				return true;
			}
			case 'fullscreen':
				playSound('confirm');
				void kyty.toggleFullscreen();
				return true;
			case 'home':
				if (store.modals.length === 0 && store.screens.length > 1) {
					playSound('back');
					store.goHome();
				}
				return true;
			case 'search':
				if (store.modals.length === 0) {
					void searchGames();
				}
				return true;
			default:
				return false;
		}
	});
}

export function App() {
	const screens = useStore((state) => state.screens);
	const modals = useStore((state) => state.modals);
	const games = useStore((state) => state.games);
	const selectedId = useStore((state) => state.selectedId);
	const app = useStore((state) => state.app);
	const run = useStore((state) => state.run);
	const toasts = useStore((state) => state.toasts);
	const launching = useStore((state) => state.launching);
	const top = screens[screens.length - 1]!;

	useEffect(() => {
		installFallback();
		return onInputDevice((device) => useStore.getState().setDevice(device));
	}, []);

	useEffect(() => {
		setSoundsEnabled(app?.prefs.ui_sounds ?? true);
	}, [app?.prefs.ui_sounds]);

	useEffect(() => {
		return kyty.on('confirmQuit', async () => {
			const stop = await choose({
				title: 'Quit the launcher?',
				message: `${useStore.getState().run.title ?? 'A game'} is still running.`,
				choices: [
					{ label: 'Stop the game and quit', value: true, destructive: true },
					{ label: 'Keep playing', value: false, primary: true },
				],
			});
			if (stop === true) {
				await kyty.quit(true);
			}
		});
	}, []);

	useEffect(() => {
		return kyty.on('notice', async (notice) => {
			const open = await choose({
				title: notice.title,
				message: <p className="pre">{notice.message}</p>,
				choices: notice.url !== undefined ? [{ label: 'Open the release page', value: true, primary: true }, { label: 'Later', value: false }] : [{ label: 'OK', value: false, primary: true }],
			});
			if (open === true && notice.url !== undefined) {
				await kyty.openExternal(notice.url);
			}
		});
	}, []);

	const selected = games.find((game) => game.id === selectedId);
	const screenGame = top.gameId !== undefined ? games.find((game) => game.id === top.gameId) : undefined;
	const art = (screenGame ?? (top.name === 'home' ? selected : screenGame ?? selected))?.background;
	const blur = top.name === 'home' ? (modals.length > 0 ? 0.6 : 0) : 1;
	const dim = top.name === 'home' ? 0 : 0.35;

	return (
		<div className={`app ${modals.length > 0 ? 'has-modal' : ''}`}>
			<Background image={art} blur={blur} dim={dim} animate={(app?.prefs.animated_background ?? true) && !matchMedia('(prefers-reduced-motion: reduce)').matches} paused={run.running} />
			<main className="screens">
				<ScreenView key={top.key} screen={top} />
			</main>
			<ModalHost />
			{launching !== undefined && (
				<div className="launch-overlay">
					<div className="launch-art">{games.find((game) => game.id === launching)?.icon !== undefined && <img src={games.find((game) => game.id === launching)!.icon} alt="" />}</div>
					<p>Starting {games.find((game) => game.id === launching)?.title}…</p>
				</div>
			)}
			<div className="toasts" aria-live="polite">
				{toasts.map((toast) => (
					<div key={toast.id} className={`toast toast-${toast.kind}`}>
						<Icon name={toast.kind === 'error' ? 'warning' : 'check'} size={20} />
						{toast.text}
					</div>
				))}
			</div>
		</div>
	);
}
