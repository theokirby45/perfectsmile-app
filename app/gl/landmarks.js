// Real face landmarks via MediaPipe Face Landmarker.
//
// Everything drawn here comes from the library: the 478-point tesselation and
// the lip contour are MediaPipe's own connection sets rendered by its
// DrawingUtils. Nothing is hand-authored artwork.
//
// wasm + model load from CDN so nothing heavy lands in the repo. To go
// offline, copy node_modules/@mediapipe/tasks-vision/wasm into public/ and
// point WASM_BASE at it.

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

let modulePromise = null;
let landmarkerPromise = null;

function loadModule() {
  modulePromise ||= import('@mediapipe/tasks-vision');
  return modulePromise;
}

// One landmarker for the whole page — model init is the expensive part and
// several cards may ask for it at once.
function getLandmarker() {
  landmarkerPromise ||= (async () => {
    const vision = await loadModule();
    const fileset = await vision.FilesetResolver.forVisionTasks(WASM_BASE);
    return vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'IMAGE',
      numFaces: 1,
    });
  })().catch(err => {
    console.warn('[landmarks] init failed:', err?.message || err);
    landmarkerPromise = null;      // let a later card retry
    return null;
  });
  return landmarkerPromise;
}

/** Starts model download early so the first detection isn't a cold start. */
export function warmUp() {
  try { getLandmarker(); } catch {}
}

/** Unique landmark indices touched by a connection set. */
function indicesOf(connections) {
  const seen = new Set();
  for (const c of connections) { seen.add(c.start); seen.add(c.end); }
  return [...seen];
}

/**
 * Detects one face in an already-loaded <img>.
 * Resolves to null when the model is unavailable or no face is found —
 * callers keep their fallback anchor in that case.
 */
export async function detectFace(imgEl) {
  try {
    const landmarker = await getLandmarker();
    if (!landmarker) return null;
    const vision = await loadModule();

    const res = landmarker.detect(imgEl);
    const landmarks = res?.faceLandmarks?.[0];
    if (!landmarks?.length) return null;

    // Mouth anchor = centroid of the library's own lip contour, rather than
    // hand-picked landmark indices.
    const lipIdx = indicesOf(vision.FaceLandmarker.FACE_LANDMARKS_LIPS);
    let mx = 0, my = 0;
    for (const i of lipIdx) { mx += landmarks[i].x; my += landmarks[i].y; }
    mx /= lipIdx.length;
    my /= lipIdx.length;

    return { landmarks, mouth: { x: mx, y: my } };
  } catch (err) {
    console.warn('[landmarks] detect failed:', err?.message || err);
    return null;
  }
}

/**
 * Resolves a synchronous painter bound to a 2D context. Async work (module
 * load) happens once, up front, so the draw itself can sit in a rAF loop.
 */
export async function createPainter(ctx) {
  const vision = await loadModule();
  const { DrawingUtils, FaceLandmarker } = vision;
  const du = new DrawingUtils(ctx);
  const F = FaceLandmarker;

  const tess = F.FACE_LANDMARKS_TESSELATION;
  // Feature contours read as face tracking; the raw tesselation on its own
  // just reads as noise, so it sits underneath at low opacity as texture.
  const contours = [
    F.FACE_LANDMARKS_RIGHT_EYE, F.FACE_LANDMARKS_LEFT_EYE,
    F.FACE_LANDMARKS_RIGHT_EYEBROW, F.FACE_LANDMARKS_LEFT_EYEBROW,
    F.FACE_LANDMARKS_RIGHT_IRIS, F.FACE_LANDMARKS_LEFT_IRIS,
  ].filter(Boolean);

  return function paint(landmarks, { progress = 1, lips = false } = {}) {
    const p = Math.min(1, Math.max(0, progress));

    const n = Math.floor(tess.length * p);
    if (n > 0) {
      du.drawConnectors(landmarks, tess.slice(0, n), {
        color: 'rgba(92,225,255,0.12)', lineWidth: 0.5,
      });
    }

    // Features come in once the sweep is most of the way across.
    if (p > 0.55) {
      const fade = Math.min(1, (p - 0.55) / 0.35);
      for (const set of contours) {
        du.drawConnectors(landmarks, set, {
          color: `rgba(92,225,255,${(0.75 * fade).toFixed(3)})`, lineWidth: 1.3,
        });
      }
      du.drawConnectors(landmarks, F.FACE_LANDMARKS_FACE_OVAL, {
        color: `rgba(92,225,255,${(0.5 * fade).toFixed(3)})`, lineWidth: 1.4,
      });
    }

    if (lips) {
      du.drawConnectors(landmarks, F.FACE_LANDMARKS_LIPS, {
        color: 'rgba(150,245,255,0.95)', lineWidth: 2.2,
      });
    }
  };
}
