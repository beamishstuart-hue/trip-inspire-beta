import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const PRIMARY = 'gpt-4o-mini';
const FALLBACK = 'gpt-4o';

/* ================= SAFETY FILTER (whole-country & key cities) ================ */
/* Start simple: whole-country blocks + key Israel cities. 
   We can add regional/border rules later once we see your data shape. */

const BLOCK_COUNTRIES = new Set([
  // Whole-country blocks (from your list; you can add/remove anytime)
  'Afghanistan','Belarus','Burkina Faso','Haiti','Iran','Russia','South Sudan','Syria','Yemen',
  'Benin','Burundi','Cameroon','Central African Republic','Chad','Congo','Democratic Republic of the Congo',
  'Djibouti','Eritrea','Ethiopia','Iraq','Lebanon','Libya','Mali','Mauritania','Myanmar (Burma)',
  'Niger','Nigeria','Pakistan','Somalia','Sudan','Ukraine','Venezuela','Western Sahara','North Korea',
  'Angola','Bangladesh','Bolivia','Brazil','Colombia','Ghana','Guatemala',
  'Kosovo','Papua New Guinea','Rwanda','Uganda',
  // Your specific request:
  'Israel','The Occupied Palestinian Territories'
]);

const BLOCK_CITIES = new Set([
  'Tel Aviv','Jerusalem','Haifa','Eilat','Nazareth'
]);

function isRestricted(place = {}) {
  const country = String(place.country || '').trim();
  const city    = String(place.city || '').trim();
  if (BLOCK_COUNTRIES.has(country)) return true;
  if (BLOCK_CITIES.has(city)) return true;
  return false;
}

/* =================== UTIL =================== */

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

/* ================ Prompts (with +2h buffer applied) ================= */

function buildHighlightsPrompt(origin, p, bufferHours = 2) {
  const raw = Number(p.flight_time_hours);
  const userHours = Math.min(Math.max(Number.isFinite(raw) ? raw : 8, 1), 20);
  const limit = userHours + bufferHours; // keep the buffer

  const groupTxt =
    p.group === 'family' ? 'Family with kids' :
    p.group === 'friends' ? 'Group of friends' :
    p.group === 'couple' ? 'Couple' : 'Solo';

  const interestsTxt = Array.isArray(p.interests) && p.interests.length
    ? p.interests.join(', ')
    : 'surprise me';

  const seasonTxt =
    p.season === 'spring' ? 'Spring (Mar–May)' :
    p.season === 'summer' ? 'Summer (Jun–Aug)' :
    p.season === 'autumn' ? 'Autumn (Sep–Nov)' :
    p.season === 'winter' ? 'Winter (Dec–Feb)' : 'Flexible timing';

  return [
`You are Trip Inspire. User origin: ${origin}. Non-stop flight time must be ≤ ~${limit}h. Do not include destinations that require longer non-stop flights.`,
`Travellers: ${groupTxt}. Interests: ${interestsTxt}. Season: ${seasonTxt}.`,
`Return JSON ONLY in this exact shape:
{"top5":[{"city":"...","country":"...","summary":"1–2 lines","highlights":["...", "...", "..."]}]}`,
`HARD RULES:
- Return EXACTLY FIVE destinations in "top5".
- Cover AT LEAST 3 different countries across the five.
- Aim for a mix of types (e.g., at least one city, one coastal/beach, one nature/outdoors) where relevant to the interests/season.
- Strongly avoid overused picks like Lisbon, Barcelona, Porto, Paris, Rome, Amsterdam unless they are an unusually strong fit for the stated interests/season/flight-time.
- Each "highlights" array has EXACTLY 3 concise, specific items with named anchors (street/venue/landmark) and one micro-detail (dish/view/sound).
- No itineraries, no mornings/afternoons/evenings here.
- Avoid returning the identical set of 5 destinations across runs; where possible, vary at least 2 picks even with the same inputs.`
  ].join('\n');
}

/* ================ Soft-avoid + cleanup ================= */

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

  // de-dup (city+country)
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

/* ================= Core generators ================= */

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

// was 0.5 — raise slightly for more variety
content = await callOpenAI([sys, usr], PRIMARY, 700, 0.65);
...
content = await callOpenAI([sys, usr], FALLBACK, 700, 0.65);

   
  const sys = { role:'system', content:'Be concise, concrete, varied across countries, and avoid overused picks unless truly best fit.' };
  const usr = { role:'user', content: buildHighlightsPrompt(origin, p, 2) }; // +2h buffer

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

/* ================= Route handlers ================= */

export async function GET() {
  const data = await generateHighlights('LHR', { interests:['Beaches'], group:'couple', season:'summer', flight_time_hours: 8 });
  return NextResponse.json(data);
}

export async function POST(req) {
  let body = null;

  try {
    body = await req.json();                 // read the request body safely
    const origin = body?.origin || 'LHR';
    const p = body?.preferences || {};
    const build = body?.buildItineraryFor;

    if (build?.city) {
      // Build itinerary for a specific Top 5 item
      const res = await generateItinerary(STRIP(build.city), STRIP(build.country || ''), p);
      return NextResponse.json(res);
    }

    // Get Top 5
    const res = await generateHighlights(origin, p);

     // TEMP: log the first destination for debugging
if (Array.isArray(res.top5) && res.top5.length > 0) {
  console.log('[DEBUG destination example]', res.top5[0]);
}

    // Apply safety filter (remove restricted countries/cities)
    const top5Safe = (Array.isArray(res.top5) ? res.top5 : []).filter(d => !isRestricted(d));

    // Return filtered results with original meta
    return NextResponse.json({ ...res, top5: top5Safe });

  } catch (err) {
    // Print the error so you can see it in Vercel → Deployments → Functions
    console.error('API ERROR:', {
      message: err?.message,
      stack: err?.stack,
      bodySummary: body ? {
        hasPrefs: !!body?.preferences,
        hasBuildItineraryFor: !!body?.buildItineraryFor,
      } : null
    });

    return NextResponse.json(
      { error: 'Something went wrong in /api/inspire' },
      { status: 500 }
    );
  }
}
