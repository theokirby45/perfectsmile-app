export async function POST(request) {
  const token = request.headers.get('x-bearer-token');
  const { image } = await request.json();

  const response = await fetch(
    'https://txp-prelive.smile2impress.com/api/f7ec0705-84c3-4594-a598-d1e7a523ad8e/v1.0/',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image }),
    }
  );

  return Response.json(await response.json(), { status: response.status });
}
