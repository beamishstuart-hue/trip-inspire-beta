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

async function callOpenAI(messages, model, max_tokens=1100, temperature=0.9) {
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

function buildHighlightsPrompt(origin, p, bufferHours = 2, excludes = [], minHours = 0) {
  const raw = Number(p?.flight_time_hours);
  const userHours = Math.min(Math.max(Number.isFinite(raw) ? raw : 8, 1), 20);
  const limit = userHours + bufferHours;

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

  const bandLine = minHours > 0
    ? `Prefer candidates clustered in the ${minHours}–${limit}h range. Include AT LEAST 6 candidates with approx_nonstop_hours ≥ ${minHours}h. Avoid short-haul (< ${minHours}h) unless needed to reach 12 items.`
    : `Prefer candidates up to ${limit}h; shorter flights are fine.`;

  return [
`You are Trip Inspire. Origin airport: ${origin}.`,
`Return JSON ONLY in this exact shape:
{"candidates":[
  {"city":"...","country":"...","type":"city|beach|nature|culture","approx_nonstop_hours":7,
   "summary":"1–2 lines","highlights":["...", "...", "..."] }
  // 12 items total
]}`,
`Constraints:
- Non-stop flight time must be ≤ ~${limit}h from ${origin}. Provide your best estimate in "approx_nonstop_hours".
- ${bandLine}
- Travellers: ${groupTxt}. Interests: ${interestsTxt}. Season: ${seasonTxt}.
- Cover AT LEAST 6 different countries across the full candidate list.
- Aim for a mix of types: include some of each: city, beach/coast, and nature/outdoors where relevant.
- Avoid overused picks like Lisbon, Barcelona, Porto, Paris, Rome, Amsterdam unless uniquely suited.
- Each "highlights" array has EXACTLY 3 concise, specific items with named anchors + one micro-detail (dish/view/sound).
${excludeLine}
- Do not include places in restricted countries/cities if asked to exclude them.`,
`Style:
- No prose outside JSON. Keep "summary" snappy and concrete.`
  ].filter(Boolean).join('\n');
}

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

/* ================ Repeat blocker + selection ================= */

// Soft avoid (generic Europe repeats)
const AVOID = new Set([
  'lisbon','barcelona','porto','paris','rome','amsterdam','london','madrid','athens','venice',
  'florence','berlin','prague','vienna','budapest','dublin'
]);

// Downrank the specific repeat offenders you observed (not a hard ban)
const DOWNRANK = new Set(['valencia','catania','dubrovnik','nice']);

// In-memory cooldown (per lambda instance). Ephemeral but helps short-term repeats.
const RECENT_MAX = 30;
const RECENT = []; // array of keys "city|country"
const RECENT_SET = new Set();
function noteRecent(city, country) {
  const key = `${city.toLowerCase()}|${country.toLowerCase()}`;
  if (RECENT_SET.has(key)) return;
  RECENT.push(key); RECENT_SET.add(key);
  while (RECENT.length > RECENT_MAX) {
    const old = RECENT.shift();
    if (old) RECENT_SET.delete(old);
  }
}

const TYPE_ALIASES = {
  city: 'city', cities: 'city', urban: 'city', culture: 'culture',
  beach: 'beach', coast: 'beach', seaside: 'beach', island: 'beach',
  nature: 'nature', outdoors: 'nature', mountains: 'nature', lakes: 'nature'
};
function normType(t) {
  const k = STRIP(t).toLowerCase();
  return TYPE_ALIASES[k] || (k.includes('beach') ? 'beach'
                    : k.includes('city') ? 'city'
                    : (k.includes('nature') || k.includes('outdoor')) ? 'nature'
                    : k.includes('culture') ? 'culture'
                    : 'city');
}

function parseCandidates(parsedObj) {
  if (Array.isArray(parsedObj?.candidates)) return parsedObj.candidates;
  if (Array.isArray(parsedObj?.top5)) return parsedObj.top5; // fallback
  return [];
}

// Small seeded jitter to vary order between runs (stable per input)
function seededJitter(seedStr, i) {
  let h = 2166136261;
  const s = (seedStr + '|' + i);
  for (let c = 0; c < s.length; c++) {
    h ^= s.charCodeAt(c);
    h = Math.imul(h, 16777619);
  }
  // map to [-0.02, +0.02]
  return ((h >>> 0) % 4000) / 100000 - 0.02;
}

function pickTop5FromCandidates(cands, limitHours, excludes = [], seed = 'x') {
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

  // Hard filters: restricted, avoid list, explicit excludes, flight-time cutoff
  const hard = cleaned.filter(x => {
    const cityLc = x.city.toLowerCase();
    const key = `${cityLc}|${x.country.toLowerCase()}`;
    if (isRestricted(x)) return false;
    if (AVOID.has(cityLc)) return false;
    if (excludeSet.has(cityLc) || excludeSet.has(key)) return false;
    if (x.approx_nonstop_hours != null && x.approx_nonstop_hours > limitHours) return false;
    return true;
  });

  // Score & downrank repeats
  const scored = hard.map((it, i) => {
    const cityLc = it.city.toLowerCase();
    const key = `${cityLc}|${it.country.toLowerCase()}`;

    let score = 1.0;

    // Downrank your frequent offenders, but not a hard ban
    if (DOWNRANK.has(cityLc)) score -= 0.15;

    // Cooldown: if we just showed this on this lambda, push it down
    if (RECENT_SET.has(key)) score -= 0.2;

    // Prefer items that include an informative hours estimate
    if (it.approx_nonstop_hours == null) score -= 0.05;

    // Gentle diversity by type — boost if we don't have this type yet (handled again in pick stage)
    // (Applied later during picks; here we only add a tiny jitter)
    score += seededJitter(seed, i);

    return { ...it, _score: score };
  }).sort((a, b) => b._score - a._score);

  // Country & type diversity with greedy selection
  const picked = [];
  const seenCityCountry = new Set();
  const seenCountry = new Set();

  function pushIfNew(it) {
    const key = `${it.city.toLowerCase()}|${it.country.toLowerCase()}`;
    if (seenCityCountry.has(key)) return false;
    picked.push(it);
    seenCityCountry.add(key);
    seenCountry.add(it.country.toLowerCase());
    noteRecent(it.city, it.country);
    return true;
  }

  // Pass 1: ensure country diversity first
  for (const it of scored) {
    if (!seenCountry.has(it.country.toLowerCase())) {
      if (pushIfNew(it) && picked.length === 5) break;
    }
  }

  // Pass 2: ensure we cover city/beach/nature at least once if possible
  for (const t of ['city','beach','nature']) {
    if (picked.find(p => p.type === t)) continue;
    const cand = scored.find(i => i.type === t && !seenCityCountry.has(`${i.city.toLowerCase()}|${i.country.toLowerCase()}`));
    if (cand) { pushIfNew(cand); if (picked.length === 5) break; }
  }

  // Pass 3: fill remaining up to 5 by score
  for (const it of scored) {
    if (picked.length === 5) break;
    pushIfNew(it);
  }

  return picked.slice(0,5);
}

/* ================= Core generators ================= */

async function generateHighlights(origin, p, excludes = []) {
  const raw = Number(p?.flight_time_hours);
  const userHours = Math.min(Math.max(Number.isFinite(raw) ? raw : 8, 1), 20);
  const limit = userHours + 2;

  // Seed to vary ordering: origin + hours + first interest + current hour bucket
  const seed = `${origin}|${userHours}|${(p?.interests && p.interests[0]) || ''}|${Math.floor(Date.now()/3600000)}`;

  if (!process.env.OPENAI_API_KEY) {
    const sample = [
      { city:'Valencia', country:'Spain', type:'city',  approx_nonstop_hours:2.5, summary:'Beachy city with paella & modernism', highlights:['Ciudad de las Artes','La Pepica paella','El Cabanyal tiles'] },
      { city:'Dubrovnik',country:'Croatia',type:'city', approx_nonstop_hours:2.8, summary:'Walled old town & Adriatic views',   highlights:['City Walls loop','Srđ cable car','Sea kayak caves'] },
      { city:'Palermo',  country:'Italy',  type:'city',  approx_nonstop_hours:3.0, summary:'Markets, mosaics, Arab–Norman mix', highlights:['Ballarò market','Cappella Palatina','Via Maqueda cannoli'] },
      { city:'Funchal',  country:'Portugal (Madeira)', type:'nature', approx_nonstop_hours:3.9, summary:'Levadas & gardens', highlights:['Monte cable car','25 Fontes levada','Mercado dos Lavradores'] },
      { city:'Málaga',   country:'Spain',  type:'beach', approx_nonstop_hours:2.7, summary:'Museums & tapas culture',           highlights:['Alcazaba ramparts','Picasso Museum','Calle Larios tapas'] },
      { city:'Corfu',    country:'Greece', type:'beach', approx_nonstop_hours:3.2, summary:'Ionian beaches & old town',         highlights:['Old Fortress','Paleokastritsa','Liston esplanade'] },
      { city:'Innsbruck',country:'Austria',type:'nature',approx_nonstop_hours:2.0, summary:'Alpine views & hiking',             highlights:['Nordkette cable car','Old Town arcades','Bergisel Ski Jump'] },
      { city:'Catania',  country:'Italy',  type:'city',  approx_nonstop_hours:3.3, summary:'Sicilian baroque & Etna gateway',   highlights:['Piazza del Duomo','La Pescheria market','Via Etnea stroll'] },
      { city:'Nice',     country:'France', type:'beach', approx_nonstop_hours:2.0, summary:'Riviera promenades & markets',      highlights:['Promenade des Anglais','Cours Saleya','Castle Hill view'] },
    ];
    return withMeta({ top5: pickTop5FromCandidates(sample, limit, excludes, seed) }, { mode:'sample' });
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
  const top5 = pickTop5FromCandidates(cands, limit, excludes, seed);

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

    // Optional explicit excludes from client (e.g., last shown cities)
    const excludes = Array.isArray(body?.exclude) ? body.exclude : [];

    if (build?.city) {
      const res = await generateItinerary(STRIP(build.city), STRIP(build.country || ''), p);
      return NextResponse.json(res);
    }

    const res = await generateHighlights(origin, p, excludes);

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
