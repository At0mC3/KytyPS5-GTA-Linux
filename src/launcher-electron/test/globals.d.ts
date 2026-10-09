export {};

declare global {
	interface Window {
		__kytyDebug?: { renderer: string; frames: () => number; state?: () => unknown };
	}
}
