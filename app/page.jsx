'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

const BLUE = '#072AC8';
const POLL_INTERVAL = 30_000;
const MAX_POLLS = 20;

const APIS = [
  { label: 'Jobs API (a065f828)', base: 'https://txp-prelive.smile2impress.com/api/a065f828-8dfa-455c-a63b-c8cd82b70840/v0.0.1' },
  { label: 'Perfectsmile API (f7ec0705)', base: 'https://txp-prelive.smile2impress.com/api/f7ec0705-84c3-4594-a598-d1e7a523ad8e/v1.0' },
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

function extractImageUrls(obj, found = []) {
  if (!obj || typeof obj !== 'object') return found;
  for (const val of Object.values(obj)) {
    if (typeof val === 'string' && /^https?:\/\/.+\.(jpg|jpeg|png|gif|webp|svg)/i.test(val)) {
      found.push(val);
    } else if (typeof val === 'object') {
      extractImageUrls(val, found);
    }
  }
  return found;
}

function getJobStatus(data) {
  const s = data?.status?.toLowerCase();
  if (s === 'failed') return 'failed';
  if (s === 'completed' || s === 'done' || s === 'success') return 'completed';
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

function JobCard({ job, token, onUpdate }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (job.status !== 'polling' && job.status !== 'uploading') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [job.status]);

  const resultImage = job.result?.result_image;
  const processingTime = job.result?.processing_time;
  const imageUrls = job.result && !resultImage ? extractImageUrls(job.result) : [];

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
        {/* Thumbnails */}
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {job.previews.map((src, i) => (
            <img key={i} src={src} alt="" style={{
              width: 48, height: 48, objectFit: 'cover', borderRadius: 8,
            }} />
          ))}
        </div>

        {/* Meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>
            {new Date(job.startTime).toLocaleTimeString()}
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
          </div>
        </div>
      </div>

      {/* Result */}
      {job.status === 'done' && (
        <div style={{ padding: '14px 16px' }}>
          {resultImage && (
            <img
              src={`data:image/jpeg;base64,${resultImage}`}
              alt="Result"
              style={{ width: '100%', borderRadius: 10, display: 'block', marginBottom: 12 }}
            />
          )}
          {imageUrls.length > 0 && (
            <div style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {imageUrls.map((url, i) => (
                <img key={i} src={url} alt={`Result ${i + 1}`} style={{
                  width: '100%', borderRadius: 10, display: 'block',
                }} />
              ))}
            </div>
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
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [jobs, setJobs] = useState([]);
  const pollTimers = useRef({});
  const fileInputRef = useRef(null);

  useEffect(() => {
    const savedIdx = localStorage.getItem('ps_api_index');
    const idx = savedIdx !== null ? Number(savedIdx) : 0;
    setApiIndex(idx);
    const savedToken = localStorage.getItem(`ps_bearer_token_${idx}`);
    setToken(savedToken ?? '');
    return () => {
      Object.values(pollTimers.current).forEach(clearTimeout);
    };
  }, []);

  function handleApiChange(e) {
    const idx = Number(e.target.value);
    setApiIndex(idx);
    localStorage.setItem('ps_api_index', idx);
    const savedToken = localStorage.getItem(`ps_bearer_token_${idx}`);
    const t = savedToken ?? '';
    setToken(t);
  }

  function handleTokenChange(e) {
    setToken(e.target.value);
    localStorage.setItem(`ps_bearer_token_${apiIndex}`, e.target.value);
  }

  function handleFileChange(e) {
    const f = e.target.files[0] || null;
    setFile(f);
    if (f) {
      const url = URL.createObjectURL(f);
      setPreview(url);
    } else {
      setPreview(null);
    }
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
        const jobStatus = getJobStatus(data);
        if (jobStatus === 'failed') {
          updateJob(jobId, { status: 'error', error: data?.message ?? data?.error ?? 'Job failed.', result: data });
          delete pollTimers.current[jobId];
        } else if (jobStatus === 'completed') {
          updateJob(jobId, { status: 'done', result: data });
          delete pollTimers.current[jobId];
        } else {
          schedulePoll(jobId, uid, tokenVal, apiBase, attempt + 1);
        }
      } catch {
        schedulePoll(jobId, uid, tokenVal, apiBase, attempt + 1);
      }
    }, POLL_INTERVAL);
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file || submitting) return;

    const jobId = `job_${Date.now()}`;
    const startTime = Date.now();
    const previews = preview ? [preview] : [];
    const apiBase = APIS[apiIndex].base;
    const apiLabel = APIS[apiIndex].label;

    setJobs(prev => [{
      id: jobId,
      previews,
      status: 'uploading',
      uid: null,
      result: null,
      error: null,
      startTime,
      apiLabel,
    }, ...prev]);

    // Reset form immediately
    setFile(null);
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setSubmitting(true);

    try {
      if (apiIndex === 1) {
        // Perfectsmile API — synchronous, JSON body with base64 image
        const image = await fileToBase64(file);
        const res = await fetch('/api/perfectsmile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-bearer-token': token },
          body: JSON.stringify({ image }),
        });
        const data = await res.json();
        if (!res.ok) {
          updateJob(jobId, { status: 'error', error: `${res.status}: ${JSON.stringify(data)}` });
        } else {
          updateJob(jobId, { status: 'done', result: data });
        }
      } else {
        // Jobs API — multipart upload + polling
        const formData = new FormData();
        formData.append('files', file);

        const res = await fetch('/api/create', {
          method: 'POST',
          headers: { 'x-bearer-token': token, 'x-api-base': apiBase },
          body: formData,
        });

        const data = await res.json();

        if (!res.ok) {
          updateJob(jobId, { status: 'error', error: `${res.status}: ${JSON.stringify(data)}` });
          setSubmitting(false);
          return;
        }

        const uid = extractUid(data);
        if (!uid) {
          updateJob(jobId, {
            status: 'error',
            error: `No UID in response: ${JSON.stringify(data)}`,
          });
          setSubmitting(false);
          return;
        }

        updateJob(jobId, { status: 'polling', uid });
        schedulePoll(jobId, uid, token, apiBase);
      }
    } catch (err) {
      updateJob(jobId, { status: 'error', error: err.message });
    }

    setSubmitting(false);
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f7' }}>
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
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#777', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                API
              </label>
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
                Photo
              </label>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                border: `2px dashed ${file ? BLUE : '#dde'}`,
                borderRadius: 12,
                padding: '14px',
                cursor: 'pointer',
                background: file ? '#f0f4ff' : '#fafafa',
                transition: 'all 0.2s',
              }}>
                {preview
                  ? <img src={preview} alt="" style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
                  : <span style={{ fontSize: 32, flexShrink: 0 }}>📸</span>
                }
                <span style={{ fontSize: 14, color: file ? BLUE : '#888', fontWeight: file ? 600 : 400 }}>
                  {file ? file.name : 'Tap to choose or take a photo'}
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={!file || submitting}
              style={{
                width: '100%',
                padding: '14px',
                background: (!file || submitting) ? '#b0bfee' : BLUE,
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                fontSize: 16,
                fontWeight: 700,
                cursor: (!file || submitting) ? 'not-allowed' : 'pointer',
                transition: 'background 0.2s',
              }}
            >
              {submitting ? 'Submitting…' : 'Analyse My Smile'}
            </button>
          </form>
        </div>

        {/* Jobs list */}
        {jobs.map(job => (
          <JobCard key={job.id} job={job} token={token} onUpdate={updateJob} />
        ))}
      </div>
    </div>
  );
}
