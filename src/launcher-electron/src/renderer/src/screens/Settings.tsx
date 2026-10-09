import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PAD_CONTROLS, assignBinding, formatMapping, parseMapping, type InputMapping, MIN_MOUSE_SENSITIVITY, MAX_MOUSE_SENSITIVITY } from '../../../shared/inputMapping';
import {
	CONSOLE_LANGUAGE_NAMES,
	LOG_DIRECTIONS,
	MAX_USER_ID,
	MAX_USER_NAME_BYTES,
	MAX_VBLANK_FREQUENCY,
	MIN_VBLANK_FREQUENCY,
	PRESENT_MODES,
	RESOLUTIONS,
	SHADER_OPTIMIZATION_TYPES,
	defaultControllerSettings,
	defaultEmulatorSettings,
	isUserIdValid,
	resolutionText,
	utf8Length,
	type ControllerSettings,
	type EmulatorSettings,
} from '../../../shared/settings';
import type { AppState, Game } from '../../../shared/types';
import { clearGameConfig } from '../actions';
import { pickColor } from '../components/ColorPicker';
import { NumberRow, Row, SectionTitle, SelectRow, SliderRow, TextRow, ToggleRow } from '../components/controls';
import { browse } from '../components/FolderBrowser';
import { Hints } from '../components/Glyph';
import { Icon, type IconName } from '../components/Icon';
import { alert, choose, confirm, menu, ModalFrame } from '../components/Modal';
import { focusElement } from '../focus/navigation';
import { hoverFocus, useActions } from '../hooks';
import { playSound } from '../input/sounds';
import { kyty } from '../kyty';
import { showModal, useStore } from '../store';
import { keyName, mouseButtonName, RESERVED_KEYS } from '../../../shared/inputMapping';

type SectionId = 'user' | 'graphics' | 'audio' | 'notifications' | 'compatibility' | 'debug' | 'controller' | 'input' | 'folders' | 'configs' | 'launcher' | 'about' | 'game';

interface Section {
	id: SectionId;
	label: string;
	icon: IconName;
}

interface Draft {
	settings: EmulatorSettings;
	controller: ControllerSettings;
	gameDirs: string[];
	mapping: InputMapping;
}

const GLOBAL_SECTIONS: Section[] = [
	{ id: 'user', label: 'User profile', icon: 'user' },
	{ id: 'graphics', label: 'Graphics & display', icon: 'display' },
	{ id: 'audio', label: 'Audio', icon: 'speaker' },
	{ id: 'notifications', label: 'Notifications', icon: 'bell' },
	{ id: 'compatibility', label: 'Compatibility', icon: 'chip' },
	{ id: 'debug', label: 'Debugging & logs', icon: 'bug' },
	{ id: 'controller', label: 'Controller', icon: 'controller' },
	{ id: 'input', label: 'Input mapping', icon: 'keyboard' },
	{ id: 'folders', label: 'Game folders', icon: 'folder' },
	{ id: 'configs', label: 'Game configs', icon: 'archive' },
	{ id: 'launcher', label: 'Launcher', icon: 'rocket' },
	{ id: 'about', label: 'About', icon: 'info' },
];

const GAME_SECTIONS: Section[] = [
	{ id: 'game', label: 'Game config', icon: 'disc' },
	{ id: 'user', label: 'User profile', icon: 'user' },
	{ id: 'graphics', label: 'Graphics & display', icon: 'display' },
	{ id: 'audio', label: 'Audio', icon: 'speaker' },
	{ id: 'notifications', label: 'Notifications', icon: 'bell' },
	{ id: 'compatibility', label: 'Compatibility', icon: 'chip' },
	{ id: 'debug', label: 'Debugging & logs', icon: 'bug' },
];

function makeDraft(app: AppState, settings: EmulatorSettings): Draft {
	return {
		settings: { ...settings, host_input_mapping: [...settings.host_input_mapping] },
		controller: { ...app.controller },
		gameDirs: [...app.gameDirs],
		mapping: parseMapping(app.global.host_input_mapping),
	};
}

function serialize(draft: Draft, global: boolean): string {
	return JSON.stringify(global ? { ...draft, mapping: formatMapping(draft.mapping) } : draft.settings);
}

// The checks the Qt settings dialog runs before saving.
function validate(draft: Draft): string | undefined {
	const s = draft.settings;
	const missing =
		s.user_name.trim().length === 0 ||
		(s.shader_log_direction === 'File' && s.shader_log_folder.length === 0) ||
		(s.printf_direction === 'File' && s.printf_output_file.length === 0) ||
		(s.command_buffer_dump_enabled && s.command_buffer_dump_folder.length === 0);
	if (missing) {
		return 'Please fill all mandatory fields';
	}
	if (utf8Length(s.user_name.trim()) > MAX_USER_NAME_BYTES) {
		return 'User name must contain 1-16 UTF-8 bytes';
	}
	if (!isUserIdValid(s.user_id)) {
		return 'User ID cannot be 254 (everyone) or 255 (system)';
	}
	return undefined;
}

