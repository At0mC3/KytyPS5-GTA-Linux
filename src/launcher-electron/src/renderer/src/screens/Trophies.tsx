import { useEffect, useRef, useState } from 'react';
import type { Trophy, TrophyGame, TrophySummary } from '../../../shared/types';
import { Hints } from '../components/Glyph';
import { Icon } from '../components/Icon';
import { GRADE_COLORS, GRADE_NAMES, TrophyCup } from '../components/Trophy';
import { formatDate } from '../format';
import { hoverFocus, useActions, useInitialFocus } from '../hooks';
import { playSound } from '../input/sounds';
import { kyty } from '../kyty';
import { useStore } from '../store';

function Grades({ summary, showPlatinum }: { summary: TrophySummary; showPlatinum: boolean }) {
	return (
		<span className="grades">
			{[1, 2, 3, 4].map((grade) =>
				grade === 1 && !showPlatinum ? null : (
					<span key={grade} className="grade">
						<TrophyCup grade={grade} size={18} />
						{summary.earnedGrade[grade] ?? 0}
					</span>
				),
			)}
		</span>
	);
}

export function TrophyOverview() {
	const games = useStore((state) => state.games);
	const push = useStore((state) => state.push);
	const [overview, setOverview] = useState<TrophyGame[] | undefined>();
	const ref = useRef<HTMLDivElement>(null);
	useInitialFocus(ref, [overview === undefined]);

	useEffect(() => {
		void kyty.getTrophyOverview().then(setOverview);
	}, []);

	const total = { earned: 0, grades: [0, 0, 0, 0, 0] };
	for (const item of overview ?? []) {
		total.earned += item.summary?.earned ?? 0;
		item.summary?.earnedGrade.forEach((count, grade) => (total.grades[grade]! += count));
	}

	return (
		<div className="screen trophies" data-nav-scope="1" ref={ref}>
			<header className="settings-header">
				<button className="button button-round" data-nav aria-label="Back" onClick={() => useStore.getState().pop()} {...hoverFocus}>
					<Icon name="chevronLeft" />
				</button>
				<div>
					<h1>Trophies</h1>
					<p>
						{total.earned} earned
						{[1, 2, 3, 4].map((grade) => (
							<span key={grade} className="grade">
								<TrophyCup grade={grade} size={16} />
								{total.grades[grade]}
							</span>
						))}
					</p>
				</div>
			</header>
			<div className="trophy-games" data-nav-scroll="80">
				{overview === undefined && <p className="card-muted">Loading trophies…</p>}
				{overview !== undefined && overview.length === 0 && <p className="card-muted">No games with trophies found in the game folders.</p>}
				{overview?.map((item) => {
					const game = games.find((candidate) => candidate.id === item.gameId);
					const summary = item.summary!;
					return (
						<button key={item.gameId} className="trophy-game" data-nav onClick={() => push({ name: 'trophies', gameId: item.gameId })} {...hoverFocus}>
							<span className="trophy-game-art">{game?.icon !== undefined ? <img src={game.icon} alt="" /> : <Icon name="disc" size={32} />}</span>
							<span className="trophy-game-text">
								<span className="trophy-game-title">{game?.title ?? item.gameId}</span>
								<span className="card-muted">{game?.titleId}</span>
								<span className="progress">
									<span className="progress-fill" style={{ transform: `scaleX(${summary.percentage / 100})` }} />
								</span>
							</span>
							<span className="trophy-game-stats">
								<span className="card-big card-medium">{summary.percentage}%</span>
								<span className="card-muted">
									{summary.earned}/{summary.total}
								</span>
								<Grades summary={summary} showPlatinum={(summary.totalGrade[1] ?? 0) > 0} />
							</span>
						</button>
					);
				})}
			</div>
			<Hints
				items={[
					{ action: 'confirm', label: 'View' },
					{ action: 'back', label: 'Back' },
				]}
			/>
		</div>
	);
}

function TrophyItem({ trophy, revealed, onFocus }: { trophy: Trophy; revealed: boolean; onFocus: () => void }) {
	const hidden = trophy.hidden && !trophy.unlocked && !revealed;
	const name = hidden ? 'Hidden trophy' : trophy.name.length > 0 ? trophy.name : `Trophy ${trophy.id}`;
	return (
		<button className={`trophy-item ${trophy.unlocked ? 'trophy-unlocked' : 'trophy-locked'}`} data-nav onFocus={onFocus} {...hoverFocus}>
			<span className="trophy-icon">
				{hidden ? <Icon name="lock" size={28} /> : trophy.icon !== undefined ? <img src={trophy.icon} alt="" /> : <TrophyCup grade={trophy.grade} size={34} />}
			</span>
			<span className="trophy-text">
				<span className="trophy-name">{name}</span>
				<span className="trophy-description">{hidden ? '' : trophy.description}</span>
			</span>
			<span className="trophy-meta">
				{!hidden && trophy.grade > 0 && <TrophyCup grade={trophy.grade} size={20} />}
				{trophy.unlocked && <span className="trophy-date">{trophy.unlockedAt !== undefined ? formatDate(trophy.unlockedAt) : 'Earned'}</span>}
			</span>
		</button>
	);
}

