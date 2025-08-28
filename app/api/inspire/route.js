export const dynamic = 'force-dynamic';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const PRIMARY = 'gpt-4o-mini';
const FALLBACK = 'gpt-4o';

/* -------------------- Helpers -------------------- */

const FILLERS = [
  /optional afternoon stroll/gi,
  /relaxing dinner/gi,
  /resort time/gi,
  /\bfree time\b/gi
];

const STRIP_HINTS = (s = "") =>
  s.replace(/\s*\(add a named street\/venue\/landmark\)\s*/gi, '')
   .replace(/\s*— plus a contrasting nearby activity\.?\s*/gi, '')
   .replace(/\s+/g, ' ')
   .trim();

function cleanItin(days = []) {
  const seen = new Set();
  const used = new Set();
  const verbs = ['wander','sample','trace','duck into','people-watch','bar-hop','graze','meander','poke around','soak up'];

  const rep = s => FILLERS.reduce((t, re) => t.replace(re, ''), (s || '')).trim();
  const verb = s => {
    const v = verbs.find(x => !used.has(x)) || 'explore';
    used.add(v);
    return (s || '').replace(/\b(stroll|relax|enjoy|explore)\b/i, v);
  };
  const dedupe = d => {
    ['morning','afternoon','evening'].forEach(k => {
      const key = k + ':' + (d[k] || '').toLowerCase().slice(0, 80);
      if (seen.has(key)) d[k] += ' — choose a contrasting nearby alternative';
      seen.add(key);
    });
    return d;
  };

  return days.map(d => dedupe({
    morning: STRIP_HINTS(verb(rep(d.morning))),
    afternoon: STRIP_HINTS(verb(rep(d.afternoon))),
    evening: STRIP_HINTS(verb(rep(d.evening))),
  }));
}

function daysWanted(duration) {
  return duration === 'weekend-2d' ? 2
    : duration === 'mini-4d' ? 4
    : duration === 'two-weeks' ? 14
    : 7; // week-7d default
}

function sample() {
  return {
    top3: [
      {
        city: "Lisbon",
        country: "Portugal",
        summary: "Compact hills, viewpoints and pastries; easy short-haul from the UK.",
        days: cleanItin([
          { morning:"Pastéis de Belém (Rua de Belém 84–92)", afternoon:"MAAT river walk via Avenida Brasília", evening:"Bairro Alto petiscos on Rua da Atalaia" },
          { morning:"Tram 28 to Graça + Miradouro da Senhora do Monte", afternoon:"Tile studio near Largo do Intendente", evening:"Fado at Clube de Fado, Alfama" },
          { morning:"Cascais boardwalk from Praia da Rainha", afternoon:"Boca do Inferno viewpoint", evening:"Sunset at Miradouro de Santa Catarina" },
          { morning:"LX Factory (Rua Rodrigues de Faria)", afternoon:"Time Out Market tasting counters", evening:"Ribeira waterfront stroll" }
        ])
      }
    ]
  };
}

/* -------------------- OpenAI -------------------- */

