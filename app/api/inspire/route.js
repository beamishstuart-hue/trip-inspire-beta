export const dynamic = 'force-dynamic';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const PRIMARY = 'gpt-4o-mini';
const FALLBACK = 'gpt-4o';

/* ---------- Helpers ---------- */

function sample() {
  return {
    top3: [
      {
        city: "Lisbon",
        country: "Portugal",
        summary: "Compact hills, viewpoints, pastry culture; easy short-haul from the UK.",
        days: [
          { morning:"Pastéis de Belém (Rua de Belém 84–92)", afternoon:"MAAT riverside walk via Avenida Brasília", evening:"Bairro Alto petiscos on Rua da Atalaia" },
          { morning:"Tram 28 to Graça + Miradouro da Senhora do Monte", afternoon:"Tile studio near Largo do Intendente", evening:"Fado at Clube de Fado, Alfama" },
          { morning:"Cascais boardwalk from Praia da Rainha", afternoon:"Boca do Inferno viewpoint", evening:"Sunset at Miradouro de Santa Catarina" },
          { morning:"LX Factory (Rua Rodrigues de Faria)", afternoon:"Time Out Market tasting counters", evening:"Ribeira waterfront stroll" }
        ]
      }
    ]
  };
}

const FILLERS = [/optional afternoon stroll/i, /relaxing dinner/i, /resort time/i, /\bfree time\b/i];

const STRIP = (s="") => s
  .replace(/\s*\(add a named street\/venue\/landmark\)\s*/gi, '')
  .replace(/\s*— plus a contrasting nearby activity\.?\s*/gi, '')
  .replace(/\s+/g, ' ')
  .trim();

function cleanItin(days=[]) {
  const seen = new Set(), used = new Set();
  const verbs = ['wander','sample','trace','duck into','people-watch','bar-hop','graze','meander','poke around','soak up'];
  const rep = s => FILLERS.reduce((t, re) => t.replace(re, ''), s || '').trim();
  const verb = s => { const v = verbs.find(x => !used.has(x)) || 'explore'; used.add(v); return (s||'').replace(/\b(stroll|relax|enjoy|explore)\b/i, v); };
  const dedu = d => { ['morning','afternoon','evening'].forEach(k => { const key = k+':'+(d[k]||'').toLowerCase().slice(0,60); if (seen.has(key)) d[k] += ''; seen.add(key); }); return d; };
  return days.map(d => dedu({ morning: STRIP(verb(rep(d.morning))), afternoon: STRIP(verb(rep(d.afternoon))), evening: STRIP(verb(rep(d.evening))) }));
}

function daysWanted(duration) {
  return duration==='weekend-2d' ? 2 : duration==='mini-4d' ? 4 : duration==='two-weeks' ? 14 : 7;
}

/* ---------- Prompt builder from YOUR 7 fields ---------- */
function buildPrompt(origin, p) {
  const hours = Math.min(Math.max(Number(p.flight_time_hours)||8, 1), 20);
  const wantDays = daysWanted(p.duration);
  const groupTxt = p.group==='family'?'Family with kids':p.group==='friends'?'Group of friends':p.group==='couple'?'Couple':'Solo';
  const styleMap = { adventure:'Adventure & outdoor activities', relaxation:'Relaxation & beach', cultural:'Cultural & historical', luxury:'Luxury & fine dining', budget:'Budget & backpacking' };
  const styleTxt = styleMap[p.style] || 'Mixed';
  const interestsTxt = Array.isArray(p.interests)&&p.interests.length ? p.interests.join(', ') : 'surprise me';
  const seasonTxt = p.season==='flexible' ? 'Flexible timing' :
    p.season==='spring' ? 'Spring (Mar–May)' :
    p.season==='summer' ? 'Summer (Jun–Aug)' :
    p.season==='autumn' ? 'Autumn (Sep–Nov)' : 'Winter (Dec–Feb)';
  const paceTxt = p.pace==='total' ? 'Total relaxation' : p.pace==='relaxed' ? 'A few relaxing activities' : p.pace==='daily' ? 'Different activity every day' : 'Packed schedule';

  const rules =
`You must produce exact-day itineraries with VARIETY.
HARD RULES:
- No day may repeat the same morning/afternoon/evening pattern across days.
- Each day must include 1–2 place-specific anchors (named spots, streets, venues) and 1 micro-detail (dish, view, material, sound).
- Insert 1 local quirk per trip (etiquette, transit trick, closing hour).
- Include constraints: common opening hours when widely known, travel time sanity, and one rain fallback.
- Avoid filler: “optional stroll”, “relaxing dinner”, “free time at resort”.
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
}
- The number of days MUST be exactly ${wantDays}.`;

  return [
    `Origin: ${origin}.`,
    `Non-stop flight time must be ≤ ~${hours} hours from origin.`,
    `Trip length: EXACTLY ${wantDays} days.`,
    `Group: ${groupTxt}.`,
    `Style: ${styleTxt}.`,
    `User interests: ${interestsTxt}.`,
    `Season: ${seasonTxt}.`,
    `Preferred itinerary pace: ${paceTxt}.`,
    rules
  ].join('\n');
}

async function callOpenAI(messages, model) {
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0.6, max_tokens: 1400, messages })
  });
  if (!res.ok) throw new Error(`OpenAI ${model} ${res.status}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}
function tryParse(t) {
  try { return JSON.parse(t); } catch {}
  const a = t.match(/\{[\s\S]*\}/); if (a) { try { return JSON.parse(a[0]); } catch {} }
  const b = t.match(/```json([\s\S]*?)```/i) || t.match(/```([\s\S]*?)```/); if (b?.[1]) { try { return JSON.parse(b[1]); } catch {} }
  return null;
}

async function generate(body) {
  if (!process.env.OPENAI_API_KEY) return sample();

  const origin = body?.origin || 'LHR';
  const p = body?.preferences || {};
  const want = daysWanted(p.duration);
  const prompt = buildPrompt(origin, p);

  const sys = { role: 'system', content: 'You are Trip Inspire. Provide concrete, place-anchored itineraries with varied days.' };
  const usr = { role: 'user', content: prompt };

  let content;
  try { content = await callOpenAI([sys, usr], PRIMARY); }
  catch { content = await callOpenAI([sys, usr], FALLBACK); }

  const parsed = tryParse(content);
  if (!parsed || !Array.isArray(parsed.top3)) return sample();

  const top3 = parsed.top3.map(trip => {
    const raw = Array.isArray(trip.days) ? trip.days.slice(0, want) : [];
    while (raw.length < want) raw.push({ morning:'TBD', afternoon:'TBD', evening:'TBD' });
    return {
      city: STRIP(trip.city || ''),
      country: STRIP(trip.country || ''),
      summary: STRIP(trip.summary || ''),
      days: cleanItin(raw)
    };
  });

  return { top3 };
}

/* ---------- Route handlers ---------- */

export async function GET() {
  const data = await generate({ preferences: { duration: 'mini-4d' } }); // default preview = 4-day
  return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const data = await generate(body);
  return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
}
