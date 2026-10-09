import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GAME_STATUS_COLORS, GAME_STATUS_LABELS, type Game } from '../../../shared/types';
import { editCompatibility, launchGame, openGameMenu, searchGames, showGameInfo } from '../actions';
import { browse } from '../components/FolderBrowser';
import { Hints } from '../components/Glyph';
import { Icon } from '../components/Icon';
import { alert } from '../components/Modal';
import { TopBar } from '../components/TopBar';
import { TrophyCup } from '../components/Trophy';
import { focusElement } from '../focus/navigation';
import { formatSize } from '../format';
import { hoverFocus, useActions } from '../hooks';
import { playSound } from '../input/sounds';
import { kyty } from '../kyty';
import { useStore } from '../store';

function useViewport() {
	const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
	useEffect(() => {
		const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	}, []);
	return size;
}

function TileArt({ game }: { game: Game }) {
	const [failed, setFailed] = useState(false);
	if (game.icon === undefined || failed) {
		return (
			<span className="tile-placeholder">
				<Icon name="disc" size={36} />
				<span>{game.title}</span>
			</span>
		);
	}
	return <img src={game.icon} alt="" draggable={false} onError={() => setFailed(true)} />;
}

export function Home() {
	const games = useStore((state) => state.games);
	const selectedId = useStore((state) => state.selectedId);
	const select = useStore((state) => state.select);
	const run = useStore((state) => state.run);
	const app = useStore((state) => state.app);
	const push = useStore((state) => state.push);
	const viewport = useViewport();
	const rowRef = useRef<HTMLDivElement>(null);
	const [scrolled, setScrolled] = useState(false);

	const count = games.length + 1; // The last tile opens the game library.
	const selectedIndex = Math.max(0, games.findIndex((game) => game.id === selectedId));
	const [index, setIndex] = useState(selectedIndex);
	useEffect(() => {
		setIndex(selectedIndex);
	}, [selectedIndex]);
	const game: Game | undefined = index < games.length ? games[index] : undefined;

	const layout = useMemo(() => {
		const tile = Math.round(Math.min(156, Math.max(84, viewport.width * 0.078)));
		const big = Math.round(tile * 1.34);
		const gap = Math.round(tile * 0.14);
		const anchor = Math.round(viewport.width * 0.055);
		const titleSpace = Math.round(Math.min(400, Math.max(220, viewport.width * 0.22)));
		return { tile, big, gap, anchor, titleSpace };
	}, [viewport.width]);

	const tileX = (i: number) => {
		const { tile, big, gap, anchor, titleSpace } = layout;
		if (i < index) return anchor - (index - i) * (tile + gap);
		if (i === index) return anchor;
		return anchor + big + gap + titleSpace + (i - index - 1) * (tile + gap);
	};

	const setSelection = (next: number) => {
		const clamped = Math.min(count - 1, Math.max(0, next));
		if (clamped === index) {
			return false;
		}
		setIndex(clamped);
		if (clamped < games.length) {
			select(games[clamped]!.id);
		}
		playSound('move');
		return true;
	};

	// Keep focus on the selected tile while the row slides.
	useLayoutEffect(() => {
		const active = document.activeElement as HTMLElement | null;
		if (active?.classList.contains('tile') === true) {
			const tile = rowRef.current?.querySelector<HTMLElement>(`[data-tile-index="${index}"]`);
			if (tile !== null && tile !== undefined && tile !== active) {
				focusElement(tile);
			}
		}
	}, [index]);

	// Focus the selected tile when the screen opens.
	useEffect(() => {
		const frame = requestAnimationFrame(() => {
			const tile = rowRef.current?.querySelector<HTMLElement>(`[data-tile-index="${index}"]`) ?? document.querySelector<HTMLElement>('.home [data-nav-default]');
			if (tile !== null && tile !== undefined) {
				focusElement(tile);
			}
		});
		return () => cancelAnimationFrame(frame);
	}, []);

	useActions((action, info) => {
		const focused = document.activeElement as HTMLElement | null;
		const onTile = focused?.classList.contains('tile') === true;
		switch (action) {
			case 'left':
			case 'right':
				if (onTile) {
					if (!setSelection(index + (action === 'left' ? -1 : 1)) && !info.repeat) {
						playSound('error');
					}
					return true;
				}
				return false;
			case 'pagePrev':
			case 'pageNext':
				setSelection(index + (action === 'pagePrev' ? -6 : 6));
				return true;
			case 'options':
				if (game !== undefined) {
					playSound('confirm');
					void openGameMenu(game);
				}
				return true;
			case 'details':
				if (game !== undefined) {
					playSound('confirm');
					push({ name: 'gameSettings', gameId: game.id });
				}
				return true;
			case 'search':
				void searchGames();
				return true;
			case 'tabNext':
				playSound('move');
				push({ name: 'library' });
				return true;
			case 'back':
				if (!onTile) {
					const tile = rowRef.current?.querySelector<HTMLElement>(`[data-tile-index="${index}"]`);
					if (tile !== null && tile !== undefined) {
						playSound('back');
						focusElement(tile);
					}
				}
				return true;
			default:
				return false;
		}
	});

	const first = Math.max(0, index - 4);
	const last = Math.min(count - 1, index + 14);
	const tiles: number[] = [];
	for (let i = first; i <= last; i++) tiles.push(i);

	const running = run.running && run.gameId === game?.id;
	const noEmulator = app !== undefined && !app.emulator.found;
	const noFolders = app !== undefined && app.gameDirs.length === 0;

	const addFolder = async () => {
		const dir = await browse({ title: 'Add game folder', mode: 'folder', actionLabel: 'Add this folder' });
		if (dir !== undefined && app !== undefined) {
			const result = await kyty.saveGlobalSettings({ global: app.global, controller: app.controller, gameDirs: [...app.gameDirs, dir] });
			if (!result.ok) await alert('Game folders', result.error);
		}
	};

	return (
		<div className={`screen home ${scrolled ? 'home-scrolled' : ''}`} data-nav-scope="1">
			<TopBar active="games" />
			<div className="home-content">
				<section
					className="tile-row"
					ref={rowRef}
					style={{ height: layout.big + 12 }}
					data-nav-group
					onFocus={() => setScrolled(false)}
				>
					{tiles.map((i) => {
						const item = games[i];
						const selected = i === index;
						const scale = selected ? layout.big / layout.tile : 1;
						return (
							<button
								key={item?.id ?? 'library'}
								className={`tile ${selected ? 'tile-selected' : ''} ${item === undefined ? 'tile-library' : ''} ${run.running && run.gameId === item?.id ? 'tile-running' : ''}`}
								data-nav
								data-tile-index={i}
								data-nav-default={selected ? '' : undefined}
								data-testid={item === undefined ? 'tile-library' : `tile-${item.titleId || item.id}`}
								style={{ width: layout.tile, height: layout.tile, transform: `translate3d(${tileX(i)}px, 0, 0) scale(${scale})` }}
								aria-label={item?.title ?? 'Game Library'}
								onClick={() => {
									if (!selected) {
										setSelection(i);
										return;
									}
									if (item === undefined) {
										playSound('confirm');
										push({ name: 'library' });
									} else {
										void launchGame(item);
									}
								}}
							>
								{item === undefined ? (
									<span className="tile-placeholder">
										<Icon name="grid" size={34} />
										<span>Game Library</span>
									</span>
								) : (
									<TileArt game={item} />
								)}
								{run.running && run.gameId === item?.id && <span className="tile-badge">Running</span>}
							</button>
						);
					})}
					<div
						key={game?.id ?? 'library-title'}
						className="tile-title"
						style={{ transform: `translate3d(${layout.anchor + layout.big + layout.gap * 1.5}px, 0, 0)`, top: layout.big - 44, width: layout.titleSpace - layout.gap }}
					>
						{game?.title ?? 'Game Library'}
					</div>
				</section>

				<section className="hero">
					{noEmulator && (
						<div className="banner banner-error">
							<Icon name="warning" />
							<div>
								<strong>Can't find the emulator</strong>
								<p>Put kyty_emulator next to the launcher, or start the launcher with --emulator=&lt;path&gt;.</p>
							</div>
						</div>
					)}
					{games.length === 0 ? (
						<div className="hero-empty">
							<h1 className="hero-title">{noFolders ? 'Add your games' : 'No games found'}</h1>
							<p className="hero-meta">{noFolders ? 'Add at least one game folder to see your games here.' : 'Folders with eboot.bin and .zar archives in your game folders appear here.'}</p>
							<div className="hero-actions" data-nav-group>
								<button className="button button-play" data-nav data-nav-default onClick={() => void addFolder()} {...hoverFocus}>
									<Icon name="plus" />
									Add game folder
								</button>
								<button className="button button-round" data-nav aria-label="Settings" onClick={() => push({ name: 'settings', section: 'folders' })} {...hoverFocus}>
									<Icon name="gear" />
								</button>
							</div>
						</div>
					) : game === undefined ? (
						<div>
							<h1 className="hero-title">Game Library</h1>
							<p className="hero-meta">{games.length === 1 ? '1 game' : `${games.length} games`}</p>
							<div className="hero-actions" data-nav-group>
								<button className="button button-play" data-nav onClick={() => push({ name: 'library' })} {...hoverFocus}>
									<Icon name="grid" />
									Open library
								</button>
							</div>
						</div>
					) : (
						<div key={game.id} className="hero-game">
							<h1 className="hero-title">{game.title}</h1>
							<p className="hero-meta">
								{[game.titleId, game.gameVersion !== '' ? `v${game.gameVersion}` : '', formatSize(game.size), game.archive ? 'ZArchive' : ''].filter((part) => part !== '').join('  ·  ')}
							</p>
							<div className="hero-actions" data-nav-group>
								{running ? (
									<button className="button button-play button-stop" data-nav data-testid="stop" onClick={() => void kyty.stopGame()} {...hoverFocus}>
										<Icon name="stop" />
										Stop game
									</button>
								) : (
									<button className="button button-play" data-nav data-testid="play" disabled={run.running || !game.available} onClick={() => void launchGame(game)} {...hoverFocus}>
										<Icon name="play" />
										Play
									</button>
								)}
								<button className="button button-round" data-nav aria-label="Options" data-testid="game-options" onClick={() => void openGameMenu(game)} {...hoverFocus}>
									<Icon name="more" />
								</button>
								{(running || useStore.getState().log.length > 0) && (
									<button className="button button-round" data-nav aria-label="Emulator log" onClick={() => push({ name: 'log' })} {...hoverFocus}>
										<Icon name="terminal" />
									</button>
								)}
							</div>
						</div>
					)}
				</section>

				{game !== undefined && (
					<section className="cards" data-nav-group onFocus={() => setScrolled(true)}>
						<button className="card" data-nav onClick={() => game.trophies !== undefined && push({ name: 'trophies', gameId: game.id })} {...hoverFocus}>
							<span className="card-label">
								<Icon name="trophy" size={18} /> Trophies
							</span>
							{game.trophies !== undefined ? (
								<>
									<span className="card-big">{game.trophies.percentage}%</span>
									<span className="progress">
										<span className="progress-fill" style={{ transform: `scaleX(${game.trophies.percentage / 100})` }} />
									</span>
									<span className="card-grades">
										{[1, 2, 3, 4].map((grade) =>
											grade === 1 && (game.trophies?.totalGrade[1] ?? 0) === 0 ? null : (
												<span key={grade}>
													<TrophyCup grade={grade} size={16} /> {game.trophies?.earnedGrade[grade] ?? 0}
												</span>
											),
										)}
									</span>
								</>
							) : (
								<span className="card-muted">No trophy data</span>
							)}
						</button>
						<button className="card" data-nav onClick={() => (app?.compatLocal === true ? void editCompatibility(game) : void showGameInfo(game))} {...hoverFocus}>
							<span className="card-label">
								<Icon name="chip" size={18} /> Compatibility
							</span>
							<span className="status-pill" style={{ background: GAME_STATUS_COLORS[game.status] }}>
								{GAME_STATUS_LABELS[game.status]}
							</span>
							<span className="card-muted">{game.comment.length > 0 ? game.comment : 'No notes'}</span>
						</button>
						<button className="card" data-nav onClick={() => push({ name: 'gameSettings', gameId: game.id })} {...hoverFocus}>
							<span className="card-label">
								<Icon name="gear" size={18} /> Game settings
							</span>
							<span className="card-big card-medium">{game.hasCustomConfig ? 'Game config' : 'Global settings'}</span>
							<span className="card-muted">Firmware {game.firmwareVersion || '—'}</span>
						</button>
						{game.cheatsSupported && (
							<button className="card" data-nav onClick={() => push({ name: 'cheats', gameId: game.id })} {...hoverFocus}>
								<span className="card-label">
									<Icon name="flask" size={18} /> Cheats
								</span>
								<span className="card-big card-medium">{game.hasCheatFile ? 'Installed' : 'None'}</span>
								<span className="card-muted">Experimental</span>
							</button>
						)}
					</section>
				)}
			</div>
			<Hints
				items={[
					{ action: 'confirm', label: game === undefined ? 'Select' : running ? 'Select' : 'Play' },
					{ action: 'options', label: 'Options' },
					{ action: 'details', label: 'Game settings' },
					{ action: 'search', label: 'Search' },
					{ action: 'fullscreen', label: app?.fullscreen === true ? 'Window' : 'Full screen' },
				]}
			/>
		</div>
	);
}
