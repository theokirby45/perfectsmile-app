// WebGL2 renderer for the treatment sequence.
//
// Deliberately dependency-free rather than Pixi/three: everything here is one
// fullscreen triangle and one fragment shader, so there's no library API to
// track and nothing to bundle. Every entry point returns null (or no-ops)
// rather than throwing, so the caller can fall back to the CSS sequence on any
// device where this doesn't come up.

const VERT = `#version 300 es
void main() {
  // Fullscreen triangle from gl_VertexID — no attribute buffers needed.
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
out vec4 frag;

uniform sampler2D uBefore;
uniform sampler2D uAfter;
uniform vec2  uRes;        // canvas size in px
uniform vec2  uMouth;      // mouth anchor in IMAGE uv
uniform float uImgAspect;  // source image w/h — frame no longer matches it
uniform float uTime;
uniform float uScan;
uniform float uRipple;
uniform float uAberr;
uniform float uBloom;
uniform float uSparkle;
uniform float uReveal;
uniform float uPunch;      // decaying impulse fired on each beat change

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  uv.y = 1.0 - uv.y;

  float frameA = uRes.x / max(uRes.y, 1.0);

  // Cover-fit: the frame is now the viewport, not the photo, so map frame uv
  // into image uv instead of stretching the texture across it.
  // Guard: a zero aspect would collapse the mapping and render pure black.
  float imgA = max(uImgAspect, 0.0001);
  vec2 sc = frameA > imgA ? vec2(1.0, imgA / frameA) : vec2(frameA / imgA, 1.0);

  // Anchor lives in image space; bring it into frame space to centre effects.
  vec2 mouthF = (uMouth - 0.5) / sc + 0.5;

  // Beat punch: a short shove toward the mouth.
  vec2 uvZ = mix(uv, mouthF + (uv - mouthF) * 0.93, uPunch);

  vec2  d = (uvZ - mouthF) * vec2(frameA, 1.0);
  float r = length(d);
  vec2  dir = r > 0.0001 ? d / r : vec2(0.0);

  float ring = sin(r * 34.0 - uTime * 4.2);
  float falloff = exp(-r * 3.4);
  vec2 warped = uvZ + dir * ring * falloff * 0.016 * uRipple;

  // Shockwave expanding from the mouth on each beat.
  float wr = (1.0 - uPunch) * 0.85;
  float wave = sin((r - wr) * 42.0) * exp(-abs(r - wr) * 11.0);
  warped += dir * wave * 0.022 * uPunch;

  float ca = uAberr * (0.0016 + 0.0042 * abs(ring) * falloff) + uPunch * 0.006;

  vec2 tBase = (warped - 0.5) * sc + 0.5;
  vec2 tOff  = dir * ca * sc;

  vec3 col;
  col.r = texture(uBefore, tBase + tOff).r;
  col.g = texture(uBefore, tBase).g;
  col.b = texture(uBefore, tBase - tOff).b;

  if (uReveal > 0.0) {
    vec3 after;
    after.r = texture(uAfter, tBase + tOff).r;
    after.g = texture(uAfter, tBase).g;
    after.b = texture(uAfter, tBase - tOff).b;
    float front = uReveal * 1.55 - r * 0.55;
    float mask = smoothstep(0.0, 0.22, front - noise(uv * 26.0) * 0.22);
    col = mix(col, after, clamp(mask, 0.0, 1.0));
    col += vec3(0.45, 0.85, 1.0) * exp(-pow((mask - 0.5) * 5.0, 2.0)) * 0.5 * (1.0 - uReveal);
  }

  float beamY = fract(uTime * 0.42);
  float beam = exp(-pow((uv.y - beamY) * 13.0, 2.0));
  col += vec3(0.36, 0.88, 1.0) * beam * 0.5 * uScan;

  vec2 g = abs(fract(uv * vec2(frameA, 1.0) * 22.0) - 0.5);
  float grid = smoothstep(0.46, 0.5, max(g.x, g.y));
  col += vec3(0.36, 0.88, 1.0) * grid * 0.11 * uScan;

  float glow = exp(-r * 7.5) * (0.62 + 0.38 * sin(uTime * 3.1));
  col += vec3(1.0) * glow * 0.30 * uBloom;
  col = mix(col, clamp(col * 1.16 + 0.035, 0.0, 1.0), exp(-r * 5.5) * uBloom);

  if (uSparkle > 0.0) {
    vec2 sUv = vec2(uv.x * frameA, uv.y) * 26.0;
    vec2 cell = floor(sUv);
    vec2 f = fract(sUv);
    float pick = step(0.94, hash(cell + 3.7));
    float life = fract(uTime * 0.55 + hash(cell) * 7.0);
    float twinkle = exp(-pow((life - 0.5) * 6.0, 2.0));
    vec2 dp = f - vec2(hash(cell + 1.3), hash(cell + 5.9));
    float core = exp(-length(dp) * 16.0);
    float flareX = exp(-abs(dp.x) * 42.0) * exp(-abs(dp.y) * 9.0);
    float flareY = exp(-abs(dp.y) * 42.0) * exp(-abs(dp.x) * 9.0);
    col += vec3(1.0) * pick * twinkle * (core + 0.55 * (flareX + flareY)) * exp(-r * 6.5) * 1.6 * uSparkle;
  }

  // Beat flash + a hard ring edge, so the punch reads even on a busy photo.
  col += vec3(0.42, 0.86, 1.0) * uPunch * 0.14;
  col += vec3(1.0) * exp(-abs(r - wr) * 26.0) * uPunch * 0.35;

  float vig = smoothstep(1.25, 0.35, length((uv - 0.5) * vec2(frameA, 1.0)));
  col *= mix(0.72, 1.0, vig);

  frag = vec4(col, 1.0);
}`;

