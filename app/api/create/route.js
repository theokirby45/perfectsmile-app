export async function POST(request) {
  const token = request.headers.get('x-bearer-token') || process.env.BEARER_TOKEN;
  const apiBase = request.headers.get('x-api-base');

  if (!token) {
    return Response.json({ error: 'No bearer token provided' }, { status: 401 });
  }
  if (!apiBase) {
    return Response.json({ error: 'No x-api-base header provided' }, { status: 400 });
  }

  try {
    const incomingForm = await request.formData();

    // Rebuild FormData so fetch serialises it correctly
    const outgoingForm = new FormData();
    for (const [key, value] of incomingForm.entries()) {
      outgoingForm.append(key, value);
    }

    const response = await fetch(`${apiBase}/perfectsmile/create`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: outgoingForm,
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    return Response.json(data, { status: response.status });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
