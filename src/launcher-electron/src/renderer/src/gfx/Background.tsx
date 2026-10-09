import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { BackgroundRenderer } from './backgroundRenderer';

interface Props {
	image?: string;
	blur: number;
	dim: number;
	animate: boolean;
	paused: boolean;
}

declare global {
	interface Window {
		__kytyDebug?: { renderer: string; frames: () => number; state?: () => unknown };
	}
}

// The WebGL background, with a CSS cross-fade fallback when WebGL2 is unavailable.
export function Background({ image, blur, dim, animate, paused }: Props) {
	const canvas = useRef<HTMLCanvasElement>(null);
	const renderer = useRef<BackgroundRenderer | undefined>(undefined);
	const setRenderer = useStore((state) => state.setRenderer);
	const mode = useStore((state) => state.renderer);
	const [layers, setLayers] = useState<{ url?: string; key: number }[]>([{ url: image, key: 0 }]);

	useEffect(() => {
		if (canvas.current === null) {
			return;
		}
		const created = BackgroundRenderer.create(canvas.current);
		renderer.current = created;
		setRenderer(created === undefined ? 'css' : 'webgl');
		window.__kytyDebug = { renderer: created === undefined ? 'css' : 'webgl', frames: () => created?.frames ?? 0, state: () => created?.debugState() };
		return () => {
			created?.dispose();
			renderer.current = undefined;
		};
	}, [setRenderer]);

	useEffect(() => {
		void renderer.current?.setImage(image);
		setLayers((current) => (current[current.length - 1]?.url === image ? current : [...current.slice(-1), { url: image, key: Date.now() }]));
	}, [image, mode]);

	useEffect(() => {
		renderer.current?.setOptions({ blur, dim, animate });
	}, [blur, dim, animate, mode]);

	useEffect(() => {
		const instance = renderer.current;
		if (instance === undefined) {
			return;
		}
		const update = () => {
			if (paused || document.hidden) {
				instance.stop();
			} else {
				instance.start();
			}
		};
		update();
		document.addEventListener('visibilitychange', update);
		return () => document.removeEventListener('visibilitychange', update);
	}, [paused, mode]);

	return (
		<div className="background" aria-hidden="true">
			<canvas ref={canvas} className="background-canvas" hidden={mode === 'css'} />
			{mode === 'css' && (
				<div className="background-css" style={{ filter: blur > 0 ? `blur(${Math.round(blur * 28)}px)` : undefined }}>
					{layers.map((layer) =>
						layer.url === undefined ? (
							<div key={layer.key} className="background-layer background-empty" />
						) : (
							<img key={layer.key} className="background-layer" src={layer.url} alt="" />
						),
					)}
				</div>
			)}
			{mode === 'css' && <div className="background-shade" style={{ opacity: 0.55 + dim * 0.45 }} />}
		</div>
	);
}