export function GameTrophies({ gameId }: { gameId: string }) {
	const game = useStore((state) => state.games.find((item) => item.id === gameId));
	const [data, setData] = useState<TrophyGame | undefined>();
	const [tab, setTab] = useState(0);
	const [focused, setFocused] = useState<Trophy | undefined>();
	const [revealed, setRevealed] = useState<Set<string>>(new Set());
	const ref = useRef<HTMLDivElement>(null);
	useInitialFocus(ref, [data === undefined, tab]);

	useEffect(() => {
		void kyty.getTrophies(gameId).then(setData);
	}, [gameId]);

	const pkg = data?.packages[tab];
	const key = (trophy: Trophy) => `${tab}/${trophy.id}`;

	useActions((action) => {
		if ((action === 'tabPrev' || action === 'tabNext') && data !== undefined && data.packages.length > 1) {
			setTab((tab + (action === 'tabPrev' ? -1 : 1) + data.packages.length) % data.packages.length);
			playSound('move');
			return true;
		}
		if (action === 'details' && focused !== undefined && focused.hidden && !focused.unlocked) {
			const next = new Set(revealed);
			if (next.has(key(focused))) next.delete(key(focused));
			else next.add(key(focused));
			setRevealed(next);
			playSound('confirm');
			return true;
		}
		return false;
	});

	const groups = new Map<number, string>(pkg?.groups.map((group) => [group.id, group.name]) ?? []);
	const detailHidden = focused !== undefined && focused.hidden && !focused.unlocked && !revealed.has(key(focused));

	return (
		<div className="screen trophies" data-nav-scope="1" ref={ref}>
			<header className="settings-header">
				<button className="button button-round" data-nav aria-label="Back" onClick={() => useStore.getState().pop()} {...hoverFocus}>
					<Icon name="chevronLeft" />
				</button>
				<div>
					<h1>{pkg?.title ?? game?.title ?? 'Trophies'}</h1>
					{pkg !== undefined && (
						<p>
							{pkg.progress.percentage}% · {pkg.progress.earned}/{pkg.progress.total} earned <Grades summary={pkg.progress} showPlatinum={(pkg.progress.totalGrade[1] ?? 0) > 0} />
						</p>
					)}
				</div>
			</header>
			{data !== undefined && data.packages.length > 1 && (
				<nav className="tabs">
					{data.packages.map((item, index) => (
						<button key={item.file} className={`tab ${index === tab ? 'tab-active' : ''}`} onClick={() => setTab(index)}>
							{item.title}
						</button>
					))}
				</nav>
			)}
			<div className="trophy-layout">
				<div className="trophy-list" data-nav-scroll="80">
					{data === undefined && <p className="card-muted">Loading trophies…</p>}
					{data !== undefined && data.errors.map((error) => <p key={error} className="card-muted">{error}</p>)}
					{pkg?.trophies.map((trophy) => (
						<div key={trophy.id}>
							{trophy.groupId >= 0 && groups.has(trophy.groupId) && pkg.trophies.find((item) => item.groupId === trophy.groupId) === trophy && <h3 className="section-title">{groups.get(trophy.groupId)}</h3>}
							<TrophyItem trophy={trophy} revealed={revealed.has(key(trophy))} onFocus={() => setFocused(trophy)} />
						</div>
					))}
				</div>
				<aside className="trophy-detail">
					{focused !== undefined && (
						<>
							<span className="trophy-detail-icon">
								{detailHidden ? <Icon name="lock" size={64} /> : focused.icon !== undefined ? <img src={focused.icon} alt="" className={focused.unlocked ? '' : 'grayscale'} /> : <TrophyCup grade={focused.grade} size={80} />}
							</span>
							<h2>{detailHidden ? 'Hidden trophy' : focused.name || `Trophy ${focused.id}`}</h2>
							{!detailHidden && focused.grade > 0 && (
								<p className="trophy-grade" style={{ color: GRADE_COLORS[focused.grade] }}>
									<TrophyCup grade={focused.grade} size={18} /> {GRADE_NAMES[focused.grade]}
								</p>
							)}
							{!detailHidden && <p>{focused.description}</p>}
							{!detailHidden && focused.hasReward && focused.reward.length > 0 && <p className="card-muted">Reward: {focused.reward}</p>}
							<p className="card-muted">{focused.unlocked ? (focused.unlockedAt !== undefined ? `Earned ${formatDate(focused.unlockedAt)}` : 'Earned') : 'Not earned yet'}</p>
						</>
					)}
				</aside>
			</div>
			<Hints
				items={[
					...(focused !== undefined && focused.hidden && !focused.unlocked ? [{ action: 'details' as const, label: detailHidden ? 'Reveal' : 'Hide' }] : []),
					...(data !== undefined && data.packages.length > 1 ? [{ action: 'tabPrev' as const, label: 'Previous list' }, { action: 'tabNext' as const, label: 'Next list' }] : []),
					{ action: 'back', label: 'Back' },
				]}
			/>
		</div>
	);
}
