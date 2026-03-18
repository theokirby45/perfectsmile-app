const API_BASE =
  'https://txp-prelive.smile2impress.com/api/a065f828-8dfa-455c-a63b-c8cd82b70840/v0.0.1/perfectsmile';

export async function GET(request, { params }) {
  const { uid } = params;
  const token =
    request.headers.get('x-bearer-token') || process.env.BEARER_TOKEN;

  const response = await fetch(`${API_BASE}/get/${uid}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();
  return Response.json(data, { status: response.status });
}