async function callOpenAI(messages, model) {
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0.6,
      max_tokens: 1600,
      messages
    })
  });
  if (!res.ok) throw new Error(`OpenAI ${model} ${res.status}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

function tryParseJSON(text) {
  try { return JSON.parse(text); } catch {}
  const inline = text.match(/\{[\s\S]*\}/);
  if (inline) { try { return JSON.parse(inline[0]); } catch {} }
  const fenced = text.match(/```json([\s\S]*?)```/i) || text.match(/```([\s\S]*?)```/);
  if (fenced?.[1]) { try { return JSON.parse(fenced[1]); } catch {} }
  return null;
}

/* -------------------- Prompt builders -------------------- */

function buildMainPrompt(origin, p, wantDays) {
  const hours = Math.min(Math.max(Number(p.flight_time_hours) || 8, 1), 20);
  const groupTxt = p.group==='family'?'Family with kids'
    : p.group==='friends'?'Group of friends'
    : p.group==='couple'?'Couple'
    : 'Solo';

  const styleMap = {
    adventure:'Adventure & outdoor activities',
    relaxation:'Relaxation & beach',
    cultural:'Cultural & historical',
    luxury:'Luxury & fine dining',
    budget:'Budget & backpacking'
  };
  const styleTxt = styleMap[p.style] || 'Mixed';

  const interestsTxt = Array.isArray(p.interests) && p.interests.length
    ? p.interests.join(', ')
    : 'surprise me';

  const seasonTxt = p.season==='flexible' ? 'Flexible timing'
    : p.season==='spring' ? 'Spring (Mar–May)'
    : p.season==='summer' ? 'Summer (Jun–Aug)'
    : p.season==='autumn' ? 'Autumn (Sep–Nov)'
    : 'Winter (Dec–Feb)';

  const paceTxt = p.pace==='total' ? 'Total relaxation'
    : p.pace==='relaxed' ? 'A few relaxing activities'
    : p.pace==='daily' ? 'Different activity every day'
    : 'Packed schedule';

  const rules =
`HARD RULES (CRITICAL):
- Produce EXACTLY ${wantDays} days per destination. No placeholders like "TBD".
- No day repeats the same morning/afternoon/evening pattern across days.
- EACH day contains 1–2 named anchors (street/venue/landmark) and 1 micro-detail (dish, view, material, sound).
- Add 1 local quirk per trip (etiquette, transit trick, closing hour).
- Include constraints: common opening hours when widely known, realistic travel times, and one rain fallback.
- Avoid filler phrases: "optional stroll", "relaxing dinner", "free time at resort".
- Vary verbs; don’t reuse stroll/relax/enjoy/explore.
- OUTPUT JSON ONLY in this exact shape:
{
  "top3": [
    {
      "city": "City",
      "country": "Country",
      "summary": "1–2 lines why this fits",
      "days": [
        { "morning": "...", "afternoon": "...", "evening": "..." }
      ]
    }
  ]
}`;

  return [
    `Origin: ${origin}. Non-stop flight time ≤ ~${hours} hours from origin.`,
    `Trip length: EXACTLY ${wantDays} days.`,
    `Group: ${groupTxt}.`,
    `Style: ${styleTxt}.`,
    `User interests: ${interestsTxt}.`,
    `Season: ${seasonTxt}.`,
    `Preferred itinerary pace: ${paceTxt}.`,
    rules
  ].join('\n');
}

function buildRepairPrompt(city, country, haveDays, needDays) {
  // Ask ONLY for the missing days, preserving variety & anchors.
  return [
    `Destination: ${city}${country ? ', ' + country : ''}`,
    `You previously returned ${haveDays} days. I require EXACTLY ${haveDays + needDays} days total.`,
    `Return ONLY the MISSING ${needDays} days in JSON array form, no prose:`,
    `[{ "morning":"...", "afternoon":"...", "evening":"..." }]`,
    `Rules:`,
    `- No placeholders like "TBD".`,
    `- Include named anchors (streets/venues/landmarks) and a micro-detail per day.`,
    `- Avoid filler phrases and vary verbs.`,
  ].join('\n');
}

/* -------------------- Core generation -------------------- */

async function generate(body) {
  // Always return something, even without a key:
  if (!process.env.OPENAI_API_KEY) return sample();

  const origin = body?.origin || 'LHR';
  const p = body?.preferences || {};
  const want = daysWanted(p.duration);

  const system = { role: 'system', content: 'You are Trip Inspire. Provide concrete, place-anchored itineraries with varied days.' };
  const user   = { role: 'user',   content: buildMainPrompt(origin, p, want) };

  // 1) Main call
  let content;
  try { content = await callOpenAI([system, user], PRIMARY); }
  catch { content = await callOpenAI([system, user], FALLBACK); }

  const parsed = tryParseJSON(content);
  if (!parsed || !Array.isArray(parsed.top3) || parsed.top3.length === 0) {
    return sample();
  }

  // 2) Normalize each destination; if too few days, do a repair call to fill the gap
  const normalized = [];
  for (const trip of parsed.top3.slice(0, 3)) {
    const city = STRIP_HINTS(trip.city || '');
    const country = STRIP_HINTS(trip.country || '');
    const summary = STRIP_HINTS(trip.summary || '');

    let days = Array.isArray(trip.days) ? trip.days.slice(0, want) : [];

    if (days.length < want) {
      const need = want - days.length;
      try {
        const repairUser = { role: 'user', content: buildRepairPrompt(city || 'Destination', country || '', days.length, need) };
        const repaired = await callOpenAI([system, repairUser], PRIMARY).catch(async () => {
          return await callOpenAI([system, repairUser], FALLBACK);
        });
        const arr = tryParseJSON(repaired);
        if (Array.isArray(arr)) {
          days = [...days, ...arr].slice(0, want);
        }
      } catch {
        // If repair fails, we'll pad below.
      }
    }

    // Final safety: pad with simple but specific-sounding items (avoid "TBD")
    while (days.length < want) {
      days.push({
        morning: "Local market visit (name the market) and coffee on a pedestrian street",
        afternoon: "Neighborhood walk with a named viewpoint or museum (add the venue name)",
        evening: "Dinner at a typical spot (name one) and a sunset viewpoint (name it)"
      });
    }

    normalized.push({
      city,
      country,
      summary,
      days: cleanItin(days)
    });
  }

  return { top3: normalized };
}

/* -------------------- Route handlers -------------------- */

export async function GET() {
  // Default preview = 4-day mini break so the endpoint is demonstrably working
  const data = await generate({ preferences: { duration: 'mini-4d' } });
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const data = await generate(body);
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
