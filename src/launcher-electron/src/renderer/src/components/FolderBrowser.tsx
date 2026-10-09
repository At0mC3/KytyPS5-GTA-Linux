import { useEffect, useState } from 'react';
import type { DirListing } from '../../../shared/types';
import { hoverFocus } from '../hooks';
import { playSound } from '../input/sounds';
import { kyty } from '../kyty';
import { showModal } from '../store';
import { Icon } from './Icon';
import { ModalFrame } from './Modal';

interface Options {
	title: string;
	start?: string;
	mode: 'folder' | 'file';
	extensions?: string[];
	actionLabel?: string;
}

function Browser({ options, close }: { options: Options; close: (value?: string) => void }) {
	const [listing, setListing] = useState<DirListing | undefined>();
	const [focusKey, setFocusKey] = useState(0);

	const open = async (dir: string | undefined) => {
		const result = await kyty.listDir(dir, options.mode === 'file' ? options.extensions ?? [] : undefined);
		setListing(result);
		setFocusKey((key) => key + 1);
	};

	useEffect(() => {
		void open(options.start);
		// Open the start folder once.
	}, []);

	const native = async () => {
		const result =
			options.mode === 'folder'
				? await kyty.showOpenDialog({ title: options.title, directory: true, defaultPath: listing?.path })
				: await kyty.showOpenDialog({ title: options.title, defaultPath: listing?.path, filters: [{ name: 'Files', extensions: options.extensions ?? ['*'] }] });
		if (result[0] !== undefined) {
			close(result[0]);
		}
	};

	return (
		<ModalFrame
			title={options.title}
			subtitle={listing?.path}
			variant="full"
			focusKey={focusKey}
			onClose={() => close()}
			hints={[
				{ action: 'confirm', label: 'Open' },
				{ action: 'search', label: 'Up one level' },
				...(options.mode === 'folder' ? [{ action: 'details' as const, label: options.actionLabel ?? 'Select this folder' }] : []),
				{ action: 'back', label: 'Cancel' },
			]}
			onAction={(action) => {
				if (action === 'search' && listing?.parent !== undefined) {
					playSound('back');
					void open(listing.parent);
					return true;
				}
				if (action === 'details' && options.mode === 'folder' && listing !== undefined) {
					playSound('confirm');
					close(listing.path);
					return true;
				}
				return false;
			}}
		>
			<div className="browser">
				<nav className="browser-roots" data-nav-group>
					{listing?.roots.map((root) => (
						<button key={root.path} className="browser-root" data-nav onClick={() => void open(root.path)} {...hoverFocus}>
							<Icon name={root.name === 'Home' ? 'home' : 'disc'} size={20} />
							<span>{root.name}</span>
						</button>
					))}
					<button className="browser-root" data-nav onClick={() => void native()} {...hoverFocus}>
						<Icon name="expand" size={20} />
						<span>System dialog…</span>
					</button>
				</nav>
				<div className="browser-main">
					<div className="browser-list" data-nav-scroll="60" data-nav-group>
						{listing?.parent !== undefined && (
							<button className="browser-entry" data-nav onClick={() => void open(listing.parent)} {...hoverFocus}>
								<Icon name="chevronUp" size={20} />
								<span>..</span>
							</button>
						)}
						{listing?.entries.map((entry, index) => (
							<button
								key={entry.path}
								className="browser-entry"
								data-nav
								data-nav-default={index === 0 ? '' : undefined}
								onClick={() => {
									if (entry.directory) {
										playSound('move');
										void open(entry.path);
									} else {
										playSound('confirm');
										close(entry.path);
									}
								}}
								{...hoverFocus}
							>
								<Icon name={entry.directory ? 'folder' : 'file'} size={20} />
								<span>{entry.name}</span>
							</button>
						))}
						{listing !== undefined && listing.entries.length === 0 && <p className="browser-empty">{listing.error ?? (options.mode === 'file' ? 'No matching files here.' : 'No folders here.')}</p>}
					</div>
					{options.mode === 'folder' && listing !== undefined && (
						<div className="browser-actions">
							<button className="button button-primary" data-nav onClick={() => close(listing.path)} {...hoverFocus}>
								<Icon name="check" size={20} />
								{options.actionLabel ?? 'Select this folder'}
							</button>
						</div>
					)}
				</div>
			</div>
		</ModalFrame>
	);
}

export function browse(options: Options): Promise<string | undefined> {
	return showModal<string>((close) => <Browser options={options} close={close} />);
}
