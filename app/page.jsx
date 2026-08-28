'use client';

import { useState, useEffect, useRef, useCallback, useId } from 'react';
import { createTreatment } from './gl/treatment';
import { detectFace, createPainter, warmUp } from './gl/landmarks';
import { celebrate, chime, beat, unlockAudio, setSoundEnabled } from './fx/celebrate';

const BLUE = '#072AC8';
const POLL_INTERVAL = 5000;
const MAX_POLLS = 60;

const HEALTH_COLORS = { checking: '#999', ok: '#1a7a3f', down: '#c0392b' };

const APIS = [
  { label: 'Jobs API — Dev', base: 'https://txp-dev.smile2impress.com/api/a065f828-8dfa-455c-a63b-c8cd82b70840/v0.0.1', token: 'D0D41351C50A41E887F33AC51FF1CF40' },
  { label: 'Jobs API — Prelive', base: 'https://txp-prelive.smile2impress.com/api/a065f828-8dfa-455c-a63b-c8cd82b70840/v0.0.1', token: 'D0D41351C50A41E887F33AC51FF1CF40' },
  { label: 'Perfectsmile API — Prelive', base: 'https://txp-prelive.smile2impress.com/api/f7ec0705-84c3-4594-a598-d1e7a523ad8e/v1.0', token: 'FC3B774F363DB6749D6DF65BEB012427', health: true, sync: true },
];

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // result is "data:image/jpeg;base64,XXXX" — strip the prefix
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}


function getJobStatus(data) {
  const s = data?.status?.toLowerCase();
  if (s === 'failed' || s === 'error') return 'failed';
  if (s === 'succeeded' || s === 'completed' || s === 'done' || s === 'success') return 'completed';
  return 'pending';
}

function extractUid(data) {
  return data?.uid ?? data?.id ?? data?.job_id ?? data?.task_id ?? null;
}

function elapsed(startTime) {
  const s = Math.floor((Date.now() - startTime) / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function StatusBadge({ status }) {
  const map = {
    queued:    { bg: '#f0f0f0', color: '#777', label: 'Queued' },
    uploading: { bg: '#e8eeff', color: BLUE, label: 'Uploading…' },
    polling:   { bg: '#e8eeff', color: BLUE, label: null },
    done:      { bg: '#e6f9ee', color: '#1a7a3f', label: 'Done' },
    error:     { bg: '#ffeeed', color: '#c0392b', label: 'Error' },
    timeout:   { bg: '#fff5e6', color: '#b05000', label: 'Timed out' },
  };
  const s = map[status] || map.uploading;
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 20,
      fontSize: 12,
      fontWeight: 600,
      background: s.bg,
      color: s.color,
    }}>
      {s.label ?? status}
    </span>
  );
}

// Before/after comparison. The two images are stacked and the top one is clipped
// at the handle position; a transparent range input over the whole frame drives
// it, which gets us touch-drag and keyboard support from the native control.
function BeforeAfterSlider({ before, after }) {
  const [pos, setPos] = useState(0);
  const userMoved = useRef(false);
  const frameRef = useRef(null);

  // The payoff moment — this component mounts exactly once per result.
  useEffect(() => {
    frameRef.current?.scrollIntoView({ block: 'center' });
    celebrate(frameRef.current);
    chime();
  }, []);

  // Reveal: wipe from the result across to the halfway mark. Bails the moment
  // the user grabs the handle so it never fights a drag.
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setPos(50);
      return;
    }
    const DUR = 900;
    const t0 = performance.now();
    let raf;
    const tick = now => {
      if (userMoved.current) return;
      const p = Math.min(1, (now - t0) / DUR);
      setPos((1 - Math.pow(1 - p, 3)) * 50);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={frameRef} style={{
      position: 'relative',
      width: '100%',
      borderRadius: 10,
      overflow: 'hidden',
      background: '#000',
      lineHeight: 0,
    }}>
      {/* Before defines the frame size; after is overlaid on top of it. */}
      <img src={before} alt="Before" style={{ width: '100%', height: 'auto', display: 'block' }} />
      <img
        src={after}
        alt="After"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          clipPath: `inset(0 0 0 ${pos}%)`,
        }}
      />

      <div className="ps-fx" style={{
        position: 'absolute', inset: 0, background: '#fff',
        pointerEvents: 'none', animation: 'ps-flash 0.7s ease-out both',
      }} />

      <span style={{
        position: 'absolute', top: 8, left: 8,
        padding: '2px 8px', borderRadius: 20,
        background: 'rgba(0,0,0,0.55)', color: '#fff',
        fontSize: 10, fontWeight: 700, letterSpacing: '0.5px',
        pointerEvents: 'none', lineHeight: 1.6,
        opacity: pos > 12 ? 1 : 0, transition: 'opacity 0.15s',
      }}>BEFORE</span>
      <span style={{
        position: 'absolute', top: 8, right: 8,
        padding: '2px 8px', borderRadius: 20,
        background: 'rgba(7,42,200,0.75)', color: '#fff',
        fontSize: 10, fontWeight: 700, letterSpacing: '0.5px',
        pointerEvents: 'none', lineHeight: 1.6,
        opacity: pos < 88 ? 1 : 0, transition: 'opacity 0.15s',
      }}>AFTER</span>

      {/* Divider + grab handle, drawn at the same percentage as the clip. */}
      <div style={{
        position: 'absolute', top: 0, bottom: 0, left: `${pos}%`,
        width: 2, marginLeft: -1,
        background: '#fff', boxShadow: '0 0 6px rgba(0,0,0,0.5)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', top: '50%', left: `${pos}%`,
        transform: 'translate(-50%, -50%)',
        width: 34, height: 34, borderRadius: '50%',
        background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: BLUE, fontSize: 13, fontWeight: 700, lineHeight: 1,
        pointerEvents: 'none',
      }}>⇄</div>

      <input
        className="ba-range"
        type="range"
        min="0"
        max="100"
        value={pos}
        onChange={e => { userMoved.current = true; setPos(Number(e.target.value)); }}
        aria-label="Before / after comparison"
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          margin: 0, opacity: 0, cursor: 'ew-resize',
          touchAction: 'pan-y',
        }}
      />
    </div>
  );
}

