export const dynamic = 'force-dynamic';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const PRIMARY = 'gpt-4o-mini';
const FALLBACK = 'gpt-4o';

const withMeta = (data, meta) => ({ meta, ...data });
const STRIP = (s='') => s.replace(/\s+/g,' ').trim();

const daysWanted = (dur) =>
  dur === 'weekend-2d' ? 2 : dur === 'mini-4d' ? 4 : dur === 'two-weeks' ? 14 : 7;

async function callOpenAI(messages, model, max_tokens=900, temperature=0.5) {
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens,
      response_format: { type: 'json_object' },
      messages
    })
  });
  if (!res.ok) throw new Error(`OpenAI ${model} ${res.status}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

function tryParse(text) {
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\{[\s\S]*\}$/); if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

/* ---------------- Prompts ---------------- */

function buildHighlightsPrompt(origin, p) {
  const hours = Math.min(Math.max(Number(p.flight_time_hours) || 8, 1), 20);
  const groupTxt =
    p.group === 'family' ? 'Family with kids' :
    p.group === 'friends' ? 'Group of friends' :
    p.group === 'couple' ? 'Couple' : 'Solo';
  const interestsTxt = Array.isArray(p.interests) && p.interests.length ? p.interests.join(', ') : 'surprise me';
  const seasonTxt =
    p.season === 'spring' ? 'Spring (Mar–May)' :
    p.season === 'summer' ? 'Summer (Jun–Aug)' :
    p.season === 'autumn' ? 'Autumn (Sep–Nov)' :
    p.season === 'winter' ? 'Winter (Dec–Feb)' : 'Flexible timing';

  return [
`You are Trip Inspire. User origin: ${origin}. Non-stop flight time ≤ ~${hours}h.`,
`Travellers: ${groupTxt}. Interests: ${interestsTxt}. Season: ${seasonTxt}.`,
`Return JSON ONLY in this exact shape:
{"top5":[{"city":"...","country":"...","summary":"1–2 lines","highlights":["...", "...", "..."]}]}`,
`HARD RULES:
- Return EXACTLY FIVE destinations in "top5", ideally different countries; strongly avoid overused picks like Lisbon, Barcelona, Porto, Paris, Rome, Amsterdam unless they are an unusually strong fit for the stated interests/season/flight-time.
- Each "highlights" array has EXACTLY 3 concise, specific items with named anchors (street/venue/landmark) and one micro-detail (dish/view/sound).
- No itineraries, no mornings/afternoons/evenings here.`
  ].join('\n');
}

function buildItineraryPrompt(city, country, wantDays, p) {
  return [
`Build an exact-day itinerary for: ${city}${country ? ', ' + country : ''}.`,
`Trip length: EXACTLY ${wantDays} days. Travellers: ${p.group || 'Couple'}. Interests: ${(p.interests||[]).join(', ') || 'surprise me'}. Season: ${p.season || 'flexible'}.`,
`Return JSON ONLY:
{"days":[{"morning":"...","afternoon":"...","evening":"..."}]}`,
`Rules:
- Each slot includes a named anchor and a micro-detail; keep slots under ~25 words.
- Avoid filler like "optional stroll"/"relaxing dinner"/"free time".
- Include at least one rain fallback note across the plan.`
  ].join('\n');
}

/* --------------- Soft-avoid + diversify --------------- */

const AVOID = new Set([
  'lisbon','barcelona','porto','paris','rome','amsterdam','london','madrid','athens','venice',
  'florence','berlin','prague','vienna','budapest','dublin'
]);

function postProcessTop5(list = []) {
  const cleaned = list
    .map(x => ({
      city: STRIP(x.city || ''),
      country: STRIP(x.country || ''),
      summary: STRIP(x.summary || ''),
      highlights: Array.isArray(x.highlights) ? x.highlights.slice(0,3).map(STRIP) : []
    }))
    .filter(x => x.city && x.country && x.highlights.length === 3);

  const seen = new Set();
  const unique = [];
  for (const t of cleaned) {
    const key = `${t.city.toLowerCase()}-${t.country.toLowerCase()}`;
    if (!seen.has(key)) {
      unique.push(t);
      seen.add(key);
    }
    if (unique.length >= 5) break;
  }

  return unique.slice(0,5);
}


/* --------------- Core --------------- */

async function generateHighlights(origin, p) {
  if (!process.env.OPENAI_API_KEY) {
    return withMeta({
      top5: [
        { city:'Valencia', country:'Spain', summary:'Beachy city with paella & modernism', highlights:['Ciudad de las Artes (gleaming curves)','Paella at La Pepica (seafront)','El Cabanyal tiles & beach walk'] },
        { city:'Dubrovnik', country:'Croatia', summary:'Walled old town & Adriatic views', highlights:['City Walls loop (early AM)','Cable Car to Srđ (panorama)','Sea Kayak caves near Lokrum'] },
        { city:'Palermo', country:'Italy', summary:'Markets, mosaics, Arab-Norman mix', highlights:['Ballarò market (arancine sizzle)','Cappella Palatina mosaics','Cannoli on Via Maqueda'] },
        { city:'Funchal', country:'Portugal (Madeira)', summary:'Mild climate, levadas & gardens', highlights:['Monte cable car + sledges','Levada walk (25 Fontes)','Mercado dos Lavradores tastings'] },
        { city:'Málaga', country:'Spain', summary:'Museums & sunny tapas culture', highlights:['Alcazaba ramparts (gold stone)','Picasso Museum (early slot)','Tapas crawl on Calle Larios'] },
      ]
    }, { mode:'sample' });
  }

  const sys = { role:'system', content:'Be concise, concrete, varied across countries, and avoid overused picks unless truly best fit.' };
  const usr = { role:'user', content: buildHighlightsPrompt(origin, p) };

  let content;
  try {
    content = await callOpenAI([sys, usr], PRIMARY, 700, 0.5);
  } catch {
    content = await callOpenAI([sys, usr], FALLBACK, 700, 0.5);
  }
  const parsed = tryParse(content) || {};
  const raw = Array.isArray(parsed.top5) ? parsed.top5 : [];
  const list = postProcessTop5(raw);
  return withMeta({ top5: list }, { mode:'live' });
}

async function generateItinerary(city, country, p) {
  const want = daysWanted(p.duration);
  if (!process.env.OPENAI_API_KEY) {
    return withMeta({
      city, country,
      days: Array.from({length: want}).map(()=>({
        morning:`Café by ${city} landmark (name it)`,
        afternoon:`Short museum/garden near center (name it)`,
        evening:`Dinner at a typical spot (name it) + viewpoint`
      }))
    }, { mode:'sample', wantDays: want });
  }

  const sys = { role:'system', content:'Concrete, named places; concise slots; no filler.' };
  const usr = { role:'user', content: buildItineraryPrompt(city, country, want, p) };

  let content;
  try {
    content = await callOpenAI([sys, usr], PRIMARY, 1100, 0.5);
  } catch {
    content = await callOpenAI([sys, usr], FALLBACK, 1100, 0.5);
  }
  const parsed = tryParse(content) || {};
  const days = Array.isArray(parsed.days) ? parsed.days.slice(0, want) : [];
  while (days.length < want) {
    days.push({
      morning:`Café by ${city} landmark (name it)`,
      afternoon:`Short museum/garden near center (name it)`,
      evening:`Dinner at a typical spot (name it) + viewpoint`
    });
  }
  return withMeta({ city, country, days }, { mode:'live', wantDays: want });
}

/* --------------- Route handlers --------------- */

export async function GET() {
  const data = await generateHighlights('LHR', { interests:['Beaches'], group:'couple', season:'summer' });
  return new Response(JSON.stringify(data), { status:200, headers:{'Content-Type':'application/json'} });
}

export async function POST(req) {
  const body = await req.json().catch(()=> ({}));
  const origin = body.origin || 'LHR';
  const p = body.preferences || {};
  const build = body.buildItineraryFor;

  if (Array.isArray(candidates) && candidates.length > 0) {
  console.log('[DEBUG one destination]', candidates[0]);
}

  try {
    if (build?.city) {
      const res = await generateItinerary(STRIP(build.city), STRIP(build.country || ''), p);
      return new Response(JSON.stringify(res), { status:200, headers:{'Content-Type':'application/json'} });
    }
    const res = await generateHighlights(origin, p);
    return new Response(JSON.stringify(res), { status:200, headers:{'Content-Type':'application/json'} });
  } catch (e) {
    return new Response(JSON.stringify({ error:String(e?.message||e) }), { status:500 });
  }
}