function CaptureBinding({ control, close }: { control: string; close: (value?: string) => void }) {
	const [message, setMessage] = useState('Press a key or mouse button.\nF1, F7, and F11 are reserved; Esc cancels.');
	const opened = useRef(performance.now());
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			event.preventDefault();
			event.stopPropagation();
			if (event.repeat || performance.now() - opened.current < 200) {
				return;
			}
			if (event.key === 'Escape') {
				close();
				return;
			}
			if (RESERVED_KEYS.includes(event.key)) {
				setMessage('That key is reserved by the emulator.');
				playSound('error');
				return;
			}
			const name = keyName(event);
			if (name.length > 0) {
				playSound('confirm');
				close(name);
			} else {
				setMessage('That key is not supported.');
				playSound('error');
			}
		};
		const onMouse = (event: MouseEvent) => {
			if (performance.now() - opened.current < 200) {
				return;
			}
			const name = mouseButtonName(event.button);
			if (name.length > 0 && (event.target as HTMLElement).closest('.capture-area') !== null) {
				event.preventDefault();
				event.stopPropagation();
				close(name);
			}
		};
		const onContext = (event: MouseEvent) => event.preventDefault();
		window.addEventListener('keydown', onKey, true);
		window.addEventListener('mousedown', onMouse, true);
		window.addEventListener('contextmenu', onContext, true);
		return () => {
			window.removeEventListener('keydown', onKey, true);
			window.removeEventListener('mousedown', onMouse, true);
			window.removeEventListener('contextmenu', onContext, true);
		};
	}, [close]);
	return (
		<ModalFrame title={`Set binding: ${control}`} onClose={() => close()} hints={[{ action: 'back', label: 'Cancel' }]}>
			<div className="capture-area" data-raw-keys>
				<Icon name="keyboard" size={48} />
				<p className="dialog-message">{message}</p>
			</div>
		</ModalFrame>
	);
}

