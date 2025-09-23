// app/api/inspire/route.js
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const PRIMARY = 'gpt-4o-mini';
const FALLBACK = 'gpt-4o';

/* ================= SAFETY FILTER (whole-country & key cities) ================ */

const BLOCK_COUNTRIES = new Set([
  'Afghanistan','Belarus','Burkina Faso','Haiti','Iran','Russia','South Sudan','Syria','Yemen',
  'Benin','Burundi','Cameroon','Central African Republic','Chad','Congo','Democratic Republic of the Congo',
  'Djibouti','Eritrea','Ethiopia','Iraq','Lebanon','Libya','Mali','Mauritania','Myanmar (Burma)',
  'Niger','Nigeria','Pakistan','Somalia','Sudan','Ukraine','Venezuela','Western Sahara','North Korea',
  'Angola','Bangladesh','Bolivia','Brazil','Colombia','Ghana','Guatemala','Kosovo','Papua New Guinea',
  'Rwanda','Uganda','Israel','The Occupied Palestinian Territories'
]);

const BLOCK_CITIES = new Set(['Tel Aviv','Jerusalem','Haifa','Eilat','Nazareth']);

function isRestricted(place = {}) {
  const country = String(place.country || '').trim();
  const city    = String(place.city || '').trim();
  if (BLOCK_COUNTRIES.has(country)) return true;
  if (BLOCK_CITIES.has(city)) return true;
  return false;
}

/* =================== UTIL =================== */

const STRIP = (s='') => String(s).replace(/\s+/g,' ').trim();
const withMeta = (data, meta) => ({ meta, ...data });

function daysWanted(dur) {
  const d = String(dur || '').toLowerCase();
  const m = d.match(/(\d+)\s*d/);
  if (m) return Math.max(1, parseInt(m[1], 10));
  if (d === 'weekend-2d') return 2;
  if (d === 'mini-4d') return 4;
  if (d === 'two-weeks' || d === 'two-weeks-14d' || d === 'fortnight-14d') return 14;
  return 7;
}

