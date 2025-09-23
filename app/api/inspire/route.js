// app/api/inspire/route.js
export const runtime = 'nodejs';

export async function POST(req) {
  // Diagnostic stub to verify routing/build. No external imports.
  let body = {};
  try { body = await req.json(); } catch (e) {}

  return new Response(
    JSON.stringify({ ok: true, version: 'stub-ok', echo: body }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

export function GET() {
  return new Response('Method Not Allowed', { status: 405 });
}