export function SettingsScreen({ gameId, initialSection }: { gameId?: string; initialSection?: string }) {
	const app = useStore((state) => state.app)!;
	const games = useStore((state) => state.games);
	const renderer = useStore((state) => state.renderer);
	const pop = useStore((state) => state.pop);
	const game: Game | undefined = gameId === undefined ? undefined : games.find((item) => item.id === gameId);
	const isGlobal = gameId === undefined;
	const sections = isGlobal ? GLOBAL_SECTIONS : GAME_SECTIONS;
	const [section, setSection] = useState<SectionId>(() => (sections.find((item) => item.id === initialSection)?.id ?? sections[0]!.id));
	const [draft, setDraft] = useState<Draft | undefined>(() => (isGlobal ? makeDraft(app, app.global) : undefined));
	const [original, setOriginal] = useState<string | undefined>(() => (draft === undefined ? undefined : serialize(draft, isGlobal)));
	const [custom, setCustom] = useState(false);
	const navRef = useRef<HTMLElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (gameId === undefined) {
			return;
		}
		void kyty.getGameSettings(gameId).then((view) => {
			const next = makeDraft(app, view.settings);
			setDraft(next);
			setOriginal(serialize(next, false));
			setCustom(view.custom);
		});
	}, [gameId]);

	useEffect(() => {
		const frame = requestAnimationFrame(() => {
			const item = navRef.current?.querySelector<HTMLElement>(`[data-section="${section}"]`);
			if (item !== null && item !== undefined) {
				focusElement(item);
			}
		});
		return () => cancelAnimationFrame(frame);
	}, [draft === undefined]);

	const dirty = draft !== undefined && original !== undefined && serialize(draft, isGlobal) !== original;
	const update = (change: Partial<EmulatorSettings>) => setDraft((current) => (current === undefined ? current : { ...current, settings: { ...current.settings, ...change } }));

	const save = async (): Promise<boolean> => {
		if (draft === undefined) {
			return false;
		}
		const error = validate(draft);
		if (error !== undefined) {
			playSound('error');
			await alert('Save failed', error);
			return false;
		}
		const settings = { ...draft.settings, user_name: draft.settings.user_name.trim() };
		const result = isGlobal
			? await kyty.saveGlobalSettings({ global: { ...settings, host_input_mapping: formatMapping(draft.mapping) }, controller: draft.controller, gameDirs: draft.gameDirs })
			: await kyty.saveGameSettings(gameId!, settings);
		if (!result.ok) {
			playSound('error');
			await alert('Save failed', result.error);
			return false;
		}
		playSound('confirm');
		const saved = { ...draft, settings };
		setDraft(saved);
		setOriginal(serialize(saved, isGlobal));
		setCustom(true);
		useStore.getState().toast(isGlobal ? 'Settings saved.' : 'Game config saved.');
		return true;
	};

	const leave = async () => {
		if (dirty) {
			const choice = await choose({
				title: 'Unsaved changes',
				message: 'Save your changes before leaving?',
				choices: [
					{ label: 'Save', value: 'save', primary: true },
					{ label: 'Discard', value: 'discard', destructive: true },
					{ label: 'Keep editing', value: 'keep' },
				],
			});
			if (choice === 'save') {
				if (!(await save())) return;
			} else if (choice !== 'discard') {
				return;
			}
		}
		void kyty.previewLightbar(null);
		playSound('back');
		pop();
	};

	const reset = async () => {
		if (draft === undefined) return;
		if (!(await confirm('Reset settings', 'Restore the default settings? Nothing is saved until you choose Save.', 'Reset'))) return;
		const defaults = defaultEmulatorSettings();
		setDraft({
			settings: { ...defaults, elf: draft.settings.elf },
			controller: isGlobal ? defaultControllerSettings() : draft.controller,
			gameDirs: isGlobal ? [] : draft.gameDirs,
			mapping: isGlobal ? parseMapping([]) : draft.mapping,
		});
		if (isGlobal) {
			void kyty.previewLightbar('');
		}
	};

	const switchSection = (delta: number) => {
		const index = sections.findIndex((item) => item.id === section);
		const next = sections[(index + delta + sections.length) % sections.length]!;
		setSection(next.id);
		playSound('move');
		requestAnimationFrame(() => {
			const item = navRef.current?.querySelector<HTMLElement>(`[data-section="${next.id}"]`);
			if (item !== null && item !== undefined) focusElement(item);
		});
	};

	useActions((action, info) => {
		const focused = document.activeElement as HTMLElement | null;
		const inPanel = focused !== null && panelRef.current?.contains(focused) === true;
		switch (action) {
			case 'back':
				if (inPanel) {
					const item = navRef.current?.querySelector<HTMLElement>(`[data-section="${section}"]`);
					if (item !== null && item !== undefined) {
						playSound('back');
						focusElement(item);
					}
				} else {
					void leave();
				}
				return true;
			case 'tabPrev':
			case 'tabNext':
				switchSection(action === 'tabPrev' ? -1 : 1);
				return true;
			case 'options':
				void save();
				return true;
			case 'right':
				if (!inPanel && focused?.hasAttribute('data-section') === true) {
					const first = panelRef.current?.querySelector<HTMLElement>('[data-nav]:not([aria-disabled="true"])');
					if (first !== null && first !== undefined) {
						playSound('move');
						focusElement(first);
					}
					return true;
				}
				return false;
			case 'search':
				if (section === 'input' && focused?.getAttribute('data-control') !== null && focused?.getAttribute('data-control') !== undefined && draft !== undefined) {
					setDraft({ ...draft, mapping: assignBinding(draft.mapping, focused.getAttribute('data-control')!, '') });
					playSound('back');
					return true;
				}
				return false;
			default:
				void info;
				return false;
		}
	});

	const title = isGlobal ? 'Settings' : `Game settings`;
	const subtitle = isGlobal ? 'Global settings apply to every game without its own config.' : game === undefined ? '' : `${game.title}${game.titleId !== '' ? ` · ${game.titleId}` : ''}`;

	return (
		<div className="screen settings" data-nav-scope="1">
			<header className="settings-header">
				<button className="button button-round" data-nav aria-label="Back" onClick={() => void leave()} {...hoverFocus}>
					<Icon name="chevronLeft" />
				</button>
				<div>
					<h1>{title}</h1>
					<p>{subtitle}</p>
				</div>
				{dirty && <span className="settings-dirty">Unsaved changes</span>}
			</header>
			<div className="settings-body">
				<nav className="settings-nav" ref={navRef} data-nav-group data-nav-scroll="40">
					{sections.map((item) => (
						<button
							key={item.id}
							className={`settings-nav-item ${item.id === section ? 'settings-nav-active' : ''}`}
							data-nav
							data-section={item.id}
							onFocus={() => setSection(item.id)}
							onClick={() => {
								const first = panelRef.current?.querySelector<HTMLElement>('[data-nav]:not([aria-disabled="true"])');
								if (first !== null && first !== undefined) {
									playSound('confirm');
									focusElement(first);
								}
							}}
							{...hoverFocus}
						>
							<Icon name={item.icon} />
							<span>{item.label}</span>
						</button>
					))}
				</nav>
				<div className="settings-panel" ref={panelRef} data-nav-scroll="80" key={section}>
					{draft === undefined ? (
						<p className="card-muted">Loading…</p>
					) : (
						<SectionContent section={section} draft={draft} setDraft={setDraft} update={update} app={app} game={game} custom={custom} isGlobal={isGlobal} renderer={renderer} />
					)}
				</div>
			</div>
			<footer className="settings-footer" data-nav-group>
				<button className="button button-primary" data-nav data-testid="settings-save" disabled={!dirty} onClick={() => void save()} {...hoverFocus}>
					<Icon name="check" size={20} />
					Save
				</button>
				<button className="button" data-nav onClick={() => void reset()} {...hoverFocus}>
					Reset to defaults
				</button>
				<button className="button" data-nav onClick={() => void leave()} {...hoverFocus}>
					{dirty ? 'Cancel' : 'Close'}
				</button>
			</footer>
			<Hints
				items={[
					{ action: 'confirm', label: 'Select' },
					{ action: 'back', label: 'Back' },
					{ action: 'tabPrev', label: 'Previous' },
					{ action: 'tabNext', label: 'Next' },
					{ action: 'options', label: 'Save' },
					...(section === 'input' ? [{ action: 'search' as const, label: 'Clear binding' }] : []),
				]}
			/>
		</div>
	);
}

