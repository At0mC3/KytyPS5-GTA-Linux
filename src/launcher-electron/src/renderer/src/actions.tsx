// UI flows shared by several screens: launching, the game options menu, search.
import type { Game } from '../../shared/types';
import { editText } from './components/OnScreenKeyboard';
import { alert, choose, confirm, menu, pick } from './components/Modal';
import { playSound } from './input/sounds';
import { kyty } from './kyty';
import { useStore } from './store';
import { GAME_STATUS_LABELS, type GameStatus } from '../../shared/types';
import { formatSize } from './format';

export async function launchGame(game: Game, decision?: 'recommended' | 'as-configured'): Promise<void> {
	const store = useStore.getState();
	if (store.run.running) {
		store.toast(`${store.run.title ?? 'A game'} is already running.`, 'error');
		playSound('error');
		return;
	}
	const result = await kyty.launch(game.id, decision);
	if (result.missingRecommended !== undefined && result.missingRecommended.length > 0) {
		const choice = await choose({
			title: 'Recommended settings',
			message: (
				<>
					<p>Grand Theft Auto V needs these settings, which are off in this configuration:</p>
					<ul>
						{result.missingRecommended.map((item) => (
							<li key={item}>{item}</li>
						))}
					</ul>
					<p>Launch with them turned on?</p>
				</>
			),
			choices: [
				{ label: 'Launch with recommended settings', value: 'recommended' as const, primary: true },
				{ label: 'Launch as configured', value: 'as-configured' as const },
				{ label: 'Cancel', value: undefined },
			],
		});
		if (choice !== undefined) {
			await launchGame(game, choice);
		}
		return;
	}
	if (!result.ok) {
		playSound('error');
		await alert("Can't start the game", result.error ?? 'Unknown error');
		return;
	}
	playSound('launch');
	store.select(game.id);
	store.setLaunching(game.id);
	setTimeout(() => useStore.getState().setLaunching(undefined), 2200);
}

export async function editCompatibility(game: Game): Promise<void> {
	const choice = await menu(
		'Compatibility',
		[
			{ label: 'Change status…', value: 'status' as const, icon: 'chip' as const, detail: GAME_STATUS_LABELS[game.status] },
			{ label: 'Edit comment…', value: 'comment' as const, icon: 'file' as const, detail: game.comment.length > 0 ? game.comment : undefined },
		],
		game.titleId,
	);
	if (choice === 'status') {
		const status = await pick<GameStatus>(
			'Status',
			(Object.keys(GAME_STATUS_LABELS) as GameStatus[]).map((value) => ({ label: GAME_STATUS_LABELS[value], value })),
			game.status,
		);
		if (status !== undefined) {
			await kyty.setCompat(game.id, { status });
		}
	} else if (choice === 'comment') {
		const comment = await editText({ title: `Comment for ${game.titleId}`, value: game.comment });
		if (comment !== undefined) {
			await kyty.setCompat(game.id, { comment });
		}
	}
}

export async function removeSaveData(game: Game): Promise<void> {
	const dirs = await kyty.saveDataDirs(game.id);
	if (dirs.length === 0) {
		await alert('Remove save data', 'No save data folder found for this game.');
		return;
	}
	const title = game.title.length > 0 ? game.title : game.titleId;
	const ok = await confirm(
		'Remove save data',
		<>
			<p>Remove save data for “{title}”? This will delete:</p>
			<ul className="path-list">
				{dirs.map((dir) => (
					<li key={dir}>{dir}</li>
				))}
			</ul>
			<p>This cannot be undone.</p>
		</>,
		'Delete',
		{ destructive: true },
	);
	if (!ok) {
		return;
	}
	const result = await kyty.removeSaveData(game.id);
	if (result.failed.length > 0) {
		await alert('Remove save data', `Could not remove:\n${result.failed.join('\n')}`);
	} else {
		useStore.getState().toast('Save data removed.');
	}
}

