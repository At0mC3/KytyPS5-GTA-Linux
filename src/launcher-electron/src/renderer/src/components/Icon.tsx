// Line icons drawn for the launcher (24x24 viewBox, stroked with currentColor).
const PATHS: Record<string, string> = {
	gear: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4Z',
	search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z M15.2 15.2 20 20',
	folder: 'M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z',
	folderOpen: 'M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5V10 M3 18.5 5.5 11h16L19 18.5Z',
	file: 'M6 3h8l4 4v14H6Z M14 3v4h4',
	trophy: 'M8 4h8v4a4 4 0 0 1-8 0Z M8 6H5v1a3 3 0 0 0 3 3 M16 6h3v1a3 3 0 0 1-3 3 M12 12v4 M9 20h6 M10 16h4v4h-4Z',
	play: 'M8 5.5v13l10-6.5Z',
	stop: 'M7 7h10v10H7Z',
	more: 'M6 12h.01 M12 12h.01 M18 12h.01',
	grid: 'M4 4h6v6H4Z M14 4h6v6h-6Z M4 14h6v6H4Z M14 14h6v6h-6Z',
	controller: 'M7 9h10a4 4 0 0 1 3.9 4.9l-.8 3.3a2 2 0 0 1-3.4.9L15 16H9l-1.7 2.1a2 2 0 0 1-3.4-.9l-.8-3.3A4 4 0 0 1 7 9Z M8 12v2 M7 13h2 M15.5 12.5h.01 M17 14h.01',
	keyboard: 'M3 7h18v10H3Z M6 10h.01 M9 10h.01 M12 10h.01 M15 10h.01 M18 10h.01 M7 14h10',
	info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 11v5 M12 8h.01',
	warning: 'M12 4 21 19H3Z M12 10v4 M12 16.5h.01',
	check: 'M5 12.5 10 17l9-10',
	plus: 'M12 5v14 M5 12h14',
	trash: 'M5 7h14 M10 7V5h4v2 M7 7l1 13h8l1-13',
	refresh: 'M20 11a8 8 0 1 0-2.3 5.7 M20 5v6h-6',
	terminal: 'M4 5h16v14H4Z M7.5 9.5 10 12l-2.5 2.5 M12 15h4',
	palette: 'M12 3a9 9 0 0 0 0 18c1 0 1.5-.8 1.5-1.5 0-1-1-1.3-1-2.3 0-.9.7-1.4 1.5-1.4H16a5 5 0 0 0 5-5c0-4.4-4-7.8-9-7.8Z M7.5 11h.01 M10 7.5h.01 M14.5 7.5h.01 M17 11h.01',
	flask: 'M9 3h6 M10 3v6l-5 9a1.5 1.5 0 0 0 1.3 2h11.4a1.5 1.5 0 0 0 1.3-2l-5-9V3 M7.5 15h9',
	display: 'M3 5h18v11H3Z M9 20h6 M12 16v4',
	speaker: 'M5 9h3l5-4v14l-5-4H5Z M16 9a4 4 0 0 1 0 6 M18.5 6.5a7.5 7.5 0 0 1 0 11',
	bell: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z M10 20a2 2 0 0 0 4 0',
	bug: 'M8 9a4 4 0 0 1 8 0v5a4 4 0 0 1-8 0Z M12 9v9 M4 12h4 M16 12h4 M5 7l3 2 M19 7l-3 2 M5 18l3-2 M19 18l-3-2',
	user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M4 20a8 8 0 0 1 16 0',
	chip: 'M7 7h10v10H7Z M10 3v4 M14 3v4 M10 17v4 M14 17v4 M3 10h4 M3 14h4 M17 10h4 M17 14h4',
	rocket: 'M14 4c3 0 6 3 6 6l-6 6-4-4Z M10 12l-3 1-3 3 4 1 1 4 3-3 1-3 M15 9h.01',
	upload: 'M12 16V4 M7 9l5-5 5 5 M4 16v4h16v-4',
	download: 'M12 4v12 M7 11l5 5 5-5 M4 16v4h16v-4',
	globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M3 12h18 M12 3c2.5 2.6 3.5 5.6 3.5 9s-1 6.4-3.5 9c-2.5-2.6-3.5-5.6-3.5-9s1-6.4 3.5-9Z',
	expand: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5',
	chevronLeft: 'M15 5l-7 7 7 7',
	chevronRight: 'M9 5l7 7-7 7',
	chevronUp: 'M5 15l7-7 7 7',
	home: 'M4 11 12 4l8 7 M6 9.5V20h12V9.5',
	eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
	lock: 'M6 11h12v9H6Z M8.5 11V8a3.5 3.5 0 0 1 7 0v3',
	disc: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
	archive: 'M4 5h16v4H4Z M5 9v10h14V9 M10 13h4',
	power: 'M12 3v8 M7 6.5a7 7 0 1 0 10 0',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 24, className }: { name: IconName; size?: number; className?: string }) {
	return (
		<svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			{PATHS[name]!.split(' M').map((segment, index) => (
				<path key={index} d={index === 0 ? segment : `M${segment}`} />
			))}
		</svg>
	);
}