interface ContentProps {
	section: SectionId;
	draft: Draft;
	setDraft: (draft: Draft) => void;
	update: (change: Partial<EmulatorSettings>) => void;
	app: AppState;
	game?: Game;
	custom: boolean;
	isGlobal: boolean;
	renderer: string;
}

function SectionContent(props: ContentProps): ReactNode {
	const { section, draft, update, app } = props;
	const s = draft.settings;
	switch (section) {
		case 'game':
			return <GameConfigSection {...props} />;
		case 'user':
			return (
				<>
					<SectionTitle>User profile</SectionTitle>
					<TextRow label="User name" description="Local user name exposed to games" value={s.user_name} maxBytes={MAX_USER_NAME_BYTES} required onChange={(user_name) => update({ user_name })} testId="setting-user-name" />
					<NumberRow
						label="User ID"
						description={isUserIdValid(s.user_id) ? 'Local user ID exposed to games' : 'User ID cannot be 254 (everyone) or 255 (system)'}
						invalid={!isUserIdValid(s.user_id)}
						value={s.user_id}
						min={0}
						max={MAX_USER_ID}
						onChange={(user_id) => update({ user_id })}
					/>
					<SelectRow
						label="Console language"
						description="Language"
						value={s.console_language}
						options={CONSOLE_LANGUAGE_NAMES.map((name, index) => ({ label: name, value: index }))}
						onChange={(console_language) => update({ console_language })}
					/>
				</>
			);
		case 'graphics': {
			const gpuOptions = [{ label: 'Auto', value: -1, description: undefined as string | undefined }];
			for (const gpu of app.emulator.gpus) {
				gpuOptions.push({ label: `${gpu.name}${gpu.meetsRequirements ? '' : ' (Vulkan 1.3 not supported)'}`, value: gpu.index, description: gpu.type });
			}
			if (s.gpu_index >= 0 && !app.emulator.gpus.some((gpu) => gpu.index === s.gpu_index)) {
				gpuOptions.push({ label: `GPU ${s.gpu_index} (unavailable)`, value: s.gpu_index, description: undefined });
			}
			return (
				<>
					<SectionTitle>Graphics &amp; display</SectionTitle>
					<SelectRow label="Screen resolution" description="Window resolution" value={s.screen_resolution} options={RESOLUTIONS.map((value) => ({ label: resolutionText(value), value }))} onChange={(screen_resolution) => update({ screen_resolution })} />
					<SelectRow label="Present mode" description="Vulkan swapchain presentation mode" value={s.present_mode} options={PRESENT_MODES.map((value) => ({ label: value, value }))} onChange={(present_mode) => update({ present_mode })} />
					<NumberRow label="Vblank frequency" description="Virtual display refresh rate used for frame pacing" value={s.vblank_frequency} min={MIN_VBLANK_FREQUENCY} max={MAX_VBLANK_FREQUENCY} suffix=" Hz" onChange={(vblank_frequency) => update({ vblank_frequency })} />
					<SelectRow label="Shader optimization" description="Optimize shaders for code size or performance" value={s.shader_optimization_type} options={SHADER_OPTIMIZATION_TYPES.map((value) => ({ label: value, value }))} onChange={(shader_optimization_type) => update({ shader_optimization_type })} />
					<SelectRow label="GPU" description={app.emulator.gpuError ?? 'Graphics device used by the emulator'} value={s.gpu_index} options={gpuOptions} onChange={(gpu_index) => update({ gpu_index })} />
					<ToggleRow label="Fullscreen" description="Run in borderless desktop fullscreen" value={s.fullscreen_enabled} onChange={(fullscreen_enabled) => update({ fullscreen_enabled })} />
					<ToggleRow label="Enable readback" description="Read back writable linear images" value={s.readback_linear_images} onChange={(readback_linear_images) => update({ readback_linear_images })} />
					<ToggleRow
						label="Enable tessellation support"
						description="Draw tessellated geometry, such as GTA V's nearby tree trunks. Unsupported tessellation shaders may cause crashes."
						value={s.tessellation_enabled}
						onChange={(tessellation_enabled) => update({ tessellation_enabled })}
					/>
					<ToggleRow label="Auto-hide cursor" description="Hide the host cursor after 2 seconds without mouse activity" value={s.hide_cursor_enabled} onChange={(hide_cursor_enabled) => update({ hide_cursor_enabled })} />
					<ToggleRow label="Skip boot logos" description="Skip startup logos and notices in supported games." value={s.skip_notice_screen} onChange={(skip_notice_screen) => update({ skip_notice_screen })} />
					<ToggleRow
						label="Accurate texture synchronization"
						description="Can fix missing textures and incorrect transparency in some games. May reduce performance."
						value={s.sync_raw_image_buffers}
						onChange={(sync_raw_image_buffers) => update({ sync_raw_image_buffers })}
					/>
					<ToggleRow
						label="Compile new pipelines in the background"
						description="Compile new pipelines in the background and skip the draws that need them meanwhile: an object may appear a moment late the first time it is seen, instead of the game stuttering."
						value={s.async_pipelines_enabled}
						onChange={(async_pipelines_enabled) => update({ async_pipelines_enabled })}
					/>
				</>
			);
		}
		case 'audio': {
			const options = [{ label: 'None', value: '', description: 'Supplies silence' as string | undefined }];
			for (const mic of app.emulator.microphones) {
				options.push({ label: mic, value: mic, description: undefined });
			}
			if (s.audio_input_device.length > 0 && !app.emulator.microphones.includes(s.audio_input_device)) {
				options.push({ label: `${s.audio_input_device} (unavailable)`, value: s.audio_input_device, description: undefined });
			}
			return (
				<>
					<SectionTitle>Audio</SectionTitle>
					<SelectRow
						label="Microphone"
						description={app.emulator.micError !== undefined ? `Microphones could not be listed: ${app.emulator.micError}` : 'Microphone used by games. None supplies silence.'}
						value={s.audio_input_device}
						options={options}
						onChange={(audio_input_device) => update({ audio_input_device })}
					/>
				</>
			);
		}
		case 'notifications':
			return (
				<>
					<SectionTitle>Notifications</SectionTitle>
					<ToggleRow
						label="Enable trophy notifications"
						description="Show trophy unlock notifications and play their sound. To use your own sound, replace the emulator's assets/sounds/trophy-unlock.wav with a WAV file and restart the game."
						value={s.trophy_enabled}
						onChange={(trophy_enabled) => update({ trophy_enabled })}
					/>
				</>
			);
		case 'compatibility':
			return (
				<>
					<SectionTitle>Compatibility</SectionTitle>
					{app.platform !== 'darwin' && (
						<ToggleRow label="AMD CPU patch (experimental)" description="Patch CPU instructions that differ between AMD and the host CPU." value={s.amd_cpu_enabled} onChange={(amd_cpu_enabled) => update({ amd_cpu_enabled })} />
					)}
					{app.platform === 'win32' && (
						<ToggleRow
							label="Windows SysV red zone crash protection (experimental)"
							description="Helps prevent crashes in some games on Windows"
							value={s.red_zone_protection_enabled}
							onChange={(red_zone_protection_enabled) => update({ red_zone_protection_enabled })}
						/>
					)}
					{app.platform === 'darwin' && <p className="card-muted">No compatibility options apply on macOS.</p>}
				</>
			);
		case 'debug':
			return (
				<>
					<SectionTitle>Debugging &amp; logs</SectionTitle>
					<ToggleRow label="Vulkan validation" description="Enable Vulkan validation layers" value={s.vulkan_validation_enabled} onChange={(vulkan_validation_enabled) => update({ vulkan_validation_enabled })} />
					<ToggleRow label="Shader validation" description="Validate SPIR-V binary" value={s.shader_validation_enabled} onChange={(shader_validation_enabled) => update({ shader_validation_enabled })} />
					<ToggleRow label="RenderDoc capture" description="Enable RenderDoc capture" value={s.renderdoc_enabled} onChange={(renderdoc_enabled) => update({ renderdoc_enabled })} />
					<ToggleRow label="Command buffer dump" description="Dump command buffers" value={s.command_buffer_dump_enabled} onChange={(command_buffer_dump_enabled) => update({ command_buffer_dump_enabled })} />
					<TextRow label="Command buffer folder" description="Specify directory to dump command buffers" value={s.command_buffer_dump_folder} required disabled={!s.command_buffer_dump_enabled} onChange={(command_buffer_dump_folder) => update({ command_buffer_dump_folder })} />
					<SelectRow label="Shader logging" description="Dump shaders to file or console window. If enabled may decrease emulator performance" value={s.shader_log_direction} options={LOG_DIRECTIONS.map((value) => ({ label: value, value }))} onChange={(shader_log_direction) => update({ shader_log_direction })} />
					<TextRow label="Shader log folder" description="Specify directory to dump shaders" value={s.shader_log_folder} required disabled={s.shader_log_direction !== 'File'} onChange={(shader_log_folder) => update({ shader_log_folder })} />
					<SelectRow label="Printf output" description="Print logs to file or console window. If enabled may decrease emulator performance" value={s.printf_direction} options={LOG_DIRECTIONS.map((value) => ({ label: value, value }))} onChange={(printf_direction) => update({ printf_direction })} />
					<TextRow label="Printf output file" description="Specify file to dump logs" value={s.printf_output_file} required disabled={s.printf_direction !== 'File'} onChange={(printf_output_file) => update({ printf_output_file })} />
					<ToggleRow label="Tracy profiler" description="Enable the Tracy profiler. Profiling may decrease emulator performance" value={s.profiler_enabled} onChange={(profiler_enabled) => update({ profiler_enabled })} />
				</>
			);
		case 'controller':
			return <ControllerSection {...props} />;
		case 'input':
			return <InputSection {...props} />;
		case 'folders':
			return <FoldersSection {...props} />;
		case 'configs':
			return <ConfigsSection />;
		case 'launcher':
			return <LauncherSection app={app} />;
		case 'about':
			return <AboutSection app={app} renderer={props.renderer} />;
	}
}