export async function showGameInfo(game: Game): Promise<void> {
	await alert(
		game.title,
		<dl className="info-list">
			<dt>Serial</dt>
			<dd>{game.titleId || '—'}</dd>
			<dt>Game version</dt>
			<dd>{game.gameVersion || '—'}</dd>
			<dt>Firmware version</dt>
			<dd>{game.firmwareVersion || '—'}</dd>
			<dt>Size</dt>
			<dd>{formatSize(game.size)}</dd>
			<dt>Type</dt>
			<dd>{game.archive ? 'ZArchive (.zar)' : 'Folder'}</dd>
			<dt>Path</dt>
			<dd className="mono">{game.gamePath}</dd>
			<dt>Settings</dt>
			<dd>{game.hasCustomConfig ? 'Game config' : 'Global settings'}</dd>
			<dt>Compatibility</dt>
			<dd>
				{GAME_STATUS_LABELS[game.status]}
				{game.comment.length > 0 ? ` — ${game.comment}` : ''}
			</dd>
		</dl>,
	);
}

export async function clearGameConfig(game: Game): Promise<void> {
	if (await confirm('Clear game config', "Clear this game's config and use global settings?", 'Clear', { destructive: true })) {
		const result = await kyty.clearGameSettings(game.id);
		if (!result.ok) {
			await alert('Clear game config', result.error);
		}
	}
}

export async function openGameMenu(game: Game): Promise<void> {
	const store = useStore.getState();
	const running = store.run.running;
	const thisRunning = running && store.run.gameId === game.id;
	const saveDirs = await kyty.saveDataDirs(game.id);
	const choice = await menu(
		game.title,
		[
			thisRunning
				? { label: 'Stop game', value: 'stop', icon: 'stop' }
				: { label: 'Play', value: 'play', icon: 'play', disabled: running || !game.available },
			{ label: 'Game settings…', value: 'settings', icon: 'gear', disabled: thisRunning },
			{ label: 'Clear game config', value: 'clear', icon: 'refresh', disabled: thisRunning || !game.hasCustomConfig },
			{ label: 'Trophies', value: 'trophies', icon: 'trophy', disabled: game.trophies === undefined },
			...(game.cheatsSupported ? [{ label: 'Cheats (experimental)…', value: 'cheats', icon: 'flask' as const }] : []),
			{ label: 'Open game folder', value: 'folder', icon: 'folderOpen', disabled: !game.available },
			{ label: 'Remove save data…', value: 'save', icon: 'trash', disabled: running || saveDirs.length === 0, destructive: true },
			...(store.app?.compatLocal === true && game.titleId.trim().length > 0 ? [{ label: 'Compatibility…', value: 'compat', icon: 'chip' as const }] : []),
			{ label: 'Emulator log', value: 'log', icon: 'terminal', disabled: store.log.length === 0 },
			{ label: 'Information', value: 'info', icon: 'info' },
		],
		[game.titleId, game.gameVersion].filter((part) => part.length > 0).join(' · '),
	);
	switch (choice) {
		case 'play':
			await launchGame(game);
			break;
		case 'stop':
			await kyty.stopGame();
			break;
		case 'settings':
			store.push({ name: 'gameSettings', gameId: game.id });
			break;
		case 'clear':
			await clearGameConfig(game);
			break;
		case 'trophies':
			store.push({ name: 'trophies', gameId: game.id });
			break;
		case 'cheats':
			store.push({ name: 'cheats', gameId: game.id });
			break;
		case 'folder': {
			const result = await kyty.openGameFolder(game.id);
			if (!result.ok) await alert('Open game folder', result.error);
			break;
		}
		case 'save':
			await removeSaveData(game);
			break;
		case 'compat':
			await editCompatibility(game);
			break;
		case 'log':
			store.push({ name: 'log' });
			break;
		case 'info':
			await showGameInfo(game);
			break;
		default:
			break;
	}
}

export async function searchGames(): Promise<void> {
	const query = await editText({ title: 'Search games', value: '', placeholder: 'Name or serial' });
	if (query === undefined) {
		return;
	}
	const text = query.trim().toLowerCase();
	const games = useStore.getState().games.filter((game) => text.length === 0 || game.title.toLowerCase().includes(text) || game.titleId.toLowerCase().includes(text));
	if (games.length === 0) {
		await alert('Search', `No games match “${query.trim()}”.`);
		return;
	}
	const id = await menu(
		`Results for “${query.trim()}”`,
		games.map((game) => ({ label: game.title, value: game.id, detail: game.titleId, icon: 'disc' as const })),
	);
	if (id !== undefined) {
		const store = useStore.getState();
		store.select(id);
		store.goHome();
	}
}
