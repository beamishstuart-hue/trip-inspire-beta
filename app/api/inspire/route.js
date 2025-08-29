export const dynamic = 'force-dynamic';

/* ======================== Config ======================== */
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const PRIMARY = 'gpt-4o-mini';
const FALLBACK = 'gpt-4o';

/* Tiny helper to attach debug info */
const withMeta = (data, meta) => ({ meta, ...data });

/* ===================== Text helpers ===================== */
const FILLERS = [
  /optional afternoon stroll/gi,
  /relaxing dinner/gi,
  /resort time/gi,
  /\bfree time\b/gi
];

const STRIP = (s = '') =>
  s
    .replace(/\s*\(add a named street\/venue\/landmark\)\s*/gi, '')
    .replace(/\s*— plus a contrasting nearby activity\.?\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

function cleanItin(days = []) {
  const seen = new Set();
  const used = new Set();
  const verbs = [
    'wander',
    'sample',
    'trace',
    'duck into',
    'people-watch',
    'bar-hop',
    'graze',
    'meander',
    'poke around',
    'soak up'
  ];

  const rep = (s) => FILLERS.reduce((t, re) => t.replace(re, ''), s || '').trim();
  const varyVerb = (s) => {
    const v = verbs.find((x) => !used.has(x)) || 'explore';
    used.add(v);
    return (s || '').replace(/\b(stroll|relax|enjoy|explore)\b/i, v);
  };
  const dedupe = (d) => {
    ['morning', 'afternoon', 'evening'].forEach((k) => {
      const key = k + ':' + (d[k] || '').toLowerCase().slice(0, 100);
      if (seen.has(key)) d[k] += ' (alternatively, pick a contrasting nearby spot)';
      seen.add(key);
    });
    return d;
  };

  return days.map((d) =>
    dedupe({
      morning: STRIP(varyVerb(rep(d.morning))),
      afternoon: STRIP(varyVerb(rep(d.afternoon))),
      evening: STRIP(varyVerb(rep(d.evening)))
    })
  );
}

const daysWanted = (dur) =>
  dur === 'weekend-2d' ? 2 : dur === 'mini-4d' ? 4 : dur === 'two-weeks' ? 14 : 7;

/* ================ Sample fallback (only if no key / error) ================ */
function sample() {
  return {
    top3: [
      {
        city: 'Lisbon',
        country: 'Portugal',
        summary: 'Fallback sample: viewpoints, tiles and tram rides.',
        days: cleanItin([
          {
            morning: 'Pastéis de Belém (Rua de Belém 84–92)',
            afternoon: 'MAAT river walk via Avenida Brasília',
            evening: 'Fado in Alfama at Clube de Fado'
          },
          {
            morning: 'Tram 28 to Graça + Miradouro da Senhora do Monte',
            afternoon: 'Tile workshop near Largo do Intendente',
            evening: 'Petiscos crawl on Rua da Atalaia (Bairro Alto)'
          },
          {
            morning: 'Cascais boardwalk from Praia da Rainha',
            afternoon: 'Boca do Inferno viewpoint',
            evening: 'Sunset at Miradouro de Santa Catarina'
          },
          {
            morning: 'LX Factory (Rua Rodrigues de Faria)',
            afternoon: 'Time Out Market tasting counters',
            evening: 'Ribeira waterfront stroll'
          }
        ])
      },
      {
        city: 'Barcelona',
        country: 'Spain',
        summary: 'Fallback sample: Gaudí icons and Mediterranean evenings.',
        days: cleanItin([
          {
            morning: 'La Boqueria (La Rambla 91)',
            afternoon: 'Gothic Quarter lanes to Plaça del Rei',
            evening: 'Tapas on Carrer de Blai'
          },
          {
            morning: 'Sagrada Família (prebook AM slot)',
            afternoon: 'Passeig de Gràcia façades (Casa Batlló)',
            evening: 'Sunset at Bunkers del Carmel'
          },
          {
            morning: 'Barceloneta boardwalk',
            afternoon: 'El Born boutiques (Carrer de la Princesa)',
            evening: 'Paella near Port Olímpic'
          },
          {
            morning: 'Park Güell terrace',
            afternoon: 'Gràcia squares (Plaça del Sol)',
            evening: 'Vermut & pinchos at a bodega'
          }
        ])
      },
      {
        city: 'Porto',
        country: 'Portugal',
        summary: 'Fallback sample: Douro bends, tiled halls and cellar tastings.',
        days: cleanItin([
          {
            morning: 'Clérigos Tower steps',
            afternoon: 'Livraria Lello browse',
            evening: 'Ribeira riverfront dinner'
          },
          {
            morning: 'Bolhão Market pastries',
            afternoon: 'São Bento azulejos',
            evening: 'Port tasting in Vila Nova de Gaia'
          },
          {
            morning: 'Foz do Douro promenade',
            afternoon: 'Serralves Museum & gardens',
            evening: 'Sunset at Jardim do Morro'
          },
          {
            morning: 'Rua das Flores cafés',
            afternoon: 'Palácio da Bolsa',
            evening: 'Francesinha at a classic café'
          }
        ])
      }
    ]
  };
}

/* ================= OpenAI helpers (quality & speed) ================= */
async function callOpenAI(messages, model) {
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0.55,
      max_tokens: 1500,
      response_format: { type: 'json_object' }, // structured JSON for fast reliable parse
      messages
    })
  });
  if (!res.ok) throw new Error(`OpenAI ${model} ${res.status}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

function tryParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {}
  const inline = text.match(/\{[\s\S]*\}/);
  if (inline) {
    try {
      return JSON.parse(inline[0]);
    } catch {}
  }
  const fenced =
    text.match(/```json([\s\S]*?)```/i) || text.match(/```([\s\S]*?)```/);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }
  return null;
}

/* ===================== Prompt builders ===================== */
function buildMainPrompt(origin, p, wantDays) {
  const hours = Math.min(Math.max(Number(p.flight_time_hours) || 8, 1), 20);

  const groupTxt =
    p.group === 'family'
      ? 'Family with kids'
      : p.group === 'friends'
      ? 'Group of friends'
      : p.group === 'couple'
      ? 'Couple'
      : 'Solo';

  const styleMap = {
    adventure: 'Adventure & outdoor activities',
    relaxation: 'Relaxation & beach',
    cultural: 'Cultural & historical',
    luxury: 'Luxury & fine dining',
    budget: 'Budget & backpacking'
  };
  const styleTxt = styleMap[p.style] || 'Mixed';

  const interestsTxt =
    Array.isArray(p.interests) && p.interests.length
      ? p.interests.join(', ')
      : 'surprise me';

  const seasonTxt =
    p.season === 'flexible'
      ? 'Flexible timing'
      : p.season === 'spring'
      ? 'Spring (Mar–May)'
      : p.season === 'summer'
      ? 'Summer (Jun–Aug)'
      : p.season === 'autumn'
      ? 'Autumn (Sep–Nov)'
      : 'Winter (Dec–Feb)';

  const paceTxt =
    p.pace === 'total'
      ? 'Total relaxation'
      : p.pace === 'relaxed'
      ? 'A few relaxing activities'
      : p.pace === 'daily'
      ? 'Different activity every day'
      : 'Packed schedule';

  const rules = `HARD RULES (CRITICAL):
- Return EXACTLY THREE (3) destinations in "top3".
- For each destination, produce EXACTLY ${wantDays} days. No placeholders like "TBD".
- No day repeats the same morning/afternoon/evening pattern across days.
- EACH day contains 1–2 named anchors (street/venue/landmark) AND 1 micro-detail (dish, view, sound, material).
- Include 1 local quirk per trip (etiquette, transit trick, closing hour).
- Reflect opening hours when widely known and realistic travel times; include one rain fallback.
- Avoid filler: "optional stroll", "relaxing dinner", "free time at resort".
- Vary verbs; don’t repeat stroll/relax/enjoy/explore.
- OUTPUT JSON ONLY in this shape:
{
  "top3": [
    {
      "city": "City",
      "country": "Country",
      "summary": "1–2 lines why this fits the user",
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

function buildRepairTopPrompt(origin, p, haveCount, needCount, wantDays) {
  return [
    `Origin: ${origin}. Same user constraints.`,
    `You returned ${haveCount} destinations. I require exactly ${haveCount + needCount} in total.`,
    `Return ONLY the missing ${needCount} destinations as JSON under "top3" (no prose).`,
    `{"top3":[{ "city":"...", "country":"...", "summary":"...", "days":[{"morning":"...","afternoon":"...","evening":"..."}] }]}`,
    `Each destination must have EXACTLY ${wantDays} days and follow the same hard rules.`
  ].join('\n');
}

function buildRepairDaysPrompt(city, country, haveDays, needDays) {
  return [
    `Destination: ${city}${country ? ', ' + country : ''}`,
    `You provided ${haveDays} days. Total required: ${haveDays + needDays} days.`,
    `Return ONLY the missing ${needDays} days as a pure JSON array (no prose):`,
    `[{ "morning":"...", "afternoon":"...", "evening":"..." }]`,
    `Rules: include named anchors + 1 micro-detail; avoid filler; vary verbs.`
  ].join('\n');
}

/* ===================== Core generation ===================== */
async function generate(body) {
  const origin = body?.origin || 'LHR';
  const p = body?.preferences || {};
  const want = daysWanted(p.duration);

  if (!process.env.OPENAI_API_KEY) {
    return withMeta(sample(), { mode: 'sample', reason: 'no_openai_key' });
  }

  const sys = {
    role: 'system',
    content:
      'You are Trip Inspire. Provide concrete, place-anchored itineraries with varied days and specific details.'
  };
  const usr = { role: 'user', content: buildMainPrompt(origin, p, want) };

  // 1) Main call (primary then fallback)
  let content;
  try {
    content = await callOpenAI([sys, usr], PRIMARY);
  } catch {
    try {
      content = await callOpenAI([sys, usr], FALLBACK);
    } catch (e) {
      return withMeta(sample(), { mode: 'sample', reason: String(e?.message || 'openai_error') });
    }
  }

  let parsed = tryParseJSON(content);
  if (!parsed || !Array.isArray(parsed.top3)) parsed = { top3: [] };

  // 2) Top up to 3 destinations if short (single extra call)
  if (parsed.top3.length < 3) {
    const need = 3 - parsed.top3.length;
    try {
      const repairUsr = {
        role: 'user',
        content: buildRepairTopPrompt(origin, p, parsed.top3.length, need, want)
      };
      const repaired = await callOpenAI([sys, repairUsr], PRIMARY).catch(() =>
        callOpenAI([sys, repairUsr], FALLBACK)
      );
      const more = tryParseJSON(repaired);
      if (more && Array.isArray(more.top3)) {
        parsed.top3 = [...parsed.top3, ...more.top3].slice(0, 3);
      }
    } catch {
      // ignore; we'll still return something below
    }
  }

  if (parsed.top3.length === 0) {
    return withMeta(sample(), { mode: 'sample', reason: 'no_results' });
  }

  // 3) Normalize & repair missing days — run repairs in parallel for speed
  const fixed = await Promise.all(
    parsed.top3.slice(0, 3).map(async (trip) => {
      const city = STRIP(trip.city || '');
      const country = STRIP(trip.country || '');
      const summary = STRIP(trip.summary || '');

      let days = Array.isArray(trip.days) ? trip.days.slice(0, want) : [];

      if (days.length < want) {
        const needDays = want - days.length;
        try {
          const repairUsr = {
            role: 'user',
            content: buildRepairDaysPrompt(city || 'Destination', country || '', days.length, needDays)
          };
          const repaired = await callOpenAI([sys, repairUsr], PRIMARY).catch(() =>
            callOpenAI([sys, repairUsr], FALLBACK)
          );
          const arr = tryParseJSON(repaired);
          if (Array.isArray(arr)) {
            days = [...days, ...arr].slice(0, want);
          }
        } catch {
          // ignore; we'll pad if still short
        }
      }

      // Final safety: pad without "TBD"
      while (days.length < want) {
        days.push({
          morning: 'Local market (name it) + coffee on a pedestrian street',
          afternoon: 'Named museum/viewpoint in the historic center',
          evening: 'Dinner at a typical spot (name it) + sunset viewpoint (name it)'
        });
      }

      return {
        city,
        country,
        summary,
        days: cleanItin(days)
      };
    })
  );

  return withMeta({ top3: fixed }, { mode: 'live', wantDays: want });
}

/* ===================== Route handlers ===================== */
export async function GET() {
  // GET is a quick demo so you can ping the endpoint in a browser.
  // It intentionally returns a 4-day mini-break.
  const data = await generate({ preferences: { duration: 'mini-4d' } });
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const data = await generate(body);
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
     
