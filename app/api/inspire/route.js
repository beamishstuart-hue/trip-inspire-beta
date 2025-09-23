// app/api/inspire/route.js
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const PRIMARY = 'gpt-4o-mini';
const FALLBACK = 'gpt-4o';
const OPENAI_TIMEOUT_MS = 18000; // keep timeouts so we never hang

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

async function callOpenAI(messages, model, max_tokens=1200, temperature=0.92, timeoutMs=OPENAI_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort('timeout'), timeoutMs);
  try {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      signal: ctrl.signal,
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
  } finally {
    clearTimeout(t);
  }
}

function tryParse(text) {
  try { return JSON.parse(text); } catch {}
  const m = text && String(text).match(/\{[\s\S]*\}$/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

/* =============== Region bands (balance long-haul vs Europe) ================= */

const EUROPE_NAMES = new Set(['europe','western_europe','central_europe','southern_europe','northern_europe','eastern_europe']);

function regionPolicyForHours(userHours) {
  if (userHours >= 8) {
    return {
      minHours: Math.max(6, Math.floor(userHours * 0.65)),
      priorityRegions: ['north_america','caribbean','middle_east','east_africa','indian_ocean'],
      maxEuropeInTop5: 3,   // was 2 → allow up to 3 Europe
      minPriorityInTop5: 2  // was 3 → require only 2 long-haul priority
    };
  }
  if (userHours >= 7) {
    return {
      minHours: 6,
      priorityRegions: ['middle_east','east_africa','caucasus'],
      maxEuropeInTop5: 3,   // was 3 (same)
      minPriorityInTop5: 1  // was 2 → ease up
    };
  }
  if (userHours >= 6) {
    return {
      minHours: 5,
      priorityRegions: ['north_africa','atlantic_islands'],
      maxEuropeInTop5: 4,
      minPriorityInTop5: 1  // was 2 → ease up
    };
  }
  return { minHours: 0, priorityRegions: [], maxEuropeInTop5: 5, minPriorityInTop5: 0 };
}

/* ================ Prompts ================= */

function buildHighlightsPrompt(origin, p, bufferHours, excludes, regionPolicy) {
  const raw = Number(p?.flight_time_hours);
  const userHours = Math.min(Math.max(Number.isFinite(raw) ? raw : 8, 1), 20);
  const limit = userHours + bufferHours; // now 1.5h

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

  const pri = regionPolicy.priorityRegions.join(', ') || 'no special priority';
  const bandLine = regionPolicy.minHours > 0
    ? `Prefer candidates clustered in the ${regionPolicy.minHours}–${limit}h band. Include AT LEAST ${Math.max(6, regionPolicy.minPriorityInTop5)*2} candidates with approx_nonstop_hours ≥ ${regionPolicy.minHours}h.`
    : `Prefer flights up to ~${limit}h.`;

  const REGION_ENUM = [
    'europe','north_africa','atlantic_islands','middle_east','east_africa','indian_ocean',
    'north_america','caribbean','central_america','south_america','south_asia','southeast_asia','east_asia','oceania','caucasus'
  ].join('|');

  return [
`You are Trip Inspire. Origin airport: ${origin}.`,
`Return JSON ONLY in this exact shape:
{"candidates":[
  {"city":"...","country":"...","region":"${REGION_ENUM}","type":"city|beach|nature|culture","approx_nonstop_hours":7,
   "summary":"1–2 lines","highlights":["...", "...", "..."] }
  // 16 items total
]}`,
`Constraints:
- Non-stop flight time must be ≤ ~${limit}h from ${origin}. Provide your best estimate in "approx_nonstop_hours".
- ${bandLine}
- Priority regions: ${pri}. Label each item with a "region" from the enum above.
- Travellers: ${groupTxt}. Interests: ${interestsTxt}. Season: ${seasonTxt}.
- Cover AT LEAST 6 different countries across the candidates.
- Aim for a mix of types: city, beach/coast, nature/outdoors where relevant.
- Avoid overused picks like Lisbon, Barcelona, Porto, Paris, Rome, Amsterdam unless uniquely suited.
- Each "highlights" array has EXACTLY 3 concise, specific items with named anchors + one micro-detail (dish/view/sound).
${excludeLine}
- Do not include places in restricted countries/cities if asked to exclude them.`,
`Style: No prose outside JSON. Keep "summary" snappy and concrete.`
  ].filter(Boolean).join('\n');
}

/* ================ Itinerary prompt ================= */

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

/* ================ Selection (soften short-haul penalty; cap Europe gently) ================= */

const AVOID = new Set([
  'lisbon','barcelona','porto','paris','rome','amsterdam','london','madrid','athens','venice',
  'florence','berlin','prague','vienna','budapest','dublin'
]);
const DOWNRANK = new Set(['valencia','catania','dubrovnik','nice']);

const RECENT_MAX = 30;
const RECENT = [];
const RECENT_SET = new Set();
function noteRecent(city, country) {
  const key = `${city.toLowerCase()}|${country.toLowerCase()}`;
  if (RECENT_SET.has(key)) return;
  RECENT.push(key); RECENT_SET.add(key);
  while (RECENT.length > RECENT_MAX) {
    const old = RECENT.shift(); if (old) RECENT_SET.delete(old);
  }
}

function parseCandidates(parsedObj) {
  if (Array.isArray(parsedObj?.candidates)) return parsedObj.candidates;
  if (Array.isArray(parsedObj?.top5)) return parsedObj.top5; // fallback
  return [];
}
function seededJitter(seedStr, i) {
  let h = 2166136261; const s = (seedStr + '|' + i);
  for (let c = 0; c < s.length; c++) { h ^= s.charCodeAt(c); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 4000) / 100000 - 0.02;
}

function pickTop5FromCandidates(cands, limitHours, excludes = [], seed = 'x', regionPolicy) {
  const excludeSet = new Set((Array.isArray(excludes)?excludes:[]).map(x => STRIP(x).toLowerCase()));
  const cleaned = (Array.isArray(cands) ? cands : []).map(x => {
    const hours = Number(x.approx_nonstop_hours);
    const region = STRIP((x.region || '').toString()).toLowerCase();
    return {
      city: STRIP(x.city),
      country: STRIP(x.country),
      region,
      type: STRIP(x.type || '').toLowerCase(),
      approx_nonstop_hours: Number.isFinite(hours) ? hours : null,
      summary: STRIP(x.summary || ''),
      highlights: Array.isArray(x.highlights) ? x.highlights.slice(0,3).map(STRIP) : []
    };
  }).filter(x =>
    x.city && x.country && x.highlights.length === 3
  );

  // Hard filters
  let hard = cleaned.filter(x => {
    const cityLc = x.city.toLowerCase();
    const key = `${cityLc}|${x.country.toLowerCase()}`;
    if (isRestricted(x)) return false;
    if (AVOID.has(cityLc)) return false;
    if (excludeSet.has(cityLc) || excludeSet.has(key)) return false;
    if (x.approx_nonstop_hours != null && x.approx_nonstop_hours > limitHours) return false;
    return true;
  });

  const unknownHours = cleaned.filter(x => x.approx_nonstop_hours == null);

  // Score with long-haul and region preferences (softer short-haul penalty)
  const scored = hard.map((it, i) => {
    const cityLc = it.city.toLowerCase();
    const key = `${cityLc}|${it.country.toLowerCase()}`;
    let score = 1.0;

    if (regionPolicy.minHours > 0) {
      const h = it.approx_nonstop_hours ?? 0;
      if (h >= regionPolicy.minHours) score += 0.10; else score -= 0.12; // was -0.25
    }
    if (regionPolicy.priorityRegions.includes(it.region)) score += 0.12;

    if (DOWNRANK.has(cityLc)) score -= 0.15;
    if (RECENT_SET.has(key)) score -= 0.2;
    if (it.approx_nonstop_hours == null) score -= 0.05;

    score += seededJitter(seed, i);
    return { ...it, _score: score };
  }).sort((a, b) => b._score - a._score);

  // Greedy selection: priority quota, country diversity, gentle Europe cap
  const picked = [];
  const seenCityCountry = new Set();
  const seenCountry = new Set();

  const pushIfNew = (it) => {
    const key = `${it.city.toLowerCase()}|${it.country.toLowerCase()}`;
    if (seenCityCountry.has(key)) return false;
    // Europe cap (now looser via regionPolicy)
    if (EUROPE_NAMES.has((it.region||'').toLowerCase())) {
      const europeCount = picked.filter(p => EUROPE_NAMES.has(p.region)).length;
      if (europeCount >= (regionPolicy.maxEuropeInTop5 ?? 5)) return false;
    }
    picked.push(it);
    seenCityCountry.add(key);
    seenCountry.add(it.country.toLowerCase());
    noteRecent(it.city, it.country);
    return true;
  };

  // 1) Priority region quota first (long-haul bias but lighter)
  for (const it of scored) {
    if (picked.length >= regionPolicy.minPriorityInTop5) break;
    if (regionPolicy.priorityRegions.includes(it.region)) pushIfNew(it);
  }

  // 2) Country diversity
  for (const it of scored) {
    if (picked.length >= 5) break;
    if (!seenCountry.has(it.country.toLowerCase())) pushIfNew(it);
  }

  // 3) Fill to 5 by best score (respecting Europe cap)
  for (const it of scored) {
    if (picked.length >= 5) break;
    pushIfNew(it);
  }

  // Relaxations to guarantee 5
  if (picked.length < 5) {
    for (const it of scored) { // ignore Europe cap if needed
      if (picked.length >= 5) break;
      const key = `${it.city.toLowerCase()}|${it.country.toLowerCase()}`;
      if (seenCityCountry.has(key)) continue;
      picked.push(it); seenCityCountry.add(key); seenCountry.add(it.country.toLowerCase()); noteRecent(it.city, it.country);
    }
  }
  if (picked.length < 5) {
    for (const it of unknownHours) {
      if (picked.length >= 5) break;
      const key = `${it.city.toLowerCase()}|${it.country.toLowerCase()}`;
      if (seenCityCountry.has(key)) continue;
      picked.push(it); seenCityCountry.add(key); seenCountry.add(it.country.toLowerCase()); noteRecent(it.city, it.country);
    }
  }
  if (picked.length < 5) {
    for (const it of cleaned) {
      if (picked.length >= 5) break;
      const key = `${it.city.toLowerCase()}|${it.country.toLowerCase()}`;
      if (seenCityCountry.has(key)) continue;
      picked.push(it); seenCityCountry.add(key); seenCountry.add(it.country.toLowerCase()); noteRecent(it.city, it.country);
    }
  }

  return picked.slice(0,5);
}

/* ================= Fallback candidate pool (used on timeout/errors) ================= */

function fallbackCandidates(origin, userHours) {
  return [
    // Europe
    { city:'Reykjavik', country:'Iceland', region:'europe', type:'nature', approx_nonstop_hours:3.0, summary:'Geothermal sights', highlights:['Blue Lagoon','Golden Circle','Hallgrímskirkja'] },
    { city:'Porto', country:'Portugal', region:'europe', type:'city', approx_nonstop_hours:2.0, summary:'Ribeira & vinho do Porto', highlights:['Dom Luís I Bridge','Livraria Lello','Francesinha'] },
    { city:'Seville', country:'Spain', region:'europe', type:'city', approx_nonstop_hours:2.5, summary:'Moorish palaces & tapas', highlights:['Alcázar','Plaza de España','Triana tapas'] },

    // North Africa / Atlantic Islands (6h band)
    { city:'Marrakech', country:'Morocco', region:'north_africa', type:'city', approx_nonstop_hours:3.5, summary:'Souks & riads', highlights:['Jemaa el-Fnaa','Jardin Majorelle','Bahia Palace'] },
    { city:'Tenerife', country:'Spain (Canaries)', region:'atlantic_islands', type:'beach', approx_nonstop_hours:4.5, summary:'Volcano views & beaches', highlights:['Teide cable car','Los Gigantes','Playa del Duque'] },
    { city:'Sal', country:'Cape Verde', region:'atlantic_islands', type:'beach', approx_nonstop_hours:6.0, summary:'Year-round sun & kitesurf', highlights:['Santa Maria','Kite Beach','Salt pans'] },

    // Middle East / East Africa (7h band)
    { city:'Dubai', country:'UAE', region:'middle_east', type:'city', approx_nonstop_hours:7.0, summary:'Skyline, desert, winter sun', highlights:['Burj Khalifa','Madinat Jumeirah','Desert dunes'] },
    { city:'Muscat', country:'Oman', region:'middle_east', type:'nature', approx_nonstop_hours:7.5, summary:'Coast, wadis, forts', highlights:['Mutrah Corniche','Wadi Shab','Nizwa Fort'] },

    // North America / Caribbean (8–10h band)
    { city:'New York', country:'USA', region:'north_america', type:'city', approx_nonstop_hours:7.5, summary:'Culture & food', highlights:['High Line','Broadway','Brooklyn pizza'] },
    { city:'Montreal', country:'Canada', region:'north_america', type:'city', approx_nonstop_hours:6.5, summary:'Bilingual culture', highlights:['Old Montreal','Mount Royal','Bagels'] },
    { city:'Barbados', country:'Barbados', region:'caribbean', type:'beach', approx_nonstop_hours:8.5, summary:'Caribbean beaches & rum', highlights:['Carlisle Bay','Oistins','Harrison’s Cave'] },
  ];
}

/* ================= Core generators ================= */

async function generateHighlights(origin, p, excludes = []) {
  const raw = Number(p?.flight_time_hours);
  const userHours = Math.min(Math.max(Number.isFinite(raw) ? raw : 8, 1), 20);
  const regionPolicy = regionPolicyForHours(userHours);
  const limit = userHours + 1.5; // <<< 90-minute buffer

  const seed = `${origin}|${userHours}|${(p?.interests && p.interests[0]) || ''}|${Math.floor(Date.now()/3600000)}`;

  // No key → curated fallback
  if (!process.env.OPENAI_API_KEY) {
    const cands = fallbackCandidates(origin, userHours);
    const top5 = pickTop5FromCandidates(cands, limit, excludes, seed, regionPolicy);
    return withMeta({ top5 }, { mode:'sample' });
  }

  const sys = { role:'system', content:'Return JSON only. Include a valid "region" from the enum; include "approx_nonstop_hours".' };
  const usr = { role:'user', content: buildHighlightsPrompt(origin, p, 1.5, excludes, regionPolicy) }; // <<< 90-minute buffer in prompt

  let parsed = null;
  try {
    let content = await callOpenAI([sys, usr], PRIMARY, 1200, 0.92);
    parsed = tryParse(content) || null;
    if (!parsed) {
      content = await callOpenAI([sys, usr], FALLBACK, 1200, 0.92);
      parsed = tryParse(content) || null;
    }
  } catch {}

  let cands = parsed ? parseCandidates(parsed) : [];
  if (!Array.isArray(cands) || cands.length === 0) cands = fallbackCandidates(origin, userHours);

  const top5 = pickTop5FromCandidates(cands, limit, excludes, seed, regionPolicy);
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

  let parsed = null;
  try {
    let content = await callOpenAI([sys, usr], PRIMARY, 1100, 0.55);
    parsed = tryParse(content) || null;
    if (!parsed) {
      content = await callOpenAI([sys, usr], FALLBACK, 1100, 0.55);
      parsed = tryParse(content) || null;
    }
  } catch {}

  let days = Array.isArray(parsed?.days) ? parsed.days.slice(0, want) : [];
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
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req) {
  let body = null;
  try {
    body = await req.json();
    const origin = body?.origin || 'LHR';
    const p = body?.preferences || {};
    const build = body?.buildItineraryFor;
    const excludes = Array.isArray(body?.exclude) ? body.exclude : [];

    if (build?.city) {
      const res = await generateItinerary(STRIP(build.city), STRIP(build.country || ''), p);
      return NextResponse.json(res, { headers: { 'Cache-Control': 'no-store' } });
    }

    const res = await generateHighlights(origin, p, excludes);
    const top5Safe = (Array.isArray(res.top5) ? res.top5 : []).filter(d => !isRestricted(d));

    return NextResponse.json({ ...res, top5: top5Safe }, { headers: { 'Cache-Control': 'no-store' } });

  } catch (err) {
    console.error('API ERROR:', {
      message: err?.message,
      stack: err?.stack,
      bodySummary: body ? {
        hasPrefs: !!body?.preferences,
        hasBuildItineraryFor: !!body?.buildItineraryFor,
      } : null
    });

    // Error fallback (still honors 90-min buffer and region policy)
    const p = body?.preferences || {};
    const raw = Number(p?.flight_time_hours);
    const userHours = Math.min(Math.max(Number.isFinite(raw) ? raw : 8, 1), 20);
    const regionPolicy = regionPolicyForHours(userHours);
    const limit = userHours + 1.5;
    const cands = fallbackCandidates('LHR', userHours);
    const seed = `err|${Date.now()}`;
    const top5 = pickTop5FromCandidates(cands, limit, [], seed, regionPolicy);

    return NextResponse.json({ meta:{ mode:'error-fallback', error: err?.message || 'unknown' }, top5 }, { status: 200 });
  }
}
