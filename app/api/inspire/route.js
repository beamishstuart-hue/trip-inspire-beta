export const dynamic = 'force-dynamic';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const PRIMARY = 'gpt-4o-mini';
const FALLBACK = 'gpt-4o';

function sample() {
  return {
    top3: [
      {
        city: "Lisbon",
        country: "Portugal",
        summary: "Compact hills, viewpoints, pastry culture; easy 4-day hop from London.",
        days: [
          { morning:"Pastéis de Belém", afternoon:"MAAT riverside walk", evening:"Bairro Alto dinner" },
          { morning:"Tram 28 to Graça + miradouros", afternoon:"Tile workshop near Intendente", evening:"Fado in Alfama" },
          { morning:"Cascais boardwalk", afternoon:"Boca do Inferno", evening:"Sunset at Santa Catarina" },
          { morning:"LX Factory browse", afternoon:"Time Out Market tasting", evening:"Ribeira waterfront stroll" }
        ]
      }
    ]
  };
}

const FILLERS = [/optional afternoon stroll/i, /relaxing dinner/i, /resort time/i, /\bfree time\b/i];
function cleanItin(days) {
  const seen = new Set(); const used = new Set(); const verbs = ['wander','sample','trace','duck into','people-watch','bar-hop','graze','meander','poke around','soak up'];
  const rep = s => FILLERS.reduce((t, re) => t.replace(re, ''), s).trim();
  const verb = s => { const v = verbs.find(x => !used.has(x)) || 'explore'; used.add(v); return s.replace(/\b(stroll|relax|enjoy|explore)\b/i, v); };
  const anch = s => (/[A-Z][a-z]+(?:\s[A-Z][a-z]+)+/.test(s) ? s : s + ' (add a named street/venue/landmark)');
  const dedu = d => (['morning','afternoon','evening'].forEach(k => { const key = k+':'+(d[k]||'').toLowerCase().slice(0,60); if (seen.has(key)) d[k] += ' — plus a contrasting nearby activity.'; seen.add(key); }), d);
  return days.map(d => dedu({ morning:verb(anch(rep(d.morning||''))), afternoon:verb(anch(rep(d.afternoon||''))), evening:verb(anch(rep(d.evening||''))) }));
}

function buildPrompt({ origin='LHR', duration='weekend-4d' }) {
  const dur = duration === 'weekend-4d' ? "Duration: 4 days. Optimize for minimal transfers, tight clustering, and exactly 1 signature meal + 1 sunrise/sunset moment. Day 1 arrival-friendly; Day 4 exit-friendly."
    : duration === 'two-weeks' ? "Duration: ~14 days." : "Duration: ~7 days.";
  const rules =
    "You must produce exact-day itineraries with VARIETY. HARD RULES:\n" +
    "- No day may repeat the same morning/afternoon/evening pattern across days.\n" +
    "- Each day must include 1–2 place-specific anchors (named spots, streets, venues) and 1 micro-detail (dish, view, material, sound).\n" +
    "- Insert 1 local quirk per trip (etiquette, transit trick, closing hour).\n" +
    "- Include constraints: common opening hours when widely known, travel time sanity, and one rain fallback.\n" +
    "- Avoid filler: “optional stroll”, “relaxing dinner”, “free time at resort”.\n" +
    "- Vary verbs; don’t reuse stroll/relax/enjoy/explore.\n" +
    "- Output JSON ONLY: { \"top3\": [{ \"city\":\"...\",\"country\":\"...\",\"summary\":\"...\",\"days\":[{\"morning\":\"...\",\"afternoon\":\"...\",\"evening\":\"...\"}]}] }.\n" +
    "Days must match duration (4 for weekend-4d, 7, or 14).";
  return [`Origin: ${origin}.`, dur, rules].join('\n');
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
  if (!process.env.OPENAI_API_KEY) return sample(); // still works if key missing
  const prefs = body?.preferences || {}; // keep simple; duration optional
  const origin = body?.origin || 'LHR';
  const prompt = buildPrompt({ origin, duration: prefs.duration });
  const sys = { role: 'system', content: 'You are Trip Inspire. Provide concrete, place-anchored itineraries with varied days.' };
  const usr = { role: 'user', content: prompt };
  let content;
  try { content = await callOpenAI([sys, usr], PRIMARY); }
  catch { content = await callOpenAI([sys, usr], FALLBACK); }
  const parsed = tryParse(content);
  if (!parsed || !Array.isArray(parsed.top3)) return sample();
  const want = prefs.duration === 'weekend-4d' ? 4 : (prefs.duration === 'two-weeks' ? 14 : 7);
  const top3 = parsed.top3.map(trip => {
    const days = Array.isArray(trip.days) ? trip.days.slice(0, want) : [];
    while (days.length < want) days.push({ morning:'TBD', afternoon:'TBD', evening:'TBD' });
    return { ...trip, days: cleanItin(days), summary: trip.summary || '' };
  });
  return { top3 };
}

export async function GET() {
  const data = await generate({});
  return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
}
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const data = await generate(body);
  return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
}
