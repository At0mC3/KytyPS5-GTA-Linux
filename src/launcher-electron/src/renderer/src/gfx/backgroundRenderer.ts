// GPU-rendered dashboard background (WebGL2): the selected game's art fills the screen with a
// slow drift and cross-fades when the selection changes, under soft moving light bands. Settings
// and dialogs blur it. Drawn at a reduced resolution and only while visible.

const VERTEX = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
	vUv = aPos * 0.5 + 0.5;
	gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform float uHasA;
uniform float uHasB;
uniform float uMix;
uniform float uTime;
uniform float uBlur;
uniform float uDim;
uniform vec2 uResolution;
uniform vec2 uSizeA;
uniform vec2 uSizeB;
uniform vec3 uTint;

vec2 coverUv(vec2 uv, vec2 size, float zoom, vec2 drift) {
	float screenAspect = uResolution.x / uResolution.y;
	float imageAspect = size.x / max(size.y, 1.0);
	vec2 scale = screenAspect > imageAspect ? vec2(1.0, imageAspect / screenAspect) : vec2(screenAspect / imageAspect, 1.0);
	vec2 centered = (uv - 0.5) * scale / zoom + 0.5 + drift;
	return vec2(centered.x, 1.0 - centered.y);
}

vec3 sampleArt(sampler2D tex, vec2 uv, float blur) {
	if (blur < 0.01) {
		return texture(tex, uv).rgb;
	}
	// Mip-biased taps on a rotated disc give a smooth, cheap blur.
	vec3 sum = vec3(0.0);
	float radius = blur * 0.02;
	float bias = blur * 4.0;
	for (int i = 0; i < 8; i++) {
		float angle = float(i) * 0.785398 + 0.3;
		vec2 offset = vec2(cos(angle), sin(angle)) * radius;
		sum += texture(tex, uv + offset, bias).rgb;
	}
	return sum / 8.0;
}

