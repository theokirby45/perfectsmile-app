const ALLOWED_BASES = [
  'https://txp-prelive.smile2impress.com/api/f7ec0705-84c3-4594-a598-d1e7a523ad8e/v1.0',
];

// The reference client allows 600s per inference — model load + generation is slow.
const TIMEOUT_MS = 600_000;

export async function POST(request) {
  const token = request.headers.get('x-bearer-token');
  const apiBase = request.headers.get('x-api-base');

  if (!token) {
    return Response.json({ error: 'No bearer token provided' }, { status: 401 });
  }
  if (!apiBase || !ALLOWED_BASES.includes(apiBase)) {
    return Response.json({ error: 'Invalid or missing x-api-base' }, { status: 400 });
  }

  try {
    const { image } = await request.json();

    const response = await fetch(`${apiBase}/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    return Response.json(data, { status: response.status });
  } catch (err) {
    const msg = err.name === 'TimeoutError'
      ? `The model did not respond within ${TIMEOUT_MS / 1000}s.`
      : err.message;
    return Response.json({ error: msg }, { status: 504 });
  }
}
