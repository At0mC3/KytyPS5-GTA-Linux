import { searchGames } from '../actions';
import { initials } from '../format';
import { hoverFocus, useClock } from '../hooks';
import { playSound } from '../input/sounds';
import { useStore } from '../store';
import { Icon } from './Icon';

export function TopBar({ active }: { active: 'games' | 'library' }) {
	const now = useClock();
	const app = useStore((state) => state.app);
	const run = useStore((state) => state.run);
	const push = useStore((state) => state.push);
	const replace = useStore((state) => state.replace);
	const goHome = useStore((state) => state.goHome);
	const userName = app?.global.user_name ?? 'Kyty';
	return (
		<header className="topbar" data-nav-group>
			<nav className="topbar-tabs">
				<button
					className={`topbar-tab ${active === 'games' ? 'topbar-tab-active' : ''}`}
					data-nav
					onClick={() => {
						playSound('move');
						goHome();
					}}
					{...hoverFocus}
				>
					Games
				</button>
				<button
					className={`topbar-tab ${active === 'library' ? 'topbar-tab-active' : ''}`}
					data-nav
					onClick={() => {
						playSound('move');
						if (active === 'games') {
							push({ name: 'library' });
						} else {
							replace({ name: 'library' });
						}
					}}
					{...hoverFocus}
				>
					Library
				</button>
			</nav>
			<div className="topbar-right">
				{run.running && (
					<button className="topbar-running" data-nav onClick={() => push({ name: 'log' })} {...hoverFocus}>
						<span className="pulse" />
						{run.title}
					</button>
				)}
				<button className="topbar-icon" data-nav aria-label="Search" onClick={() => void searchGames()} {...hoverFocus}>
					<Icon name="search" />
				</button>
				<button className="topbar-icon" data-nav aria-label="Trophies" onClick={() => push({ name: 'trophyOverview' })} {...hoverFocus}>
					<Icon name="trophy" />
				</button>
				<button className="topbar-icon" data-nav aria-label="Settings" data-testid="open-settings" onClick={() => push({ name: 'settings' })} {...hoverFocus}>
					<Icon name="gear" />
				</button>
				<button className="topbar-profile" data-nav aria-label="Profile" onClick={() => push({ name: 'settings', section: 'user' })} {...hoverFocus}>
					<span className="avatar">{initials(userName)}</span>
					<span className="topbar-name">{userName}</span>
				</button>
				<span className="topbar-clock">{now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
			</div>
		</header>
	);
}
