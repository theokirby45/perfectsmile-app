'use client';

import { useState, useEffect, useRef } from 'react';

const BLUE = '#072AC8';

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

function isPending(data) {
  const str = JSON.stringify(data).toLowerCase();
  return str.includes('pending') || str.includes('processing') || str.includes('queued');
}

function extractUid(data) {
  return data?.uid ?? data?.id ?? data?.job_id ?? data?.task_id ?? null;
}

export default function Home() {
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | submitting | polling | done | error
  const [message, setMessage] = useState('');
  const [result, setResult] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    const saved = localStorage.getItem('ps_bearer_token');
    if (saved) setToken(saved);
  }, []);

  function handleTokenChange(e) {
    setToken(e.target.value);
    localStorage.setItem('ps_bearer_token', e.target.value);
  }

  function handleFileChange(e) {
    setFile(e.target.files[0] || null);
  }

  function reset() {
    setFile(null);
    setStatus('idle');
    setMessage('');
    setResult(null);
    if (pollRef.current) clearInterval(pollRef.current);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file) return;

    setStatus('submitting');
    setMessage('Uploading image…');

    try {
      const formData = new FormData();
      formData.append('image', file);

      const createRes = await fetch('/api/create', {
        method: 'POST',
        headers: token ? { 'x-bearer-token': token } : {},
        body: formData,
      });

      const createData = await createRes.json();

      if (!createRes.ok) {
        setStatus('error');
        setMessage(`Error ${createRes.status}: ${JSON.stringify(createData)}`);
        return;
      }

      const uid = extractUid(createData);
      if (!uid) {
        setStatus('error');
        setMessage(`Could not find UID in response: ${JSON.stringify(createData)}`);
        return;
      }

      setStatus('polling');
      setMessage(`Job created (uid: ${uid}). Waiting for result…`);

      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts++;
        if (attempts > 60) {
          clearInterval(pollRef.current);
          setStatus('error');
          setMessage('Timed out waiting for result after 2 minutes.');
          return;
        }

        try {
          const getRes = await fetch(`/api/get/${uid}`, {
            headers: token ? { 'x-bearer-token': token } : {},
          });
          const getData = await getRes.json();

          if (!isPending(getData)) {
            clearInterval(pollRef.current);
            setResult(getData);
            setStatus('done');
            setMessage('');
          } else {
            setMessage(`Polling… (attempt ${attempts}/60)`);
          }
        } catch {
          // keep polling on transient errors
        }
      }, 2000);
    } catch (err) {
      setStatus('error');
      setMessage(`Unexpected error: ${err.message}`);
    }
  }

  const imageUrls = result ? extractImageUrls(result) : [];

  return (
    <div style={{
      minHeight: '100vh',
      background: `linear-gradient(135deg, ${BLUE} 0%, #0a3de0 50%, #1a5aff 100%)`,
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      padding: '16px',
      boxSizing: 'border-box',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 480,
        background: '#fff',
        borderRadius: 20,
        boxShadow: '0 8px 32px rgba(7,42,200,0.25)',
        overflow: 'hidden',
        marginTop: 16,
      }}>
        {/* Header */}
        <div style={{
          background: BLUE,
          padding: '20px 24px',
          color: '#fff',
          textAlign: 'center',
        }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.5px' }}>
            Perfect Smile
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.8 }}>AI Smile Analysis</p>
        </div>

        {/* Body */}
        <div style={{ padding: '24px' }}>
          {status === 'done' ? (
            <div>
              {imageUrls.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <p style={{ fontWeight: 600, color: '#333', marginTop: 0 }}>Result Images</p>
                  {imageUrls.map((url, i) => (
                    <img
                      key={i}
                      src={url}
                      alt={`Result ${i + 1}`}
                      style={{ width: '100%', borderRadius: 12, marginBottom: 12, display: 'block' }}
                    />
                  ))}
                </div>
              )}
              <p style={{ fontWeight: 600, color: '#333', marginBottom: 8 }}>Raw Response</p>
              <pre style={{
                background: '#f4f6fb',
                borderRadius: 10,
                padding: 14,
                fontSize: 11,
                overflowX: 'auto',
                overflowY: 'auto',
                maxHeight: 320,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                color: '#222',
                margin: 0,
              }}>
                {JSON.stringify(result, null, 2)}
              </pre>
              <button
                onClick={reset}
                style={{
                  marginTop: 20,
                  width: '100%',
                  padding: '14px',
                  background: '#fff',
                  color: BLUE,
                  border: `2px solid ${BLUE}`,
                  borderRadius: 12,
                  fontSize: 16,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Start Over
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              {/* Token field */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 6 }}>
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
                      padding: '12px 44px 12px 14px',
                      border: '1.5px solid #dde',
                      borderRadius: 10,
                      fontSize: 14,
                      boxSizing: 'border-box',
                      outline: 'none',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(s => !s)}
                    style={{
                      position: 'absolute',
                      right: 10,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 18,
                      color: '#888',
                      padding: 4,
                    }}
                    aria-label="Toggle token visibility"
                  >
                    {showToken ? '🙈' : '👁'}
                  </button>
                </div>
                <p style={{ margin: '4px 0 0', fontSize: 11, color: '#aaa' }}>Saved locally in your browser</p>
              </div>

              {/* File upload */}
              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 6 }}>
                  Smile Photo
                </label>
                <label style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  border: `2px dashed ${file ? BLUE : '#dde'}`,
                  borderRadius: 12,
                  padding: '28px 16px',
                  cursor: 'pointer',
                  background: file ? '#f0f4ff' : '#fafafa',
                  transition: 'all 0.2s',
                }}>
                  <span style={{ fontSize: 36 }}>{file ? '📷' : '📸'}</span>
                  <span style={{ fontSize: 14, color: file ? BLUE : '#888', fontWeight: file ? 600 : 400, textAlign: 'center' }}>
                    {file ? file.name : 'Tap to choose or take a photo'}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>

              {/* Status message */}
              {(status === 'submitting' || status === 'polling') && (
                <div style={{
                  marginBottom: 16,
                  padding: '12px 14px',
                  background: '#f0f4ff',
                  borderRadius: 10,
                  fontSize: 13,
                  color: BLUE,
                  textAlign: 'center',
                }}>
                  <span style={{ marginRight: 6 }}>⏳</span>{message}
                </div>
              )}
              {status === 'error' && (
                <div style={{
                  marginBottom: 16,
                  padding: '12px 14px',
                  background: '#fff0f0',
                  borderRadius: 10,
                  fontSize: 13,
                  color: '#c0392b',
                }}>
                  <strong>Error:</strong> {message}
                </div>
              )}

              <button
                type="submit"
                disabled={!file || status === 'submitting' || status === 'polling'}
                style={{
                  width: '100%',
                  padding: '15px',
                  background: (!file || status === 'submitting' || status === 'polling') ? '#b0bfee' : BLUE,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 12,
                  fontSize: 16,
                  fontWeight: 700,
                  cursor: (!file || status === 'submitting' || status === 'polling') ? 'not-allowed' : 'pointer',
                  transition: 'background 0.2s',
                  letterSpacing: '0.3px',
                }}
              >
                {status === 'submitting' ? 'Uploading…' : status === 'polling' ? 'Analysing…' : 'Analyse My Smile'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