// Staged "treatment" theatre played over the customer's own photo while the API
// works. Timings are open-loop — the API reports no progress — so the last stage
// holds indefinitely and the reveal is whatever actually comes back.
const STAGES = [
  { key: 'scan',   label: 'Scanning your smile',      sub: 'capturing facial geometry',  ms: 2600 },
  { key: 'map',    label: 'Mapping your face',        sub: 'detecting 478 landmarks',    ms: 2600 },
  { key: 'lock',   label: 'Locking onto your smile',  sub: 'isolating the lip contour',   ms: 2800 },
  { key: 'whiten', label: 'Polishing & whitening',    sub: 'applying enamel shading',    ms: Infinity },
];

function TreatmentSequence({ src, active, afterSrc, onRevealDone, fullscreen }) {
  const gridId = useId().replace(/:/g, '');
  const [stage, setStage] = useState(0);
  const [gpu, setGpu] = useState(false);
  const canvasRef = useRef(null);
  const glRef = useRef(null);
  const doneRef = useRef(onRevealDone);
  doneRef.current = onRevealDone;
  const [face, setFace] = useState(null);
  const meshRef = useRef(null);
  const stageRef = useRef(0);
  stageRef.current = stage;
  const [tickNow, setTickNow] = useState(() => Date.now());
  const stageStart = useRef(Date.now());

  useEffect(() => { stageStart.current = Date.now(); }, [stage]);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTickNow(Date.now()), 70);
    return () => clearInterval(id);
  }, [active]);

  useEffect(() => { if (active) beat(stage); }, [stage, active]);

  // Detect once per photo. Null result (no model, no face) just leaves the
  // shader on its default anchor — the sequence still runs.
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = async () => {
      const res = await detectFace(img);
      if (cancelled || !res) return;
      setFace({ ...res, aspect: img.naturalWidth / Math.max(1, img.naturalHeight) });
    };
    img.onerror = () => {};
    img.src = src;
    return () => { cancelled = true; };
  }, [src]);

  // Point every GPU effect at the real mouth. Re-runs when GL comes up, since
  // detection and context creation race.
  useEffect(() => {
    if (face) glRef.current?.setMouth(face.mouth.x, face.mouth.y);
  }, [face, gpu]);

  // Progressive mesh reveal, painted by MediaPipe's DrawingUtils.
  useEffect(() => {
    if (!face || !meshRef.current) return;
    let cancelled = false;
    let raf = 0;
    (async () => {
      const cv = meshRef.current;
      if (!cv) return;
      const ctx = cv.getContext('2d');
      const paint = await createPainter(ctx);
      if (cancelled) return;
      const t0 = performance.now();
      const tick = now => {
        if (cancelled || !meshRef.current) return;
        // Landmarks are normalised to the photo, so size this canvas to the
        // cover rect — otherwise the mesh stretches once the frame is the
        // viewport rather than the image.
        const host = cv.parentElement;
        const fw = host?.clientWidth || 0;
        const fh = host?.clientHeight || 0;
        if (!fw || !fh) { raf = requestAnimationFrame(tick); return; }
        const ia = face.aspect || 1;
        const fa = fw / fh;
        const dw = fa > ia ? fw : fh * ia;
        const dh = fa > ia ? fw / ia : fh;
        cv.style.left = `${(fw - dw) / 2}px`;
        cv.style.top = `${(fh - dh) / 2}px`;
        cv.style.width = `${dw}px`;
        cv.style.height = `${dh}px`;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(1, Math.round(dw * dpr));
        const h = Math.max(1, Math.round(dh * dpr));
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
        ctx.clearRect(0, 0, cv.width, cv.height);
        if (stageRef.current >= 1) {
          paint(face.landmarks, {
            progress: Math.min(1, (now - t0) / 1100),
            lips: stageRef.current >= 2,
          });
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })();
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [face]);

  // WebGL2 does the pixel-level work (ripple, aberration, bloom, dissolve);
  // the detected face mesh and the caption layer sit on top of it.
  // Any failure here leaves `gpu` false and the CSS sequence showing.
  useEffect(() => {
    if (!canvasRef.current) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let inst = null;
    try {
      inst = createTreatment(canvasRef.current, src);
    } catch (err) {
      console.warn('[treatment] falling back to CSS:', err);
    }
    if (!inst) return;
    glRef.current = inst;
    setGpu(true);
    return () => {
      inst.dispose();
      glRef.current = null;
      setGpu(false);
    };
  }, [src]);

  useEffect(() => { glRef.current?.setStage(stage); }, [stage, gpu]);

  useEffect(() => {
    if (!active) return;
    if (stage >= STAGES.length - 1) return;
    const t = setTimeout(() => {
      setStage(s => s + 1);
      try { navigator.vibrate?.(12); } catch {}
    }, STAGES[stage].ms);
    return () => clearTimeout(t);
  }, [stage, active]);

  // The result landed: dissolve to it on the GPU, then hand over to the slider.
  // Every failure path calls back immediately so the slider is never blocked.
  useEffect(() => {
    if (!afterSrc) return;
    const inst = glRef.current;
    if (!inst) { doneRef.current?.(); return; }
    let cancelled = false;
    (async () => {
      const ok = await inst.setAfter(afterSrc);
      if (cancelled) return;
      if (!ok) { doneRef.current?.(); return; }
      inst.punch?.();
      const DUR = 1200;
      const t0 = performance.now();
      const tick = now => {
        if (cancelled) return;
        const p = Math.min(1, (now - t0) / DUR);
        inst.setReveal(p);
        if (p < 1) requestAnimationFrame(tick);
        else doneRef.current?.();
      };
      requestAnimationFrame(tick);
    })();
    return () => { cancelled = true; };
  }, [afterSrc]);

  const s = STAGES[stage];
  const at = stage;

  const stageMs = STAGES[stage].ms === Infinity ? 4000 : STAGES[stage].ms;
  const inStage = Math.min(1, Math.max(0, (tickNow - stageStart.current) / stageMs));
  const held = ((tickNow - stageStart.current) / 1000).toFixed(1);
  const readout =
    at === 0 ? `SCAN ${Math.round(inStage * 100)}%`
    : at === 1 ? (face ? `LANDMARKS ${Math.round(inStage * 478)} / 478` : 'DETECTING FACE…')
    : at === 2 ? (face ? 'LIP CONTOUR · 40 POINTS LOCKED' : 'NO FACE FOUND · USING CENTRE')
    : `ENAMEL PASS · ${held}s`;

  return (
    <div className="ps-fx" style={{
      position: 'relative', width: '100%',
      height: fullscreen ? '100%' : undefined,
      borderRadius: fullscreen ? 0 : 10,
      overflow: 'hidden', background: '#000', lineHeight: 0,
      // Only shake full-screen: inline, the translate would flash card-coloured
      // slivers at the edges.
      animation: fullscreen
        ? `${stage % 2 ? 'ps-shakeA' : 'ps-shakeB'} 0.5s cubic-bezier(.36,.07,.19,.97)`
        : undefined,
    }}>
      <img src={src} alt="Your photo" style={fullscreen ? {
        width: '100%', height: '100%', objectFit: 'cover', display: 'block',
      } : {
        width: '100%', height: 'auto', display: 'block',
        filter: !gpu && at >= 3 ? 'brightness(1.06) contrast(1.04) saturate(1.05)' : 'none',
        transition: 'filter 1.2s ease',
      }} />
      <canvas ref={canvasRef} style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        display: 'block', opacity: gpu ? 1 : 0,
      }} />

      {/* Cool technical tint + vignette */}
      {!gpu && <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(circle at 50% 45%, rgba(7,42,200,0.05), rgba(2,6,40,0.5))',
        mixBlendMode: 'multiply',
      }} />}

      {!gpu && (<>
      {/* Stage 0+: scan grid */}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        pointerEvents: 'none', opacity: 0.35,
      }}>
        <defs>
          <pattern id={`grid${gridId}`} width="8" height="8" patternUnits="userSpaceOnUse">
            <path d="M8 0H0V8" fill="none" stroke="#5ce1ff" strokeWidth="0.25" />
          </pattern>
        </defs>
        <rect width="100" height="100" fill={`url(#grid${gridId})`} />
      </svg>

      {/* Stage 0+: laser sweep */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '18%',
        pointerEvents: 'none', mixBlendMode: 'screen',
        background: 'linear-gradient(to bottom, rgba(92,225,255,0) 0%, rgba(92,225,255,0.45) 45%, #b8f4ff 50%, rgba(92,225,255,0.45) 55%, rgba(92,225,255,0) 100%)',
        animation: 'ps-sweep 2.2s linear infinite',
      }} />
      </>)}

      {/* MediaPipe's own tesselation + lip contour, drawn by its DrawingUtils.
          Nothing here is hand-authored — it's the detected mesh. */}
      <canvas ref={meshRef} style={{
        position: 'absolute', display: 'block', pointerEvents: 'none',
        opacity: at >= 1 && face ? 1 : 0, transition: 'opacity 0.4s',
      }} />

      {/* Which renderer actually engaged — the fallback is otherwise silent. */}
      <span style={{
        position: 'absolute', top: 8, right: 8,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 9, letterSpacing: '0.1em', padding: '2px 7px', borderRadius: 20,
        background: gpu ? 'rgba(92,225,255,0.18)' : 'rgba(255,255,255,0.14)',
        color: gpu ? '#8ceaff' : 'rgba(255,255,255,0.7)',
        pointerEvents: 'none', lineHeight: 1.7,
      }}>{gpu ? 'GPU' : 'CSS'}</span>

      {/* Caption + indeterminate progress */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        padding: fullscreen ? '60px 22px calc(22px + env(safe-area-inset-bottom))' : '22px 14px 12px',
        pointerEvents: 'none',
        background: 'linear-gradient(to top, rgba(2,6,40,0.85), rgba(2,6,40,0))',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
          <span style={{ color: '#fff', fontSize: fullscreen ? 22 : 14, fontWeight: 700, lineHeight: 1.25 }}>{s.label}</span>
          <span style={{ color: '#5ce1ff', fontSize: 11, fontWeight: 700, lineHeight: 1.3 }}>
            {at + 1}/{STAGES.length}
          </span>
        </div>
        <div style={{
          color: '#5ce1ff', fontSize: fullscreen ? 13 : 11, lineHeight: 1.4, marginBottom: 8,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontVariantNumeric: 'tabular-nums', letterSpacing: '0.06em',
        }}>
          {readout}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {STAGES.map((st, i) => (
            <div key={st.key} style={{
              flex: 1, height: 3, borderRadius: 2, overflow: 'hidden',
              background: i <= at ? '#5ce1ff' : 'rgba(255,255,255,0.22)',
              position: 'relative',
            }}>
              {i === at && (
                <div style={{
                  position: 'absolute', top: 0, bottom: 0, width: '40%',
                  background: 'linear-gradient(90deg, transparent, #fff, transparent)',
                  animation: 'ps-shimmer 1.1s linear infinite',
                }} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function JobCard({ job }) {
  const [, setNow] = useState(Date.now());
  const [revealDone, setRevealDone] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const handleRevealDone = useCallback(() => setRevealDone(true), []);

  const queued = job.status === 'queued';
  const active = job.status === 'polling' || job.status === 'uploading';
  const inFlight = active || queued;
  const afterSrcEarly = job.result?.output_url
    || (job.result?.result_image ? `data:image/png;base64,${job.result.result_image}` : null);
  const showSequence = !!job.preview
    && (active || (job.status === 'done' && afterSrcEarly && !revealDone));

  // Don't let the page scroll behind the takeover.
  useEffect(() => {
    if (!showSequence || !expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [showSequence, expanded]);

  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [inFlight]);

  const processingTime = job.result?.processing_time;
  const bbox = job.result?.bbox;

  const afterSrc = job.result?.output_url
    || (job.result?.result_image ? `data:image/png;base64,${job.result.result_image}` : null);

  return (
    <div style={{
      background: '#fff',
      borderRadius: 16,
      boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
      overflow: 'hidden',
      marginBottom: 16,
    }}>
      {/* Card header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '14px 16px',
        borderBottom: '1px solid #f0f0f0',
      }}>
        {job.preview && (
          <img src={job.preview} alt="" style={{
            width: 48, height: 48, objectFit: 'cover', borderRadius: 8, flexShrink: 0,
          }} />
        )}

        {/* Meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12, color: '#999', marginBottom: 4,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {job.name || new Date(job.startTime).toLocaleTimeString()}
            {job.apiLabel && (
              <span style={{ marginLeft: 8, color: '#bbb' }}>· {job.apiLabel}</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <StatusBadge status={job.status} />
            {job.status === 'polling' && (
              <span style={{ fontSize: 12, color: '#888' }}>
                {elapsed(job.startTime)}
              </span>
            )}
            {processingTime != null && (
              <span style={{ fontSize: 12, color: '#888' }}>
                {processingTime.toFixed ? processingTime.toFixed(2) : processingTime}s
              </span>
            )}
            {Array.isArray(bbox) && (
              <span style={{ fontSize: 12, color: '#888' }}>
                bbox [{bbox.join(', ')}]
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Waiting its turn — a still frame. Deliberately not the live sequence:
          each one holds a WebGL context, and a big batch would exhaust them. */}
      {queued && job.preview && (
        <div style={{ padding: '14px 16px' }}>
          <div style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', lineHeight: 0 }}>
            <img src={job.preview} alt="" style={{ width: '100%', display: 'block', filter: 'brightness(0.5) saturate(0.7)' }} />
            <span style={{
              position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.85)',
            }}>In queue</span>
          </div>
        </div>
      )}

      {/* The main event: the customer's own photo, front and centre. Stays
          mounted through the result so the GPU can dissolve into it. */}
      {showSequence && (
        // Same element position in both modes, so toggling never remounts the
        // sequence — a remount would drop the GL context and restart detection.
        <div style={expanded ? {
          position: 'fixed', inset: 0, zIndex: 60, background: '#000',
        } : { padding: '14px 16px' }}>
          <TreatmentSequence
            src={job.preview}
            active={active}
            afterSrc={job.status === 'done' ? afterSrc : null}
            onRevealDone={handleRevealDone}
            fullscreen={expanded}
          />
          {expanded && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label="Exit full screen"
              style={{
                position: 'absolute',
                top: 'calc(14px + env(safe-area-inset-top))', right: 14,
                width: 38, height: 38, borderRadius: '50%',
                background: 'rgba(0,0,0,0.45)', color: '#fff',
                border: '1px solid rgba(255,255,255,0.25)',
                fontSize: 15, lineHeight: 1, cursor: 'pointer', zIndex: 2,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >✕</button>
          )}
        </div>
      )}

      {/* Result */}
      {job.status === 'done' && (revealDone || !afterSrc) && (
        <div style={{ padding: '14px 16px' }}>
          {afterSrc && job.preview && (
            <div style={{ marginBottom: 12 }}>
              <BeforeAfterSlider before={job.preview} after={afterSrc} />
              <div style={{ fontSize: 11, color: '#aaa', textAlign: 'center', marginTop: 6 }}>
                Drag the handle to compare
              </div>
            </div>
          )}
          {afterSrc && !job.preview && (
            <img
              src={afterSrc}
              alt="Result"
              style={{ width: '100%', borderRadius: 10, display: 'block', marginBottom: 12 }}
            />
          )}
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 13, color: BLUE, fontWeight: 600, userSelect: 'none' }}>
              Raw JSON
            </summary>
            <pre style={{
              marginTop: 8,
              background: '#f4f6fb',
              borderRadius: 8,
              padding: 12,
              fontSize: 11,
              overflowX: 'auto',
              overflowY: 'auto',
              maxHeight: 280,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              color: '#222',
            }}>
              {JSON.stringify(job.result, null, 2)}
            </pre>
          </details>
        </div>
      )}

      {(job.status === 'error' || job.status === 'timeout') && job.error && (
        <div style={{ padding: '12px 16px', fontSize: 13, color: '#c0392b' }}>
          {job.error}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [apiIndex, setApiIndex] = useState(0);
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [picked, setPicked] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [health, setHealth] = useState(null);
  const [sound, setSound] = useState(true);
  const pollTimers = useRef({});
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const pickIdRef = useRef(0);

  useEffect(() => {
    const savedIdx = localStorage.getItem('ps_api_index');
    const idx = savedIdx !== null ? Number(savedIdx) : 0;
    setApiIndex(idx);
    const savedToken = localStorage.getItem(`ps_bearer_token_${idx}`);
    setToken(savedToken ?? APIS[idx]?.token ?? '');
    const savedSound = localStorage.getItem('ps_sound');
    const on = savedSound === null ? true : savedSound === '1';
    setSound(on);
    setSoundEnabled(on);
    return () => {
      Object.values(pollTimers.current).forEach(clearTimeout);
    };
  }, []);

  // The reference client health-checks before running inference — a "not ready"
  // service (models still loading) otherwise just looks like a failed photo.
  useEffect(() => {
    const api = APIS[apiIndex];
    if (!api?.health) {
      setHealth(null);
      return;
    }
    let cancelled = false;
    setHealth({ state: 'checking' });
    fetch(`/api/health?apiBase=${encodeURIComponent(api.base)}`)
      .then(res => res.json())
      .then(data => {
        if (cancelled) return;
        setHealth(data?.status === 'ok'
          ? { state: 'ok', gpu: data.gpu }
          : { state: 'down', error: data?.error || data?.status || 'not ready' });
      })
      .catch(err => {
        if (!cancelled) setHealth({ state: 'down', error: err.message });
      });
    return () => { cancelled = true; };
  }, [apiIndex]);

  function toggleSound() {
    const next = !sound;
    setSound(next);
    setSoundEnabled(next);
    localStorage.setItem('ps_sound', next ? '1' : '0');
    // Toggling is itself a gesture, so this is a valid moment to start audio.
    if (next) unlockAudio();
  }

  function handleApiChange(e) {
    const idx = Number(e.target.value);
    setApiIndex(idx);
    localStorage.setItem('ps_api_index', idx);
    const t = APIS[idx]?.token ?? '';
    setToken(t);
    localStorage.setItem(`ps_bearer_token_${idx}`, t);
  }

  function handleTokenChange(e) {
    setToken(e.target.value);
    localStorage.setItem(`ps_bearer_token_${apiIndex}`, e.target.value);
  }

  // Both the camera and the library picker feed this, and both append — that's
  // how you build up a batch one camera shot at a time.
  function handleAddFiles(e) {
    const files = Array.from(e.target.files || []);
    if (files.length) {
      warmUp();
      setPicked(prev => [
        ...prev,
        ...files.map(file => ({ id: `pick_${pickIdRef.current++}`, file, url: URL.createObjectURL(file) })),
      ]);
    }
    // Reset so re-picking or re-shooting the same file still fires onChange.
    e.target.value = '';
  }

  // Previews not yet submitted are ours to release; once a batch is submitted
  // its job cards own the object URLs for the rest of the session.
  function removePicked(id) {
    setPicked(prev => {
      const hit = prev.find(p => p.id === id);
      if (hit) URL.revokeObjectURL(hit.url);
      return prev.filter(p => p.id !== id);
    });
  }

  function clearPicked() {
    picked.forEach(p => URL.revokeObjectURL(p.url));
    setPicked([]);
  }

  function updateJob(id, patch) {
    setJobs(prev => prev.map(j => j.id === id ? { ...j, ...patch } : j));
  }

  const schedulePoll = useCallback((jobId, uid, tokenVal, apiBase, attempt = 1) => {
    pollTimers.current[jobId] = setTimeout(async () => {
      if (attempt > MAX_POLLS) {
        updateJob(jobId, { status: 'timeout', error: 'Timed out after 10 minutes.' });
        delete pollTimers.current[jobId];
        return;
      }
      try {
        const res = await fetch(`/api/get/${uid}`, {
          headers: { 'x-bearer-token': tokenVal, 'x-api-base': apiBase },
        });
        const data = await res.json();
        const status = data?.status?.toLowerCase();
        if (status === 'succeeded') {
          updateJob(jobId, { status: 'done', result: data });
          delete pollTimers.current[jobId];
        } else if (status === 'failed') {
          updateJob(jobId, { status: 'error', error: 'The model rejected this photo — try a different image', result: data });
          delete pollTimers.current[jobId];
        } else {
          schedulePoll(jobId, uid, tokenVal, apiBase, attempt + 1);
        }
      } catch {
        schedulePoll(jobId, uid, tokenVal, apiBase, attempt + 1);
      }
    }, POLL_INTERVAL);
  }, []);

  // One photo -> one job. Submitted one at a time so a batch doesn't stampede
  // the GPU, but every card is on screen from the moment you hit submit.
  async function dispatchJob(job, api, tokenVal) {
    updateJob(job.id, { status: 'uploading' });

    if (api.sync) {
      // Perfectsmile API — synchronous, JSON body with base64 image
      const image = await fileToBase64(job.file);
      const res = await fetch('/api/perfectsmile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-bearer-token': tokenVal, 'x-api-base': api.base },
        body: JSON.stringify({ image }),
      });
      const data = await res.json();
      if (!res.ok) {
        updateJob(job.id, { status: 'error', error: `${res.status}: ${JSON.stringify(data)}` });
      } else if (getJobStatus(data) !== 'completed') {
        updateJob(job.id, {
          status: 'error',
          error: data?.error || 'The model returned no result for this photo',
          result: data,
        });
      } else {
        updateJob(job.id, { status: 'done', result: data });
      }
      return;
    }

    // Jobs API — multipart upload + polling
    const formData = new FormData();
    formData.append('files', job.file);

    const res = await fetch('/api/create', {
      method: 'POST',
      headers: { 'x-bearer-token': tokenVal, 'x-api-base': api.base },
      body: formData,
    });

    const data = await res.json();

    if (!res.ok) {
      updateJob(job.id, { status: 'error', error: `${res.status}: ${JSON.stringify(data)}` });
      return;
    }

    const uid = extractUid(data);
    if (!uid) {
      updateJob(job.id, { status: 'error', error: `No UID in response: ${JSON.stringify(data)}` });
      return;
    }

    updateJob(job.id, { status: 'polling', uid });
    schedulePoll(job.id, uid, tokenVal, api.base);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!picked.length || submitting) return;

    unlockAudio();

    const api = APIS[apiIndex];
    const stamp = Date.now();
    const batch = picked.map((p, i) => ({
      id: `job_${stamp}_${i}`,
      file: p.file,
      preview: p.url,
      name: p.file.name,
    }));

    setJobs(prev => [
      ...batch.map(b => ({
        id: b.id,
        name: b.name,
        preview: b.preview,
        status: 'queued',
        uid: null,
        result: null,
        error: null,
        startTime: stamp,
        apiLabel: api.label,
      })),
      ...prev,
    ]);

    // Reset form immediately — the job cards now own the preview URLs.
    setPicked([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    setSubmitting(true);

    for (let i = 0; i < batch.length; i++) {
      setProgress({ done: i, total: batch.length });
      try {
        await dispatchJob(batch[i], api, token);
      } catch (err) {
        updateJob(batch[i].id, { status: 'error', error: err.message });
      }
    }

    setProgress(null);
    setSubmitting(false);
  }

  const submitLabel = submitting
    ? (progress ? `Submitting ${progress.done + 1} of ${progress.total}…` : 'Submitting…')
    : picked.length > 1 ? `Analyse ${picked.length} Photos` : 'Analyse My Smile';

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f7' }}>
      {/* Zero-width thumb so the handle lines up exactly with the clip edge. */}
      <style>{`
        .ba-range { -webkit-appearance: none; appearance: none; background: transparent; }
        .ba-range::-webkit-slider-thumb { -webkit-appearance: none; width: 1px; height: 100%; background: transparent; }
        .ba-range::-moz-range-thumb { width: 1px; height: 100%; border: none; background: transparent; }

        @keyframes ps-sweep   { 0% { transform: translateY(-100%); } 100% { transform: translateY(560%); } }
        @keyframes ps-ring    { 0% { transform: scale(0.75); opacity: 0.9; } 100% { transform: scale(1.5); opacity: 0; } }
        @keyframes ps-pop     { 0% { transform: scale(0); opacity: 0; } 60% { transform: scale(1.35); opacity: 1; } 100% { transform: scale(1); opacity: 0.95; } }
        @keyframes ps-drop    { 0% { transform: translateY(-55%) scale(0.9); opacity: 0; } 70% { transform: translateY(4%) scale(1.02); opacity: 1; } 85% { transform: translateY(-2%) scale(0.99); } 100% { transform: translateY(0) scale(1); opacity: 1; } }
        @keyframes ps-twinkle { 0%, 100% { transform: scale(0) rotate(0deg); opacity: 0; } 50% { transform: scale(1) rotate(90deg); opacity: 1; } }
        @keyframes ps-bracket { 0% { transform: scale(1.6); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes ps-shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }
        @keyframes ps-flash   { 0% { opacity: 0; } 15% { opacity: 0.85; } 100% { opacity: 0; } }
        @keyframes ps-shakeA { 0%,100% { transform: translate(0,0) } 15% { transform: translate(-5px,3px) } 35% { transform: translate(4px,-3px) } 55% { transform: translate(-3px,-2px) } 78% { transform: translate(2px,2px) } }
        @keyframes ps-shakeB { 0%,100% { transform: translate(0,0) } 15% { transform: translate(5px,-3px) } 35% { transform: translate(-4px,3px) } 55% { transform: translate(3px,2px) } 78% { transform: translate(-2px,-2px) } }
        @keyframes ps-glow    { 0%, 100% { opacity: 0.25; } 50% { opacity: 0.6; } }

        @media (prefers-reduced-motion: reduce) {
          .ps-fx, .ps-fx * { animation: none !important; transition: none !important; }
        }
      `}</style>

      {/* Header */}
      <div style={{
        background: BLUE,
        padding: '18px 20px 16px',
        color: '#fff',
        textAlign: 'center',
        position: 'sticky',
        top: 0,
        zIndex: 10,
        boxShadow: '0 2px 12px rgba(7,42,200,0.3)',
      }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>
          Perfect Smile
        </h1>
        <button
          type="button"
          onClick={toggleSound}
          aria-pressed={sound}
          aria-label={sound ? 'Mute reveal sound' : 'Unmute reveal sound'}
          title={sound ? 'Sound on' : 'Sound off'}
          style={{
            position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
            background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 8,
            color: '#fff', fontSize: 15, lineHeight: 1, padding: '7px 9px', cursor: 'pointer',
          }}
        >
          {sound ? '🔊' : '🔇'}
        </button>
      </div>

      <div style={{ maxWidth: 480, margin: '0 auto', padding: '16px' }}>
        {/* Submission form */}
        <div style={{
          background: '#fff',
          borderRadius: 16,
          boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
          padding: '20px',
          marginBottom: 20,
        }}>
          <form onSubmit={handleSubmit}>
            {/* API selector */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#777', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  API
                </label>
                {health && (
                  <span
                    title={health.state === 'ok'
                      ? `Service ready${health.gpu ? ` · ${health.gpu}` : ''}`
                      : health.state === 'down' ? `Service not ready: ${health.error}` : 'Checking service…'}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: HEALTH_COLORS[health.state] }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: HEALTH_COLORS[health.state] }} />
                    {health.state === 'ok' ? (health.gpu || 'Ready')
                      : health.state === 'down' ? 'Not ready' : 'Checking…'}
                  </span>
                )}
              </div>
              <select
                value={apiIndex}
                onChange={handleApiChange}
                style={{
                  width: '100%',
                  padding: '11px 12px',
                  border: '1.5px solid #e0e0e0',
                  borderRadius: 10,
                  fontSize: 14,
                  boxSizing: 'border-box',
                  outline: 'none',
                  background: '#fafafa',
                  color: '#222',
                  appearance: 'auto',
                }}
              >
                {APIS.map((api, i) => (
                  <option key={i} value={i}>{api.label}</option>
                ))}
              </select>
            </div>

            {/* Token */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#777', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Bearer Token
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showToken ? 'text' : 'password'}
                  value={token}
                  onChange={handleTokenChange}
                  placeholder="Paste your token…"
                  style={{
                    width: '100%',
                    padding: '11px 42px 11px 12px',
                    border: '1.5px solid #e0e0e0',
                    borderRadius: 10,
                    fontSize: 14,
                    boxSizing: 'border-box',
                    outline: 'none',
                    background: '#fafafa',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowToken(s => !s)}
                  style={{
                    position: 'absolute', right: 10, top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 16, color: '#aaa', padding: 4,
                  }}
                  aria-label="Toggle token visibility"
                >
                  {showToken ? '🙈' : '👁'}
                </button>
              </div>
            </div>

            {/* Photos: camera and library are separate inputs, because an input
                carrying `capture` is camera-only and hands back exactly one shot,
                which rules out `multiple` on that same element. */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#777', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Photos{picked.length ? ` · ${picked.length}` : ''}
                </span>
                {picked.length > 0 && (
                  <button
                    type="button"
                    onClick={clearPicked}
                    style={{ background: 'none', border: 'none', padding: 0, fontSize: 12, fontWeight: 600, color: '#999', cursor: 'pointer' }}
                  >
                    Clear
                  </button>
                )}
              </div>

              {picked.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                  {picked.map(p => (
                    <div key={p.id} style={{ position: 'relative', flexShrink: 0 }}>
                      <img src={p.url} alt="" style={{
                        width: 62, height: 62, objectFit: 'cover', borderRadius: 10,
                        border: `1.5px solid ${BLUE}`, display: 'block',
                      }} />
                      <button
                        type="button"
                        onClick={() => removePicked(p.id)}
                        aria-label={`Remove ${p.file.name}`}
                        style={{
                          position: 'absolute', top: -6, right: -6,
                          width: 22, height: 22, borderRadius: '50%',
                          background: '#fff', color: '#c0392b',
                          border: '1px solid #e6e6e6', boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
                          fontSize: 14, lineHeight: 1, fontWeight: 700,
                          cursor: 'pointer', padding: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  style={{
                    flex: 1, padding: '13px 10px',
                    border: `2px dashed ${picked.length ? BLUE : '#dde'}`,
                    borderRadius: 12, background: picked.length ? '#f0f4ff' : '#fafafa',
                    color: picked.length ? BLUE : '#666',
                    fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  📷 Take Photo
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    flex: 1, padding: '13px 10px',
                    border: `2px dashed ${picked.length ? BLUE : '#dde'}`,
                    borderRadius: 12, background: picked.length ? '#f0f4ff' : '#fafafa',
                    color: picked.length ? BLUE : '#666',
                    fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  🖼 Choose Photos
                </button>
              </div>
              <div style={{ fontSize: 11, color: '#aaa', marginTop: 6 }}>
                Add as many as you like — they submit together.
              </div>

              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleAddFiles}
                style={{ display: 'none' }}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleAddFiles}
                style={{ display: 'none' }}
              />
            </div>

            <button
              type="submit"
              disabled={!picked.length || submitting}
              style={{
                width: '100%',
                padding: '14px',
                background: (!picked.length || submitting) ? '#b0bfee' : BLUE,
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                fontSize: 16,
                fontWeight: 700,
                cursor: (!picked.length || submitting) ? 'not-allowed' : 'pointer',
                transition: 'background 0.2s',
              }}
            >
              {submitLabel}
            </button>
          </form>
        </div>

        {/* Jobs list */}
        {jobs.map(job => (
          <JobCard key={job.id} job={job} />
        ))}
      </div>
    </div>
  );
}