function GameConfigSection({ game, custom, draft }: ContentProps) {
	const pop = useStore((state) => state.pop);
	if (game === undefined) {
		return null;
	}
	return (
		<>
			<SectionTitle>Game config</SectionTitle>
			<Row label={custom ? 'This game uses its own config' : 'This game uses the global settings'} description={custom ? 'Changes here apply to this game only.' : 'Saving here creates a game config with a full copy of the settings.'} icon="info" />
			<Row label="Executable" description="Program the emulator starts in folder games" icon="file">
				<span className="value-text">{game.archive ? 'From the archive' : draft.settings.elf || 'eboot.bin'}</span>
			</Row>
			<Row
				label="Clear game config"
				description="Remove this game's config and use the global settings again"
				icon="refresh"
				disabled={!custom}
				onClick={async () => {
					await clearGameConfig(game);
					pop();
				}}
			/>
		</>
	);
}

function ControllerSection({ draft, setDraft }: ContentProps) {
	const color = draft.controller.color;
	return (
		<>
			<SectionTitle>Controller</SectionTitle>
			<Row
				label="DualSense lightbar"
				description={color.length > 0 ? 'Choose and preview a fixed LED color. Bluetooth DualSense may take several seconds to update.' : 'Let the game control the lightbar'}
				icon="palette"
				onClick={async () => {
					const picked = await pickColor(color);
					if (picked !== undefined) {
						setDraft({ ...draft, controller: { ...draft.controller, color: picked } });
						void kyty.previewLightbar(picked);
					}
				}}
			>
				{color.length > 0 ? (
					<span className="value-chip">
						<span className="swatch" style={{ background: color }} />
						{color.toUpperCase()}
					</span>
				) : (
					<span className="value-text">Default</span>
				)}
			</Row>
			<SliderRow
				label="Vibration intensity"
				description="Scale DualSense vibration over USB and Bluetooth"
				value={draft.controller.vibration_intensity}
				min={0}
				max={100}
				step={5}
				format={(value) => `${Math.round(value)}%`}
				onChange={(value) => setDraft({ ...draft, controller: { ...draft.controller, vibration_intensity: Math.round(value) } })}
			/>
			<SliderRow
				label="Speaker volume"
				description="Scale the DualSense speaker over USB and Bluetooth. 50% is the previous default; 100% adds 6 dB of gain."
				value={draft.controller.speaker_volume}
				min={0}
				max={100}
				step={5}
				format={(value) => `${Math.round(value)}%`}
				onChange={(value) => setDraft({ ...draft, controller: { ...draft.controller, speaker_volume: Math.round(value) } })}
			/>
		</>
	);
}

