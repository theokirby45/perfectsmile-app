'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

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
  const [pos, setPos] = useState(50);

  return (
    <div style={{
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
        onChange={e => setPos(Number(e.target.value))}
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

function JobCard({ job }) {
  const [, setNow] = useState(Date.now());

  const inFlight = job.status === 'polling' || job.status === 'uploading' || job.status === 'queued';

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

      {/* Result */}
      {job.status === 'done' && (
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
  const pollTimers = useRef({});
  const fileInputRef = useRef(null);

  useEffect(() => {
    const savedIdx = localStorage.getItem('ps_api_index');
    const idx = savedIdx !== null ? Number(savedIdx) : 0;
    setApiIndex(idx);
    const savedToken = localStorage.getItem(`ps_bearer_token_${idx}`);
    setToken(savedToken ?? APIS[idx]?.token ?? '');
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

  function handleFileChange(e) {
    // Previews not yet submitted are ours to release; once a batch is submitted
    // its job cards own the object URLs for the rest of the session.
    picked.forEach(p => URL.revokeObjectURL(p.url));
    const files = Array.from(e.target.files || []);
    setPicked(files.map(file => ({ file, url: URL.createObjectURL(file) })));
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

            {/* File upload */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#777', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Photos
              </label>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                border: `2px dashed ${picked.length ? BLUE : '#dde'}`,
                borderRadius: 12,
                padding: '14px',
                cursor: 'pointer',
                background: picked.length ? '#f0f4ff' : '#fafafa',
                transition: 'all 0.2s',
              }}>
                {picked.length ? (
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {picked.slice(0, 3).map((p, i) => (
                      <img key={i} src={p.url} alt="" style={{
                        width: 52, height: 52, objectFit: 'cover', borderRadius: 8,
                      }} />
                    ))}
                    {picked.length > 3 && (
                      <div style={{
                        width: 52, height: 52, borderRadius: 8,
                        background: '#e2e8ff', color: BLUE,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 700,
                      }}>+{picked.length - 3}</div>
                    )}
                  </div>
                ) : (
                  <span style={{ fontSize: 32, flexShrink: 0 }}>📸</span>
                )}
                <span style={{ fontSize: 14, color: picked.length ? BLUE : '#888', fontWeight: picked.length ? 600 : 400 }}>
                  {picked.length
                    ? `${picked.length} photo${picked.length > 1 ? 's' : ''} selected`
                    : 'Tap to choose or take photos'}
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
              </label>
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
