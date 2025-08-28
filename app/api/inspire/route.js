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
        summary: "Compact hills, viewpoints, pastry culture; easy 4-day hop from London.",
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

function stripHints(s = "") {
  return s
    .replace(/\s*\(add a named street\/venue\/landmark\)\s*/gi, '')
    .replace(/\s*— plus a contrasting nearby activity\.?\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanItin(days) {
  const seen = new Set();
  const used = new Set();
  const verbs = ['wander','sample','trace','duck into','people-watch','bar-hop','graze','meander','poke around','soak up'];

  const rep = s => FILLERS.reduce((t, re) => t.replace(re, ''), s).trim();
  const verb = s => { const v = verbs.find(x => !used.has(x)) || 'explore'; used.add(v); return s.replace(/\b(stroll|relax|enjoy|explore)\b/i, v); };
  const anch = s => (/[A-Z][a-z]+(?:\s[A-Z][a-z]+)+/.test(s) ? s : s + ''); // don’t append hint; we’ll just leave as-is
  const dedu = d => {
    ['morning','afternoon','evening'].forEach(k => {
      const key = k+':'+(d[k]||'').toLowerCase().slice(0,60);
      if (seen.has(key)) d[k] += '';
      seen.add(key);
    });
    return d;
  };

  return days.map(d => dedu({
    morning: stripHints(verb(anch(rep(d.morning)))),
    afternoon: stripHints(verb(anch(rep(d.afternoon)))),
    evening: stripHints(verb(anch(rep(d.evening))))
  }));
}

function buildPrompt({ origin='LHR', duration='weekend-4d' }) {
  const durLine =
    duration === 'weekend-4d' ? "Duration: EXACTLY 4 days." :
    duration === 'two-weeks' ? "Duration: EXACTLY 14 days." :
    "Duration: EXACTLY 7 days.";

  const rules =
    "You must produce exact-day itineraries with VARIETY. HARD RULES:\n" +
    "- No day may repeat the same morning/afternoon/evening pattern across days.\n" +
    "- Each day must include 1–2 place-specific anchors (named spots, streets, venues) and 1 micro-detail (dish, view, material, sound).\n" +
    "- Insert 1 local quirk per trip (etiquette, transit trick, closing hour).\n" +
    "- Include constraints: common opening hours when widely known, travel time sanity, and one rain fallback.\n" +
    "- Avoid filler: “optional stroll”, “relaxing dinner”, “free time at resort”.\n" +
    "- Vary verbs; don’t reuse stroll/relax/enjoy/explore.\n" +
    "- OUTPUT JSON ONLY: { \"top3\": [{ \"city\":\"...\",\"country\":\"...\",\"summary\":\"...\",\"days\":[{\"morning\":\"...\",\"afternoon\":\"...\",\"evening\":\"...\"}]}] }.\n" +
    "- The number of days MUST MATCH duration exactly.";

  return [
    `Origin: ${origin}.`,
    durLine,
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

/* ---------- Main generation ---------- */

async function generate(body) {
  // If no key, return sample so the app always works
  if (!process.env.OPENAI_API_KEY) return sample();

  const prefs = body?.preferences || {};
  const origin = body?.origin || 'LHR';

  // Default duration in prompt is 4 days; make API enforce the same by default.
  const duration = prefs.duration || 'weekend-4d';
  const prompt = buildPrompt({ origin, duration });

  const sys = { role: 'system', content: 'You are Trip Inspire. Provide concrete, place-anchored itineraries with varied days.' };
  const usr = { role: 'user', content: prompt };

  let content;
  try { content = await callOpenAI([sys, usr], PRIMARY); }
  catch { content = await callOpenAI([sys, usr], FALLBACK); }

  const parsed = tryParse(content);
  if (!parsed || !Array.isArray(parsed.top3)) return sample();

  // Map duration to desired days; DEFAULT to 4 if not provided.
  const want = duration === 'two-weeks' ? 14 : (duration === 'weekend-4d' ? 4 : 7);

  const top3 = parsed.top3.map(trip => {
    // slice to want, then pad if needed
    const daysRaw = Array.isArray(trip.days) ? trip.days.slice(0, want) : [];
    while (daysRaw.length < want) daysRaw.push({ morning:'TBD', afternoon:'TBD', evening:'TBD' });
    const days = cleanItin(daysRaw);

    return {
      city: stripHints(trip.city || ''),
      country: stripHints(trip.country || ''),
      summary: stripHints(trip.summary || ''),
      days
    };
  });

  return { top3 };
}

/* ---------- Route handlers ---------- */

export async function GET() {
  const data = await generate({});
  return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const data = await generate(body);
  return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
}