function InputSection({ draft, setDraft }: ContentProps) {
	const mapping = draft.mapping;
	return (
		<>
			<SectionTitle>Input mapping</SectionTitle>
			<p className="section-intro">
				Map keyboard or mouse buttons to DualSense controls. Press F7 in-game to toggle mouse movement on the right stick.
				{!mapping.custom && ' The emulator uses these default bindings until you change one.'}
			</p>
			<SliderRow
				label="Mouse sensitivity"
				value={mapping.sensitivity}
				min={MIN_MOUSE_SENSITIVITY}
				max={MAX_MOUSE_SENSITIVITY}
				step={0.1}
				format={(value) => `${value.toFixed(1)}x`}
				onChange={(sensitivity) => setDraft({ ...draft, mapping: { ...mapping, sensitivity: Math.round(sensitivity * 10) / 10 } })}
			/>
			{PAD_CONTROLS.map((control) => (
				<ControlRow key={control.id} control={control.id} label={control.label} binding={mapping.bindings[control.id] ?? ''} onChange={(binding) => setDraft({ ...draft, mapping: assignBinding(mapping, control.id, binding) })} />
			))}
			<Row
				label="Restore default bindings"
				icon="refresh"
				onClick={() => setDraft({ ...draft, mapping: { bindings: parseMapping([]).bindings, custom: false, sensitivity: 1 } })}
			/>
		</>
	);
}

