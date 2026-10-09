import { useRef, useState } from 'react';
import { openGameMenu, searchGames } from '../actions';
import { Hints } from '../components/Glyph';
import { Icon } from '../components/Icon';
import { TopBar } from '../components/TopBar';
import { formatSize } from '../format';
import { hoverFocus, useActions, useInitialFocus } from '../hooks';
import { playSound } from '../input/sounds';
import { useStore } from '../store';

type Sort = 'title' | 'size' | 'serial';

export function Library() {
	const games = useStore((state) => state.games);
	const selectedId = useStore((state) => state.selectedId);
	const select = useStore((state) => state.select);
	const goHome = useStore((state) => state.goHome);
	const run = useStore((state) => state.run);
	const [sort, setSort] = useState<Sort>('title');
	const ref = useRef<HTMLDivElement>(null);
	useInitialFocus(ref, [sort]);

	const sorted = [...games].sort((a, b) => {
		if (sort === 'size') return (b.size ?? 0) - (a.size ?? 0);
		if (sort === 'serial') return a.titleId.localeCompare(b.titleId);
		return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
	});

	useActions((action) => {
		const focused = document.activeElement as HTMLElement | null;
		const id = focused?.getAttribute('data-game-id');
		const game = games.find((item) => item.id === id);
		switch (action) {
			case 'options':
				if (game !== undefined) void openGameMenu(game);
				return true;
			case 'search':
				void searchGames();
				return true;
			case 'details': {
				const order: Sort[] = ['title', 'size', 'serial'];
				setSort(order[(order.indexOf(sort) + 1) % order.length]!);
				playSound('move');
				return true;
			}
			case 'tabPrev':
				playSound('move');
				goHome();
				return true;
			default:
				return false;
		}
	});

	return (
		<div className="screen library" data-nav-scope="1" ref={ref}>
			<TopBar active="library" />
			<div className="library-header">
				<h1>Game Library</h1>
				<span className="card-muted">
					{games.length === 1 ? '1 game' : `${games.length} games`} · Sorted by {sort === 'title' ? 'name' : sort}
				</span>
			</div>
			<div className="library-grid" data-nav-scroll="80" data-nav-group>
				{sorted.map((game) => (
					<button
						key={game.id}
						className={`library-item ${run.running && run.gameId === game.id ? 'library-running' : ''}`}
						data-nav
						data-game-id={game.id}
						data-nav-default={game.id === selectedId ? '' : undefined}
						onClick={() => {
							playSound('confirm');
							select(game.id);
							goHome();
						}}
						{...hoverFocus}
					>
						<span className="library-art">
							{game.icon !== undefined ? (
								<img src={game.icon} alt="" draggable={false} />
							) : (
								<span className="tile-placeholder">
									<Icon name="disc" size={36} />
								</span>
							)}
						</span>
						<span className="library-title">{game.title}</span>
						<span className="library-meta">
							{game.titleId || '—'} · {formatSize(game.size)}
						</span>
					</button>
				))}
				{games.length === 0 && <p className="card-muted">No games yet. Add a game folder in Settings.</p>}
			</div>
			<Hints
				items={[
					{ action: 'confirm', label: 'Select' },
					{ action: 'options', label: 'Options' },
					{ action: 'details', label: 'Sort' },
					{ action: 'search', label: 'Search' },
					{ action: 'back', label: 'Back' },
				]}
			/>
		</div>
	);
}