function compile(gl, type, source) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('[treatment-gl] shader compile failed:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function makeTexture(gl, image) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  return tex;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

export function isSupported() {
  if (typeof document === 'undefined') return false;
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

// Levels per stage, lerped so beats blend rather than snap.
const LEVELS = [
  { scan: 1.0, ripple: 0.15, aberr: 0.2, bloom: 0.0, sparkle: 0.0 }, // 0 scan
  { scan: 0.7, ripple: 0.55, aberr: 0.4, bloom: 0.1, sparkle: 0.0 }, // 1 map
  { scan: 0.4, ripple: 1.00, aberr: 1.0, bloom: 0.3, sparkle: 0.0 }, // 2 align
  { scan: 0.2, ripple: 0.45, aberr: 0.3, bloom: 1.0, sparkle: 1.0 }, // 3 whiten
];

/**
 * Starts the renderer on `canvas`. Returns a handle, or null if WebGL2 or the
 * shader is unavailable — callers must treat null as "use the CSS fallback".
 */
export function createTreatment(canvas, beforeSrc) {
  try {
    return build(canvas, beforeSrc);
  } catch (err) {
    console.warn('[treatment-gl] init failed:', err.message);
    return null;
  }
}

function build(canvas, beforeSrc) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false });
  if (!gl || gl.isContextLost()) return null;

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn('[treatment-gl] link failed:', gl.getProgramInfoLog(prog));
    return null;
  }

  const u = {};
  for (const name of ['uBefore', 'uAfter', 'uRes', 'uMouth', 'uTime', 'uImgAspect',
                      'uScan', 'uRipple', 'uAberr', 'uBloom', 'uSparkle', 'uReveal', 'uPunch']) {
    u[name] = gl.getUniformLocation(prog, name);
  }

  const vao = gl.createVertexArray();   // required by core profile even when unused
  const state = {
    stage: 0,
    reveal: 0,
    mouth: [0.5, 0.63],
    imgAspect: 1,
    punchAt: 0,
    texBefore: null,
    texAfter: null,
    disposed: false,
    raf: 0,
  };
  const t0 = performance.now();
  let cur = { ...LEVELS[0] };
  let frameCount = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function frame() {
    if (state.disposed) return;
    resize();
    const t = (performance.now() - t0) / 1000;

    const target = LEVELS[Math.min(state.stage, LEVELS.length - 1)];
    // Exponential approach — frame-rate independent enough for this purpose.
    for (const k of Object.keys(cur)) cur[k] += (target[k] - cur[k]) * 0.06;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.texBefore);
    gl.uniform1i(u.uBefore, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, state.texAfter || state.texBefore);
    gl.uniform1i(u.uAfter, 1);

    gl.uniform2f(u.uRes, canvas.width, canvas.height);
    gl.uniform2f(u.uMouth, state.mouth[0], state.mouth[1]);
    gl.uniform1f(u.uImgAspect, state.imgAspect);
    gl.uniform1f(u.uTime, t);
    // Impulse decays over ~380ms from the last beat change.
    const punch = state.punchAt
      ? Math.exp(-(performance.now() - state.punchAt) / 380)
      : 0;
    gl.uniform1f(u.uPunch, punch < 0.01 ? 0 : punch);
    gl.uniform1f(u.uScan, cur.scan);
    gl.uniform1f(u.uRipple, cur.ripple);
    gl.uniform1f(u.uAberr, cur.aberr);
    gl.uniform1f(u.uBloom, cur.bloom);
    gl.uniform1f(u.uSparkle, cur.sparkle);
    gl.uniform1f(u.uReveal, state.reveal);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    frameCount++;
    state.raf = requestAnimationFrame(frame);
  }

  let started = false;
  loadImage(beforeSrc)
    .then(img => {
      if (state.disposed) return;
      state.texBefore = makeTexture(gl, img);
      state.imgAspect = img.naturalWidth / Math.max(1, img.naturalHeight);
      started = true;
      frame();
    })
    .catch(err => console.warn('[treatment-gl]', err.message));

  return {
    setStage(n) {
      if (n !== state.stage) state.punchAt = performance.now();
      state.stage = n;
    },
    /** Fire the impulse without changing beat — used at the reveal. */
    punch() { state.punchAt = performance.now(); },
    setMouth(x, y) { state.mouth = [x, y]; },

    /** Loads the result image and returns a promise that resolves once it's uploaded. */
    async setAfter(src) {
      try {
        const img = await loadImage(src);
        if (state.disposed) return false;
        state.texAfter = makeTexture(gl, img);
        return true;
      } catch (err) {
        console.warn('[treatment-gl]', err.message);
        return false;
      }
    },

    setReveal(v) { state.reveal = v; },
    get ready() { return started; },
    /** Frames drawn — lets a diagnostic tell a stalled loop from a throttled tab. */
    get frames() { return frameCount; },

    dispose() {
      state.disposed = true;
      cancelAnimationFrame(state.raf);
      try {
        gl.deleteTexture(state.texBefore);
        gl.deleteTexture(state.texAfter);
        gl.deleteProgram(prog);
        gl.deleteVertexArray(vao);
      } catch {}
    },
  };
}
