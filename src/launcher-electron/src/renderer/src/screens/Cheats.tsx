import { useEffect, useRef, useState } from 'react';
import type { CheatPreview, LocalCheats, RemoteCheat } from '../../../shared/types';
import { ToggleRow } from '../components/controls';
import { Hints } from '../components/Glyph';
import { Icon } from '../components/Icon';
import { confirm } from '../components/Modal';
import { hoverFocus, useActions, useInitialFocus } from '../hooks';
import { playSound } from '../input/sounds';
import { kyty } from '../kyty';
import { useStore } from '../store';

export function Cheats({ gameId }: { gameId: string }) {
	const game = useStore((state) => state.games.find((item) => item.id === gameId));
	const [tab, setTab] = useState<'local' | 'remote'>('local');
	const [local, setLocal] = useState<LocalCheats | undefined>();
	const [selection, setSelection] = useState<boolean[]>([]);
	const [status, setStatus] = useState('');
	const [catalog, setCatalog] = useState<{ files: RemoteCheat[]; error: string } | undefined>();
	const [preview, setPreview] = useState<{ file: RemoteCheat; data?: CheatPreview } | undefined>();
	const ref = useRef<HTMLDivElement>(null);
	useInitialFocus(ref, [tab, local === undefined, catalog === undefined]);

	const loadLocal = async () => {
		const result = await kyty.cheatsLocal(gameId);
		setLocal(result);
		setSelection(result.mods.map((mod) => mod.enabled));
		setStatus(result.error ?? (result.exists ? `Loaded ${result.mods.length} cheat(s) from ${result.path}.` : `No local cheat file: ${result.path ?? ''}`));
	};
	const loadRemote = async () => {
		setCatalog(undefined);
		setPreview(undefined);
		setCatalog(await kyty.cheatsCatalog(gameId));
	};

	useEffect(() => {
		void loadLocal();
	}, [gameId]);
	useEffect(() => {
		if (tab === 'remote' && catalog === undefined) {
			void loadRemote();
		}
	}, [tab]);

	useActions((action) => {
		if (action === 'tabPrev' || action === 'tabNext') {
			setTab(tab === 'local' ? 'remote' : 'local');
			playSound('move');
			return true;
		}
		if (action === 'options' && tab === 'local' && local !== undefined && local.mods.length > 0) {
			void apply();
			return true;
		}
		return false;
	});

	const apply = async () => {
		const result = await kyty.cheatsSave(gameId, selection);
		setStatus(result.ok ? 'Cheat selection saved. Changes take effect on the next game launch.' : result.error);
		playSound(result.ok ? 'confirm' : 'error');
	};

	const doImport = async (file: RemoteCheat) => {
		if (local?.exists === true && !(await confirm('Replace local cheats?', `Replace the local cheat file and selections for ${game?.titleId}? Imported cheats will start unchecked.`, 'Replace', { destructive: true }))) {
			return;
		}
		const result = await kyty.cheatsImport(gameId, file.name);
		if (!result.ok) {
			setPreview({ file, data: { ...(preview?.data ?? { mods: [], name: '', credits: '', version: '' }), importError: result.error } });
			playSound('error');
			return;
		}
		await loadLocal();
		setTab('local');
		setStatus('Imported. Select cheats and apply your selection for the next game launch.');
	};

	return (
		<div className="screen cheats" data-nav-scope="1" ref={ref}>
			<header className="settings-header">
				<button className="button button-round" data-nav aria-label="Back" onClick={() => useStore.getState().pop()} {...hoverFocus}>
					<Icon name="chevronLeft" />
				</button>
				<div>
					<h1>Cheats (experimental)</h1>
					<p>
						{game?.title} · {game?.titleId} · Installed version: {game?.gameVersion || 'Unknown'}
					</p>
				</div>
			</header>
			<nav className="tabs">
				<button className={`tab ${tab === 'local' ? 'tab-active' : ''}`} onClick={() => setTab('local')}>
					Local
				</button>
				<button className={`tab ${tab === 'remote' ? 'tab-active' : ''}`} onClick={() => setTab('remote')}>
					Remote
				</button>
			</nav>
			{tab === 'local' ? (
				<div className="cheats-body" data-nav-scroll="80">
					{local?.mods.map((mod, index) => (
						<ToggleRow key={`${index}-${mod.name}`} label={mod.name} value={selection[index] ?? false} onChange={(value) => setSelection(selection.map((item, i) => (i === index ? value : item)))} />
					))}
					<p className="card-muted cheats-status">{status}</p>
					<div className="dialog-buttons">
						<button className="button button-primary" data-nav disabled={local === undefined || local.mods.length === 0} onClick={() => void apply()} {...hoverFocus}>
							Apply selection
						</button>
						<button className="button" data-nav onClick={() => void loadLocal()} {...hoverFocus}>
							Reload
						</button>
					</div>
				</div>
			) : (
				<div className="cheats-remote">
					<div className="cheats-files" data-nav-scroll="80" data-nav-group>
						<p className="card-muted">
							Cheats by TeeKay87 / HEN Cheats Collection and its contributors. Only JSON cheats are supported; MC4 and SHN files are shown disabled.
						</p>
						{catalog === undefined && <p className="card-muted">Loading remote cheats…</p>}
						{catalog !== undefined && catalog.files.length === 0 && catalog.error.length === 0 && <p className="card-muted">No remote cheats found for {game?.titleId}.</p>}
						{catalog !== undefined && catalog.error.length > 0 && <p className="card-muted">Could not load the complete collection: {catalog.error}</p>}
						{catalog?.files.map((file) => (
							<button
								key={file.name}
								className={`cheat-file ${preview?.file.name === file.name ? 'cheat-file-active' : ''}`}
								data-nav
								disabled={!file.supported}
								title={file.supported ? file.title : `${file.title} — ${file.format.toUpperCase()} is not supported.`}
								onClick={async () => {
									setPreview({ file });
									setPreview({ file, data: await kyty.cheatsPreview(gameId, file.name) });
								}}
								{...hoverFocus}
							>
								<span className="cheat-version">{file.installed ? `${file.version} (installed)` : file.version}</span>
								<span className="cheat-format">{file.format.toUpperCase()}</span>
								<span className="cheat-name">{file.title || file.name}</span>
							</button>
						))}
						<button className="button" data-nav onClick={() => void loadRemote()} {...hoverFocus}>
							<Icon name="refresh" size={20} /> Refresh
						</button>
					</div>
					<aside className="cheats-preview">
						{preview === undefined && <p className="card-muted">Select a JSON file to preview its cheats.</p>}
						{preview !== undefined && preview.data === undefined && <p className="card-muted">Loading cheat preview…</p>}
						{preview?.data !== undefined && (
							<>
								{preview.data.error !== undefined ? (
									<p className="card-muted">Could not preview this file: {preview.data.error}</p>
								) : (
									<>
										<h2>{preview.data.name}</h2>
										<p className="card-muted">
											Credits: {preview.data.credits || '—'} · Version: {preview.data.version}
										</p>
										<ul className="cheat-mods">
											{preview.data.mods.map((mod, index) => (
												<li key={index}>{mod}</li>
											))}
										</ul>
										<p className={preview.data.importError !== undefined ? 'error-text' : 'card-muted'}>
											{preview.data.importError ?? 'Import to Local, then select the cheats to enable. Changes take effect on the next game launch.'}
										</p>
										<button className="button button-primary" data-nav disabled={preview.data.importError !== undefined} onClick={() => void doImport(preview.file)} {...hoverFocus}>
											Import to Local
										</button>
									</>
								)}
							</>
						)}
					</aside>
				</div>
			)}
			<Hints
				items={[
					{ action: 'confirm', label: 'Select' },
					{ action: 'tabPrev', label: tab === 'local' ? 'Remote' : 'Local' },
					...(tab === 'local' ? [{ action: 'options' as const, label: 'Apply selection' }] : []),
					{ action: 'back', label: 'Back' },
				]}
			/>
		</div>
	);
}