async function callOpenAI(messages, model, max_tokens=1000, temperature=0.85) {
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
  const m = text && String(text).match(/\{[\s\S]*\}$/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

/* ================ Prompts ================= */

function buildHighlightsPrompt(origin, p, bufferHours = 2, excludes = []) {
  const raw = Number(p?.flight_time_hours);
  const userHours = Math.min(Math.max(Number.isFinite(raw) ? raw : 8, 1), 20);
  const limit = userHours + bufferHours; // stricter use below too

  const groupTxt =
    p?.group === 'family' ? 'Family with kids' :
    p?.group === 'friends' ? 'Group of friends' :
    p?.group === 'couple' ? 'Couple' : 'Solo';

  const interestsTxt = Array.isArray(p?.interests) && p.interests.length
    ? p.interests.join(', ')
    : 'surprise me';

  const seasonTxt =
    p?.season === 'spring' ? 'Spring (Mar–May)' :
    p?.season === 'summer' ? 'Summer (Jun–Aug)' :
    p?.season === 'autumn' ? 'Autumn (Sep–Nov)' :
    p?.season === 'winter' ? 'Winter (Dec–Feb)' : 'Flexible timing';

  const excludeLine = Array.isArray(excludes) && excludes.length
    ? `Exclude these cities (any country): ${excludes.join(', ')}.`
    : '';

  // We ask for a larger "candidates" pool; we'll post-filter to 5 using hard rules.
  return [
`You are Trip Inspire. Origin airport: ${origin}.`,
`Return JSON ONLY in this exact shape:
{"candidates":[
  {"city":"...","country":"...","type":"city|beach|nature|culture","approx_nonstop_hours":7,
   "summary":"1–2 lines","highlights":["...", "...", "..."] }
  // 10–12 items total
]}`,
`Constraints:
- Non-stop flight time must be ≤ ~${limit}h from ${origin}. Provide your best estimate in "approx_nonstop_hours".
- Travellers: ${groupTxt}. Interests: ${interestsTxt}. Season: ${seasonTxt}.
- Cover AT LEAST 5 different countries across the full candidate list.
- Aim for a mix of types: include some of each: city, beach/coast, and nature/outdoors where relevant.
- Avoid overused picks like Lisbon, Barcelona, Porto, Paris, Rome, Amsterdam unless uniquely suited.
- Each "highlights" array has EXACTLY 3 concise, specific items with named anchors + one micro-detail (dish/view/sound).
${excludeLine}
- Do not include places in restricted countries/cities if asked to exclude them.`,
`Style:
- No prose outside JSON. Keep "summary" snappy and concrete.`
  ].filter(Boolean).join('\n');
}

// Itinerary prompt (unchanged behaviour)
function buildItineraryPrompt(city, country = '', days = 3, prefs = {}) {
  const groupTxt =
    prefs.group === 'family' ? 'Family with kids' :
    prefs.group === 'friends' ? 'Group of friends' :
    prefs.group === 'couple' ? 'Couple' : 'Solo';

  const interestsTxt = Array.isArray(prefs.interests) && prefs.interests.length
    ? prefs.interests.join(', ')
    : 'general sightseeing';

  const seasonTxt =
    prefs.season === 'spring' ? 'Spring (Mar–May)' :
    prefs.season === 'summer' ? 'Summer (Jun–Aug)' :
    prefs.season === 'autumn' ? 'Autumn (Sep–Nov)' :
    prefs.season === 'winter' ? 'Winter (Dec–Feb)' : 'Any season';

  return `
Create a concise ${days}-day itinerary for ${city}${country ? ', ' + country : ''}.
Travellers: ${groupTxt}. Interests: ${interestsTxt}. Season: ${seasonTxt}.
Return ONLY valid JSON with this exact shape:
{
  "city": "${city}",
  "country": "${country}",
  "days": [
    { "title": "Day 1", "morning": "...", "afternoon": "...", "evening": "..." }
    // one object per day, exactly ${days} total, each slot is specific named places
  ]
}
Rules:
- Use named places/venues/landmarks and 8–14 words per slot.
- Keep travel sensible (clustered areas). No time-of-day headings beyond morning/afternoon/evening.
- No prose outside JSON.
`.trim();
}

/* ================ Repeat blocker + candidate selection ================= */

const AVOID = new Set([
  'lisbon','barcelona','porto','paris','rome','amsterdam','london','madrid','athens','venice',
  'florence','berlin','prague','vienna','budapest','dublin'
]);

const TYPE_ALIASES = {
  city: 'city', cities: 'city', urban: 'city', culture: 'culture',
  beach: 'beach', coast: 'beach', seaside: 'beach', island: 'beach',
  nature: 'nature', outdoors: 'nature', mountains: 'nature', lakes: 'nature'
};
function normType(t) {
  const k = STRIP(t).toLowerCase();
  return TYPE_ALIASES[k] || (k.includes('beach') ? 'beach'
                    : k.includes('city') ? 'city'
                    : k.includes('nature') || k.includes('outdoor') ? 'nature'
                    : k.includes('culture') ? 'culture'
                    : 'city');
}
const wantsTypeSet = new Set(['city','beach','nature']); // we aim to include at least one of each if available

function parseCandidates(parsedObj) {
  if (Array.isArray(parsedObj?.candidates)) return parsedObj.candidates;
  if (Array.isArray(parsedObj?.top5)) return parsedObj.top5; // fallback
  return [];
}

function pickTop5FromCandidates(cands, limitHours, excludes = []) {
  // Clean + normalize
  const excludeSet = new Set((Array.isArray(excludes)?excludes:[]).map(x => STRIP(x).toLowerCase()));
  const cleaned = (Array.isArray(cands) ? cands : []).map(x => {
    const hours = Number(x.approx_nonstop_hours);
    return {
      city: STRIP(x.city),
      country: STRIP(x.country),
      type: normType(x.type || ''),
      approx_nonstop_hours: Number.isFinite(hours) ? hours : null,
      summary: STRIP(x.summary || ''),
      highlights: Array.isArray(x.highlights) ? x.highlights.slice(0,3).map(STRIP) : []
    };
  }).filter(x =>
    x.city && x.country && x.highlights.length === 3
  );

  // Hard filters: restricted, avoid list, user excludes, and flight-time cutoff (if hours present)
  const hard = cleaned.filter(x => {
    const cityLc = x.city.toLowerCase();
    if (isRestricted(x)) return false;
    if (AVOID.has(cityLc)) return false;
    if (excludeSet.has(cityLc) || excludeSet.has(`${cityLc}|${x.country.toLowerCase()}`)) return false;
    if (x.approx_nonstop_hours != null && x.approx_nonstop_hours > limitHours) return false;
    return true;
  });

  // Country & type diversity
  const byCountry = new Map(); // country -> items[]
  hard.forEach(item => {
    const key = item.country.toLowerCase();
    if (!byCountry.has(key)) byCountry.set(key, []);
    byCountry.get(key).push(item);
  });

  // Greedy pick: ensure at least one of each desired type if possible
  const picked = [];
  const seenCityCountry = new Set();

  function pushIfNew(it) {
    const key = `${it.city.toLowerCase()}|${it.country.toLowerCase()}`;
    if (seenCityCountry.has(key)) return false;
    picked.push(it);
    seenCityCountry.add(key);
    return true;
  }

  // Pass 1: uniqueness by country
  for (const [, items] of byCountry) {
    // Prefer items with type we still need
    const needType = items.find(i => wantsTypeSet.has(i.type) && !picked.find(p => p.type === i.type));
    if (needType && pushIfNew(needType) && picked.length === 5) break;
    // else first available
    if (!needType && items[0] && pushIfNew(items[0]) && picked.length === 5) break;
  }

  // Pass 2: ensure type coverage (at least one city, one beach, one nature) if available
  for (const t of ['city','beach','nature']) {
    if (picked.find(p => p.type === t)) continue;
    const cand = hard.find(i => i.type === t && !seenCityCountry.has(`${i.city.toLowerCase()}|${i.country.toLowerCase()}`));
    if (cand) { pushIfNew(cand); if (picked.length === 5) break; }
  }

  // Pass 3: fill remaining up to 5
  for (const it of hard) {
    if (picked.length === 5) break;
    pushIfNew(it);
  }

  return picked.slice(0,5);
}

/* ================= Core generators ================= */

async function generateHighlights(origin, p, excludes = []) {
  const raw = Number(p?.flight_time_hours);
  const userHours = Math.min(Math.max(Number.isFinite(raw) ? raw : 8, 1), 20);
  const limit = userHours + 2; // same as prompt, enforced here

  if (!process.env.OPENAI_API_KEY) {
    // Sample fallback (contains hours & type so filters work)
    const sample = [
      { city:'Valencia', country:'Spain', type:'city',  approx_nonstop_hours:2.5, summary:'Beachy city with paella & modernism', highlights:['Ciudad de las Artes','Paella at La Pepica','El Cabanyal tiles'] },
      { city:'Dubrovnik',country:'Croatia',type:'city', approx_nonstop_hours:2.8, summary:'Walled old town & Adriatic views',   highlights:['City Walls loop','Srđ cable car','Sea kayak caves'] },
      { city:'Palermo',  country:'Italy',  type:'city',  approx_nonstop_hours:3.0, summary:'Markets, mosaics, Arab–Norman mix', highlights:['Ballarò market','Cappella Palatina','Via Maqueda cannoli'] },
      { city:'Funchal',  country:'Portugal (Madeira)', type:'nature', approx_nonstop_hours:3.9, summary:'Levadas & gardens', highlights:['Monte cable car','25 Fontes levada','Mercado dos Lavradores'] },
      { city:'Málaga',   country:'Spain',  type:'beach', approx_nonstop_hours:2.7, summary:'Museums & tapas culture',           highlights:['Alcazaba ramparts','Picasso Museum','Calle Larios tapas'] },
      { city:'Corfu',    country:'Greece', type:'beach', approx_nonstop_hours:3.2, summary:'Ionian beaches & old town',         highlights:['Old Fortress','Paleokastritsa','Liston esplanade'] },
      { city:'Innsbruck',country:'Austria',type:'nature',approx_nonstop_hours:2.0, summary:'Alpine views & hiking',             highlights:['Nordkette cable car','Old Town arcades','Bergisel Ski Jump'] },
    ];
    return withMeta({ top5: pickTop5FromCandidates(sample, limit, excludes) }, { mode:'sample' });
  }

  const sys = { role:'system', content:'Return JSON only. Be concrete, country-diverse, and include type + approximate non-stop hours.' };
  const usr = { role:'user', content: buildHighlightsPrompt(origin, p, 2, excludes) };

  let content;
  try {
    content = await callOpenAI([sys, usr], PRIMARY, 1100, 0.9);
  } catch {
    content = await callOpenAI([sys, usr], FALLBACK, 1100, 0.9);
  }

  const parsed = tryParse(content) || {};
  const cands = parseCandidates(parsed);
  const top5 = pickTop5FromCandidates(cands, limit, excludes);

  return withMeta({ top5 }, { mode:'live' });
}

async function generateItinerary(city, country, p) {
  const want = daysWanted(p?.duration);
  if (!process.env.OPENAI_API_KEY) {
    return withMeta({
      city, country,
      days: Array.from({length: want}).map((_,i)=>({
        title: `Day ${i+1}`,
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
    content = await callOpenAI([sys, usr], PRIMARY, 1100, 0.55);
  } catch {
    content = await callOpenAI([sys, usr], FALLBACK, 1100, 0.55);
  }
  const parsed = tryParse(content) || {};
  let days = Array.isArray(parsed.days) ? parsed.days.slice(0, want) : [];
  while (days.length < want) {
    const i = days.length;
    days.push({
      title: `Day ${i+1}`,
      morning:`Café by ${city} landmark (name it)`,
      afternoon:`Short museum/garden near center (name it)`,
      evening:`Dinner at a typical spot (name it) + viewpoint`
    });
  }
  return withMeta({ city, country, days }, { mode:'live', wantDays: want });
}

/* ================= Route handlers ================= */

export async function GET() {
  const data = await generateHighlights('LHR', { interests:['Beaches'], group:'couple', season:'summer', flight_time_hours: 8 }, []);
  return NextResponse.json(data);
}

export async function POST(req) {
  let body = null;

  try {
    body = await req.json();
    const origin = body?.origin || 'LHR';
    const p = body?.preferences || {};
    const build = body?.buildItineraryFor;

    // Optional explicit excludes from client (e.g., last results shown)
    const excludes = Array.isArray(body?.exclude) ? body.exclude : [];

    if (build?.city) {
      const res = await generateItinerary(STRIP(build.city), STRIP(build.country || ''), p);
      return NextResponse.json(res);
    }

    const res = await generateHighlights(origin, p, excludes);

    // Final safety filter (restricted countries/cities)
    const top5Safe = (Array.isArray(res.top5) ? res.top5 : []).filter(d => !isRestricted(d));

    return NextResponse.json({ ...res, top5: top5Safe });

  } catch (err) {
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
