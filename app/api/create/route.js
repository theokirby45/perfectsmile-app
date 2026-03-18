const API_URL =
  'https://txp-prelive.smile2impress.com/api/a065f828-8dfa-455c-a63b-c8cd82b70840/v0.0.1/perfectsmile/create';

export async function POST(request) {
  const token =
    request.headers.get('x-bearer-token') || process.env.BEARER_TOKEN;

  const formData = await request.formData();

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  const data = await response.json();
  return Response.json(data, { status: response.status });
}