function ControlRow({ control, label, binding, onChange }: { control: string; label: string; binding: string; onChange: (binding: string) => void }) {
	return (
		<Row
			label={label}
			control={control}
			onClick={async () => {
				const captured = await showModal<string>((close) => <CaptureBinding control={label} close={close} />);
				if (captured !== undefined) {
					onChange(captured);
				}
			}}
		>
			<span className={`keycap ${binding.length === 0 ? 'keycap-empty' : ''}`}>{binding.length > 0 ? binding : 'None'}</span>
		</Row>
	);
}

function FoldersSection({ draft, setDraft }: ContentProps) {
	const add = async () => {
		const dir = await browse({ title: 'Add game folder', mode: 'folder', start: draft.gameDirs[draft.gameDirs.length - 1], actionLabel: 'Add this folder' });
		if (dir !== undefined && !draft.gameDirs.includes(dir)) {
			setDraft({ ...draft, gameDirs: [...draft.gameDirs, dir] });
		}
	};
	return (
		<>
			<SectionTitle>Game folders</SectionTitle>
			<p className="section-intro">Folders containing eboot.bin and .zar archives found in these folders appear in your library.</p>
			{draft.gameDirs.map((dir) => (
				<Row
					key={dir}
					label={dir}
					icon="folder"
					onClick={async () => {
						const choice = await menu(dir, [{ label: 'Remove folder', value: 'remove', icon: 'trash', destructive: true }]);
						if (choice === 'remove') {
							setDraft({ ...draft, gameDirs: draft.gameDirs.filter((item) => item !== dir) });
						}
					}}
				/>
			))}
			{draft.gameDirs.length === 0 && <p className="card-muted">No game folders yet.</p>}
			<Row label="Add game folder…" icon="plus" onClick={() => void add()} testId="add-folder" />
		</>
	);
}

function ConfigsSection() {
	const doImport = async () => {
		const file = await browse({ title: 'Import game configs', mode: 'file', extensions: ['json'] });
		if (file === undefined) return;
		const preview = await kyty.previewImport(file);
		if (preview.error !== undefined) {
			await alert('Import failed', preview.error);
			return;
		}
		const notFound = preview.unmatched.length > 0 ? `Games not found: ${preview.unmatched.join(', ')}` : undefined;
		if (preview.token === undefined) {
			await alert('Import game configs', [`No matching games found in the library.`, notFound].filter(Boolean).join('\n'));
			return;
		}
		const ok = await confirm(
			'Import game configs',
			<>
				<p>Configs will be updated for the following games:</p>
				<ul>
					{preview.matched.map((item) => (
						<li key={`${item.titleId}-${item.title}`}>
							{item.titleId} — {item.title}
						</li>
					))}
				</ul>
				{notFound !== undefined && <p>{notFound}</p>}
			</>,
			'Apply',
		);
		if (ok) {
			const result = await kyty.applyImport(preview.token);
			if (!result.ok) await alert('Import failed', result.error);
			else useStore.getState().toast('Game configs imported.');
		}
	};
	const doExport = async () => {
		const targets = await kyty.exportTargets();
		if (targets.length === 0) {
			await alert('Export game config', 'No game configs with a PPSA code were found.');
			return;
		}
		const gameId = await menu(
			'Export game config',
			targets.map((target) => ({ label: `${target.titleId} — ${target.title}`, value: target.gameId, detail: target.gamePath })),
		);
		const target = targets.find((item) => item.gameId === gameId);
		if (target === undefined) return;
		const dir = await browse({ title: `Export ${target.titleId}.json to…`, mode: 'folder', actionLabel: 'Export here' });
		if (dir === undefined) return;
		const file = `${dir.replace(/[\\/]+$/, '')}/${target.titleId}.json`;
		let result = await kyty.exportGameConfig(target.gameId, file, false);
		if (!result.ok && result.exists === true) {
			if (!(await confirm('Export game config', `${file} already exists. Replace it?`, 'Replace', { destructive: true }))) return;
			result = await kyty.exportGameConfig(target.gameId, file, true);
		}
		if (!result.ok) await alert('Export failed', result.error);
		else useStore.getState().toast(`Exported ${target.titleId}.json`);
	};
	return (
		<>
			<SectionTitle>Game configs</SectionTitle>
			<p className="section-intro">Share game configs as JSON files keyed by PPSA code.</p>
			<Row label="Import game configs…" description="Apply configs from a JSON file to matching games in your library" icon="download" onClick={() => void doImport()} />
			<Row label="Export a game config…" description="Save one game's config as <PPSA code>.json" icon="upload" onClick={() => void doExport()} />
		</>
	);
}