float band(vec2 uv, float speed, float offset, float width) {
	float wave = 0.5 + 0.18 * sin(uv.x * 3.1 + uTime * speed + offset) + 0.08 * sin(uv.x * 7.3 - uTime * speed * 1.7 + offset);
	return exp(-pow((uv.y - wave) / width, 2.0));
}

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
	vec2 uv = vUv;
	float t = uTime;
	float zoom = 1.06 + 0.015 * sin(t * 0.05);
	vec2 drift = vec2(0.012 * sin(t * 0.031), 0.008 * cos(t * 0.027));

	// Base: deep blue gradient used when there is no art.
	vec3 base = mix(vec3(0.01, 0.03, 0.09), vec3(0.03, 0.09, 0.22), uv.y);
	base += uTint * 0.12 * (1.0 - uv.y);

	vec3 artA = sampleArt(uTexA, coverUv(uv, uSizeA, zoom, drift), uBlur);
	vec3 artB = sampleArt(uTexB, coverUv(uv, uSizeB, zoom, drift), uBlur);
	vec3 colorA = mix(base, artA, uHasA);
	vec3 colorB = mix(base, artB, uHasB);
	vec3 color = mix(colorA, colorB, smoothstep(0.0, 1.0, uMix));

	// Light bands drifting across the screen, stronger without art.
	float hasArt = mix(uHasA, uHasB, uMix);
	float light = band(uv, 0.11, 0.0, 0.08) * 0.55 + band(uv + vec2(0.3, -0.12), 0.07, 2.1, 0.05) * 0.35 + band(uv + vec2(-0.2, 0.18), 0.05, 4.2, 0.12) * 0.25;
	vec3 lightColor = mix(vec3(0.25, 0.55, 1.0), uTint + 0.3, 0.4);
	color += lightColor * light * mix(0.22, 0.07, hasArt);

	// Sparse floating particles.
	vec2 grid = uv * vec2(uResolution.x / uResolution.y, 1.0) * 26.0 + vec2(0.0, -t * 0.12);
	vec2 cell = floor(grid);
	vec2 local = fract(grid) - 0.5;
	float seed = hash(cell);
	float spark = seed > 0.94 ? smoothstep(0.08, 0.0, length(local - (vec2(hash(cell + 1.3), hash(cell + 7.1)) - 0.5) * 0.6)) : 0.0;
	color += vec3(0.6, 0.8, 1.0) * spark * (0.25 + 0.25 * sin(t * 1.5 + seed * 40.0)) * mix(0.8, 0.35, hasArt);

	// Keep text readable: darken the left and the bottom like the console dashboard.
	float left = smoothstep(0.75, 0.0, uv.x);
	float bottom = smoothstep(0.65, 0.0, uv.y);
	color *= 1.0 - 0.45 * left * (0.6 + 0.4 * bottom);
	color *= 1.0 - 0.35 * bottom;
	color *= 1.0 - uDim;
	vec2 vignette = uv - 0.5;
	color *= 1.0 - dot(vignette, vignette) * 0.55;

	outColor = vec4(color, 1.0);
}`;

interface Slot {
	texture: WebGLTexture;
	width: number;
	height: number;
	has: boolean;
	url?: string;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
	const shader = gl.createShader(type)!;
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile failed');
	}
	return shader;
}

export interface BackgroundOptions {
	animate: boolean;
	blur: number;
	dim: number;
	tint: [number, number, number];
}

export class BackgroundRenderer {
	private gl: WebGL2RenderingContext;
	private program: WebGLProgram;
	private uniforms: Record<string, WebGLUniformLocation | null> = {};
	private slots: [Slot, Slot];
	private front = 0;
	private mix = 1;
	private mixStart = 0;
	private frame = 0;
	private startTime = performance.now();
	private running = false;
	private blur = 0;
	private targetBlur = 0;
	private options: BackgroundOptions = { animate: true, blur: 0, dim: 0, tint: [0.1, 0.3, 0.8] };
	private loadToken = 0;
	private wantedUrl: string | undefined;
	frames = 0;

	debugState(): unknown {
		return { front: this.front, mix: this.mix, wanted: this.wantedUrl, lost: this.gl.isContextLost(), slots: this.slots.map((slot) => ({ has: slot.has, url: slot.url, width: slot.width })) };
	}

	static create(canvas: HTMLCanvasElement): BackgroundRenderer | undefined {
		const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
		if (gl === null) {
			return undefined;
		}
		try {
			return new BackgroundRenderer(canvas, gl);
		} catch {
			return undefined;
		}
	}

	private constructor(
		private readonly canvas: HTMLCanvasElement,
		gl: WebGL2RenderingContext,
	) {
		this.gl = gl;
		const { program, slots } = this.init();
		this.program = program;
		this.slots = slots;
		// The GPU process can reset (driver updates, a game taking over the GPU); rebuild then.
		canvas.addEventListener('webglcontextlost', (event) => {
			event.preventDefault();
			cancelAnimationFrame(this.frame);
			this.frame = 0;
		});
		canvas.addEventListener('webglcontextrestored', () => {
			const url = this.wantedUrl;
			const { program: restoredProgram, slots: restoredSlots } = this.init();
			this.program = restoredProgram;
			this.slots = restoredSlots;
			this.mix = 1;
			void this.setImage(url, true);
			this.requestFrame();
		});
	}

	private init(): { program: WebGLProgram; slots: [Slot, Slot] } {
		const gl = this.gl;
		const program = gl.createProgram()!;
		gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
		gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
		gl.bindAttribLocation(program, 0, 'aPos');
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			throw new Error(gl.getProgramInfoLog(program) ?? 'link failed');
		}
		for (const name of ['uTexA', 'uTexB', 'uHasA', 'uHasB', 'uMix', 'uTime', 'uBlur', 'uDim', 'uResolution', 'uSizeA', 'uSizeB', 'uTint']) {
			this.uniforms[name] = gl.getUniformLocation(program, name);
		}
		const buffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
		const makeSlot = (): Slot => {
			const texture = gl.createTexture()!;
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
			return { texture, width: 1, height: 1, has: false };
		};
		return { program, slots: [makeSlot(), makeSlot()] };
	}

	setOptions(options: Partial<BackgroundOptions>): void {
		this.options = { ...this.options, ...options };
		this.targetBlur = this.options.blur;
		this.requestFrame();
	}

	async setImage(url: string | undefined, force = false): Promise<void> {
		const current = this.slots[this.front]!;
		if (current.url === url && !force) {
			return;
		}
		this.wantedUrl = url;
		const token = ++this.loadToken;
		let bitmap: ImageBitmap | undefined;
		if (url !== undefined) {
			try {
				const response = await fetch(url);
				const blob = await response.blob();
				bitmap = await createImageBitmap(blob, { resizeWidth: 1280, resizeQuality: 'high' });
			} catch {
				bitmap = undefined;
			}
		}
		if (token !== this.loadToken || this.gl.isContextLost()) {
			bitmap?.close();
			return;
		}
		const gl = this.gl;
		const back = this.slots[1 - this.front]!;
		gl.bindTexture(gl.TEXTURE_2D, back.texture);
		if (bitmap !== undefined) {
			gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
			gl.generateMipmap(gl.TEXTURE_2D);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			back.width = bitmap.width;
			back.height = bitmap.height;
			back.has = true;
			bitmap.close();
		} else {
			back.has = false;
		}
		back.url = url;
		this.front = 1 - this.front;
		this.mix = force ? 1 : 0;
		this.mixStart = force ? 0 : performance.now();
		this.requestFrame();
	}

	start(): void {
		this.running = true;
		this.requestFrame();
	}

	stop(): void {
		this.running = false;
		cancelAnimationFrame(this.frame);
		this.frame = 0;
	}

	private requestFrame(): void {
		if (this.frame === 0 && !this.gl.isContextLost()) {
			this.frame = requestAnimationFrame(() => {
				this.frame = 0;
				this.draw();
			});
		}
	}

	private resize(): void {
		const scale = Math.min(window.devicePixelRatio || 1, 2) * 0.5;
		const width = Math.max(1, Math.round(this.canvas.clientWidth * scale));
		const height = Math.max(1, Math.round(this.canvas.clientHeight * scale));
		if (this.canvas.width !== width || this.canvas.height !== height) {
			this.canvas.width = width;
			this.canvas.height = height;
		}
	}

	private draw(): void {
		const gl = this.gl;
		if (gl.isContextLost()) {
			return;
		}
		this.resize();
		const now = performance.now();
		this.mix = this.mixStart === 0 ? 1 : Math.min(1, (now - this.mixStart) / 700);
		this.blur += (this.targetBlur - this.blur) * 0.18;
		if (Math.abs(this.targetBlur - this.blur) < 0.01) {
			this.blur = this.targetBlur;
		}
		const time = this.options.animate ? (now - this.startTime) / 1000 : 0;
		const a = this.slots[1 - this.front]!;
		const b = this.slots[this.front]!;
		gl.viewport(0, 0, this.canvas.width, this.canvas.height);
		gl.useProgram(this.program);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, a.texture);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, b.texture);
		const u = this.uniforms;
		gl.uniform1i(u.uTexA!, 0);
		gl.uniform1i(u.uTexB!, 1);
		gl.uniform1f(u.uHasA!, a.has ? 1 : 0);
		gl.uniform1f(u.uHasB!, b.has ? 1 : 0);
		gl.uniform1f(u.uMix!, this.mix);
		gl.uniform1f(u.uTime!, time);
		gl.uniform1f(u.uBlur!, this.blur);
		gl.uniform1f(u.uDim!, this.options.dim);
		gl.uniform2f(u.uResolution!, this.canvas.width, this.canvas.height);
		gl.uniform2f(u.uSizeA!, a.width, a.height);
		gl.uniform2f(u.uSizeB!, b.width, b.height);
		gl.uniform3f(u.uTint!, ...this.options.tint);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		this.frames++;
		const settling = this.mix < 1 || this.blur !== this.targetBlur;
		if ((this.running && this.options.animate) || settling) {
			this.requestFrame();
		}
	}

	dispose(): void {
		this.stop();
		this.gl.getExtension('WEBGL_lose_context')?.loseContext();
	}
}
