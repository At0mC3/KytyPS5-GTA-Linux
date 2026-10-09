// Short synthesized interface sounds, in the spirit of the console's navigation ticks.
type Sound = 'move' | 'confirm' | 'back' | 'error' | 'launch';

let context: AudioContext | undefined;
let enabled = true;

export function setSoundsEnabled(value: boolean): void {
	enabled = value;
}

function tone(ctx: AudioContext, start: number, frequency: number, duration: number, volume: number, type: OscillatorType = 'sine'): void {
	const osc = ctx.createOscillator();
	const gain = ctx.createGain();
	osc.type = type;
	osc.frequency.setValueAtTime(frequency, start);
	gain.gain.setValueAtTime(0, start);
	gain.gain.linearRampToValueAtTime(volume, start + 0.004);
	gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
	osc.connect(gain).connect(ctx.destination);
	osc.start(start);
	osc.stop(start + duration + 0.02);
}

export function playSound(sound: Sound): void {
	if (!enabled) {
		return;
	}
	try {
		context ??= new AudioContext();
		const ctx = context;
		const now = ctx.currentTime;
		switch (sound) {
			case 'move':
				tone(ctx, now, 1650, 0.035, 0.025);
				break;
			case 'confirm':
				tone(ctx, now, 990, 0.06, 0.04);
				tone(ctx, now + 0.045, 1480, 0.08, 0.035);
				break;
			case 'back':
				tone(ctx, now, 880, 0.05, 0.035);
				tone(ctx, now + 0.04, 660, 0.07, 0.03);
				break;
			case 'error':
				tone(ctx, now, 220, 0.12, 0.05, 'triangle');
				break;
			case 'launch':
				tone(ctx, now, 523, 0.25, 0.04);
				tone(ctx, now + 0.08, 784, 0.3, 0.035);
				tone(ctx, now + 0.16, 1046, 0.45, 0.03);
				break;
		}
	} catch {
		// Audio is optional.
	}
}