function LauncherSection({ app }: { app: AppState }) {
	const prefs = app.prefs;
	const set = (change: Partial<AppState['prefs']>) => void kyty.setPrefs(change);
	return (
		<>
			<SectionTitle>Launcher</SectionTitle>
			<p className="section-intro">These settings apply right away.</p>
			<ToggleRow label="Full screen" description="Show the launcher full screen. Also: F11, or the Create button." value={app.fullscreen} onChange={(value) => void kyty.setFullscreen(value)} testId="pref-fullscreen" />
			<SelectRow
				label="GPU acceleration"
				description="Draw the launcher on the GPU. Takes effect after restarting the launcher."
				value={prefs.gpu_acceleration}
				options={[
					{ label: 'Automatic', value: 'auto' as const, description: 'Use the GPU unless the driver is blocklisted' },
					{ label: 'Force', value: 'force' as const, description: 'Ignore the GPU blocklist' },
					{ label: 'Off', value: 'off' as const, description: 'Software rendering' },
				]}
				onChange={(gpu_acceleration) => set({ gpu_acceleration })}
			/>
			<ToggleRow label="Animated background" description="Animate the game art and lights behind the dashboard" value={prefs.animated_background} onChange={(animated_background) => set({ animated_background })} />
			<ToggleRow label="Minimize while playing" description="Minimize the launcher when a game starts and bring it back when the game exits" value={prefs.minimize_on_launch} onChange={(minimize_on_launch) => set({ minimize_on_launch })} />
			<SelectRow
				label="Confirm button"
				description="Which face button selects"
				value={prefs.confirm_button}
				options={[
					{ label: 'Cross (bottom)', value: 'cross' as const },
					{ label: 'Circle (right)', value: 'circle' as const },
				]}
				onChange={(confirm_button) => set({ confirm_button })}
			/>
			<SelectRow
				label="Controller input"
				description="Where the launcher reads the controller from"
				value={prefs.controller_input_source}
				options={[
					{ label: 'Browser gamepad', value: 'gamepad' as const, description: 'Chromium Gamepad API' },
					{ label: 'Emulator (SDL)', value: 'sdl' as const, description: 'Use when the controller is not detected, such as some Bluetooth setups' },
				]}
				onChange={(controller_input_source) => set({ controller_input_source })}
			/>
			<ToggleRow label="Interface sounds" description="Play short sounds while navigating" value={prefs.ui_sounds} onChange={(ui_sounds) => set({ ui_sounds })} />
			{app.emulator.updateCheckSupported && (
				<>
					<ToggleRow label="Check for updates on startup" value={app.checkUpdatesOnStartup} onChange={(value) => void kyty.setCheckUpdatesOnStartup(value)} />
					<Row
						label="Check for updates now"
						icon="refresh"
						onClick={async () => {
							const result = await kyty.checkForUpdates();
							if (result.error !== undefined) {
								await alert('Update check', `Could not check for updates:\n${result.error}`);
							} else if (result.upToDate === true) {
								await alert('Update check', `You are using the latest version (${result.latest}).`);
							} else if (await confirm('KytyPS5 update', `An update is available.\n\nCurrent: ${result.current}\nLatest: ${result.latest}\n\nOpen the release page?`, 'Open')) {
								await kyty.openExternal(result.url!);
							}
						}}
					/>
				</>
			)}
		</>
	);
}

function AboutSection({ app, renderer }: { app: AppState; renderer: string }) {
	const features = useMemo(() => Object.entries(app.gpuFeatures), [app.gpuFeatures]);
	return (
		<>
			<SectionTitle>About</SectionTitle>
			<Row label="Launcher" description={`KytyPS5 Launcher ${app.launcherVersion}`} icon="rocket" />
			<Row label="Emulator" description={app.emulator.path ?? "Can't find emulator"} icon="chip">
				<span className="value-text">{app.emulator.buildString ?? ''}</span>
			</Row>
			<Row label="Settings file" description={app.settingsError ?? app.settingsFile} icon="file" />
			<Row label="Interface renderer" description={renderer === 'webgl' ? 'WebGL 2 (GPU)' : 'CSS fallback'} icon="display" />
			<Row
				label="Refresh devices"
				description="List GPUs and microphones again"
				icon="refresh"
				onClick={async () => {
					await kyty.refreshEmulator();
					useStore.getState().toast('Device list refreshed.');
				}}
			/>
			<SectionTitle>GPU features</SectionTitle>
			<div className="feature-grid">
				{features.map(([name, status]) => (
					<span key={name} className={`feature ${status.startsWith('enabled') ? 'feature-on' : ''}`}>
						<span>{name.replace(/_/g, ' ')}</span>
						<span>{status.replace(/_/g, ' ')}</span>
					</span>
				))}
			</div>
		</>
	);
}

