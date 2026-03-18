export async function GET(request, { params }) {
  const { uid } = params;
  const token = request.headers.get('x-bearer-token') || process.env.BEARER_TOKEN;
  const apiBase = request.headers.get('x-api-base');

  if (!apiBase) {
    return Response.json({ error: 'No x-api-base header provided' }, { status: 400 });
  }

  try {
    const response = await fetch(`${apiBase}/perfectsmile/get/${uid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    return Response.json(data, { status: response.status });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
