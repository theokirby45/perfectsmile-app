const ALLOWED_BASES = [
  'https://txp-prelive.smile2impress.com/api/f7ec0705-84c3-4594-a598-d1e7a523ad8e/v1.0',
];

export async function GET(request) {
  const apiBase = request.nextUrl.searchParams.get('apiBase');

  if (!apiBase || !ALLOWED_BASES.includes(apiBase)) {
    return Response.json({ error: 'Invalid or missing apiBase' }, { status: 400 });
  }

  try {
    // The reference client hits /health unauthenticated before running inference.
    const response = await fetch(`${apiBase}/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    return Response.json(data, { status: response.status });
  } catch (err) {
    const msg = err.name === 'TimeoutError' ? 'Health check timed out.' : err.message;
    return Response.json({ status: 'unreachable', error: msg }, { status: 503 });
  }
}
