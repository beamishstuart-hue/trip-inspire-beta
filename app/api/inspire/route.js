// app/api/inspire/route.ts  (use this exact file path if you’re on the App Router)
export const runtime = 'nodejs';

import OpenAI from 'openai';

// ---- helper: build the prompt safely (this was missing before) ----
function buildItineraryPrompt(input: {
  destination?: string;
  days?: number;
  prefs?: string[] | string;
}) {
  const destination =
    (input?.destination || 'your chosen city').toString().trim();
  const days = Number(input?.days) > 0 ? Number(input?.days) : 3;

  // allow prefs as string or array
  let prefsText = '';
  if (Array.isArray(input?.prefs) && input!.prefs.length) {
    prefsText = `Preferences: ${input!.prefs.join(', ')}.`;
  } else if (typeof input?.prefs === 'string' && input.prefs.trim()) {
    prefsText = `Preferences: ${input.prefs.trim()}.`;
  }

  return `
Create a ${days}-day, first-timer-friendly itinerary for ${destination}.
${prefsText}
Return ONLY valid JSON with this shape:
{
  "destination": "${destination}",
  "days": [
    { "title": "Day 1", "items": ["...", "...", "..."] },
    { "title": "Day 2", "items": ["...", "...", "..."] }
    // one object per day, 4–6 items each
  ]
}
`.trim();
}

// ---- POST handler ----
export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.error('Missing OPENAI_API_KEY');
      return new Response(
        JSON.stringify({ error: 'Server misconfigured: missing OpenAI key' }),
        { status: 500 }
      );
    }

    // read body safely
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const prompt = buildItineraryPrompt({
      destination: body?.destination,
      days: body?.days,
      prefs: body?.prefs,
    });

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0.7,
      messages: [
        { role: 'system', content: 'You return concise JSON only.' },
        { role: 'user', content: prompt },
      ],
    });

    const text = resp.choices?.[0]?.message?.content || '{}';

    // try to parse; if not JSON, send raw so UI can show something
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    return Response.json({ ok: true, itinerary: json });
  } catch (err: any) {
    console.error('API ERROR:', {
      message: err?.message,
      stack: err?.stack,
    });
    const msg =
      err?.response?.data?.error?.message ||
      err?.message ||
      'Unknown server error';
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}

// optional: make GET explicit
export function GET() {
  return new Response('Method Not Allowed', { status: 405 });
}
