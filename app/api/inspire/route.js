// app/api/inspire/route.js
export const runtime = 'nodejs';

import OpenAI from 'openai';

// ---- helper that was missing before ----
function buildItineraryPrompt(input = {}) {
  const destination = String(input.destination || 'your chosen city').trim();
  const daysNum = Number(input.days) > 0 ? Number(input.days) : 3;

  let prefsText = '';
  if (Array.isArray(input.prefs) && input.prefs.length) {
    prefsText = `Preferences: ${input.prefs.join(', ')}.`;
  } else if (typeof input.prefs === 'string' && input.prefs.trim()) {
    prefsText = `Preferences: ${input.prefs.trim()}.`;
  }

  return `
Create a ${daysNum}-day, first-timer-friendly itinerary for ${destination}.
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

export async function POST(req) {
  // --- diagnostic stub: proves which code Vercel is running ---
  console.log('[inspire] ROUTE_VERSION=v1-stub');
  let body = {};
  try { body = await req.json(); } catch {}
  return Response.json({
    ok: true,
    version: 'v1-stub',
    echo: body || null
  });
}

    // read JSON body safely
    let body = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const prompt = buildItineraryPrompt({
      destination: body.destination,
      days: body.days,
      prefs: body.prefs,
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

    const text = resp?.choices?.[0]?.message?.content || '{}';
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    return Response.json({ ok: true, itinerary: json });
  } catch (err) {
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

export function GET() {
  return new Response('Method Not Allowed', { status: 405 });
}
