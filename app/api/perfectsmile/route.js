const ALLOWED_BASES = [
  'https://txp-prelive.smile2impress.com/api/f7ec0705-84c3-4594-a598-d1e7a523ad8e/v1.0',
];

export async function POST(request) {
  const token = request.headers.get('x-bearer-token');
  const apiBase = request.headers.get('x-api-base');

  if (!token) {
    return Response.json({ error: 'No bearer token provided' }, { status: 401 });
  }
  if (!apiBase || !ALLOWED_BASES.includes(apiBase)) {
    return Response.json({ error: 'Invalid or missing x-api-base' }, { status: 400 });
  }

  const { image } = await request.json();

  const response = await fetch(`${apiBase}/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image }),
  });

  return Response.json(await response.json(), { status: response.status });
}
