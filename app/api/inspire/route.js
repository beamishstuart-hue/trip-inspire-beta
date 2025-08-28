export const dynamic = 'force-dynamic';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const PRIMARY = 'gpt-4o-mini';
const FALLBACK = 'gpt-4o';

/* ---------- Helpers ---------- */

const FILLERS = [/optional afternoon stroll/gi, /relaxing dinner/gi, /resort time/gi, /\bfree time\b/gi];

const STRIP = (s="") => s
  .replace(/\s*\(add a named street\/venue\/landmark\)\s*/gi, '')
  .replace(/\s*— plus a contrasting nearby activity\.?\s*/gi, '')
  .replace(/\s+/g, ' ')
  .trim();

function cleanItin(days = []) {
  const seen = new Set(), used = new Set();
  const verbs = ['wander','sample','trace','duck into','people-watch','bar-hop','graze','meander','poke around','soak up'];
  const rep  = s => FILLERS.reduce((t, re) => t.replace(re, ''), s || '').trim();
  const verb = s => { const v = verbs.find(x => !used.has(x)) || 'explore'; used.add(v); return (s || '').replace(/\b(stroll|relax|enjoy|explore)\b/i, v); };
  const dedupe = d => { ['morning','afternoon','evening'].forEach(k => { const key = k+':'+(d[k]||'').toLowerCase().slice(0,80); if (seen.has(key)) d[k]+=''; seen.add(key); }); return d; };
  return days.map(d => dedupe({ morning: STRIP(verb(rep(d.morning))), afternoon: STRIP(verb(rep(d.afternoon))), evening: STRIP(verb(rep(d.evening))) }));
}

function daysWanted(duration) {
  return duration==='weekend-2d' ? 2 : duration==='mini-4d' ? 4 : duration==='two-weeks' ? 14 : 7;
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
      },
      {
        city: "Barcelona",
        country: "Spain",
        summary: "Gaudí icons, Mediterranean evenings and market-to-table bites; perfect mini-break.",
        days: cleanItin([
          { morning:"La Boqueria (La Rambla 91)", afternoon:"Gothic Quarter alleys to Plaça del Rei", evening:"Tapas crawl on Carrer de Blai" },
          { morning:"Sagrada Família (prebook AM slot)", afternoon:"Passeig de Gràcia façades (Casa Batlló)", evening:"Sunset at Bunkers del Carmel" },
          { morning:"Barceloneta boardwalk", afternoon:"El Born boutiques (Carrer de la Princesa)", evening:"Paella near Port Olímpic" },
          { morning:"Park Güell terrace", afternoon:"Gràcia squares (Plaça del Sol)", evening:"Vermut & pinchos at a bodega" }
        ])
      }
    ]
  };
}

/* ---------- OpenAI with hard timeout ---------- */

async function callOpenAIWithTimeout(messages, model, timeoutMs = 7000) {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(new Error('Timeout')), timeoutMs);
  try {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        temperature: 0.55,
        max_tokens: 900,        // cap to keep responses fast
        messages
      })
    });
    if (!res.ok) throw new Error(`OpenAI ${model} ${res.status}`);
    const data = await res.json();
    return data?.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(to);
  }
}

function tryParseJSON(text) {
  try { return JSON.parse(text); } catch {}
  const inline = text.match(/\{[\s\S]*\}/);
  if (inline) { try { return JSON.parse(inline[0]); } catch {} }
  const fenced = text.match(/```json([\s\S]*?)```/i) || text.match(/```([\s\S]*?)```/);
  if (fenced?.[1]) { try { return JSON.parse(fenced[1]); } catch {} }
  return null;
}

/* ---------- Prompt ---------- */

function buildPrompt(origin, p, wantDays) {
  const hours = Math.min(Math.max(Number(p.flight_time_hours)||8,1),20);
  const groupTxt = p.group==='family'?'Family with kids' : p.group==='friends'?'Group of friends' : p.group==='couple'?'Couple' : 'Solo';
  const styleMap = { adventure:'Adventure & outdoor activities', relaxation:'Relaxation & beach', cultural:'Cultural & historical', luxury:'Luxury & fine dining', budget:'Budget & backpacking' };
  const styleTxt = styleMap[p.style] || 'Mixed';
  const interestsTxt = Array.isArray(p.interests)&&p.interests.length ? p.interests.join(', ') : 'surprise me';
  const seasonTxt = p.season==='flexible' ? 'Flexible timing'
    : p.season==='spring' ? 'Spring (Mar–May)'
    : p.season==='summer' ? 'Summer (Jun–Aug)'
    : p.season==='autumn' ? 'Autumn (Sep–Nov)' : 'Winter (Dec–Feb)';
  const paceTxt = p.pace==='total' ? 'Total relaxation' : p.pace==='relaxed' ? 'A few relaxing activities' : p.pace==='daily' ? 'Different activity every day' : 'Packed schedule';

  const rules =
`CRITICAL RULES:
- Return exactly THREE destinations in "top3".
- Each destination has EXACTLY ${wantDays} days (no "TBD" or placeholders).
- NO filler phrases: "optional stroll", "relaxing dinner", "free time at resort".
- EACH day must include 1–2 named anchors (street/venue/landmark) + 1 micro-detail (dish, view, material, sound).
- Vary verbs; don’t reuse stroll/relax/enjoy/explore.
- Keep answers concise; TOTAL reply under ~600 tokens.
- OUTPUT JSON ONLY:
{"top3":[{"city":"City","country":"Country","summary":"1–2 lines","days":[{"morning":"...","afternoon":"...","evening":"..."}]}]}`;

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

/* ---------- Core ---------- */

async function generate(body) {
  if (!process.env.OPENAI_API_KEY) return sample();

  const origin = body?.origin || 'LHR';
  const p = body?.preferences || {};
  const want = daysWanted(p.duration);

  const sys = { role: 'system', content: 'You are Trip Inspire. Provide concrete, place-anchored itineraries with varied days.' };
  const usr = { role: 'user', content: buildPrompt(origin, p, want) };

  // Single fast call with timeout + fallback model
  let content;
  try { content = await callOpenAIWithTimeout([sys, usr], PRIMARY, 7000); }
  catch { try { content = await callOpenAIWithTimeout([sys, usr], FALLBACK, 7000); } catch { return sample(); } }

  const parsed = tryParseJSON(content);
  if (!parsed || !Array.isArray(parsed.top3) || parsed.top3.length === 0) return sample();

  const top3 = parsed.top3.slice(0,3).map(trip => {
    let days = Array.isArray(trip.days) ? trip.days.slice(0, want) : [];
    // final safety: if fewer than want, pad with specific-looking lines (no "TBD")
    while (days.length < want) {
      days.push({
        morning: "Local market visit (name one) and coffee on a pedestrian street",
        afternoon: "Named museum or viewpoint in the historic center",
        evening: "Dinner at a typical spot (name it) and a sunset viewpoint (name it)"
      });
    }
    return {
      city: STRIP(trip.city || ''),
      country: STRIP(trip.country || ''),
      summary: STRIP(trip.summary || ''),
      days: cleanItin(days)
    };
  });

  // If the model returned fewer than 3 destinations, top up from sample quickly (no extra API calls)
  while (top3.length < 3) top3.push(sample().top3[0]);

  return { top3 };
}

/* ---------- Routes ---------- */

export async function GET() {
  const data = await generate({ preferences: { duration: 'mini-4d' } });
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const data = await generate(body);
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
