// app/api/inspire/route.js
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const PRIMARY = 'gpt-4o-mini';
const FALLBACK = 'gpt-4o';
const OPENAI_TIMEOUT_MS = 18000; // never hang the route

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

async function callOpenAI(messages, model, max_tokens=1200, temperature=0.9, timeoutMs=OPENAI_TIMEOUT_MS) {
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

/* =============== Region bands (balanced: Europe allowed + long-haul bias) ================= */

const EUROPE_NAMES = new Set(['europe','western_europe','central_europe','southern_europe','northern_europe','eastern_europe']);

function regionPolicyForHours(userHours) {
  if (userHours >= 8) {
    return {
      minHours: Math.max(6, Math.floor(userHours * 0.65)),
      priorityRegions: ['north_america','caribbean','middle_east','east_africa','indian_ocean'],
      maxEuropeInTop5: 3,
      minPriorityInTop5: 2
    };
  }
  if (userHours >= 7) {
    return {
      minHours: 6,
      priorityRegions: ['middle_east','east_africa','caucasus'],
      maxEuropeInTop5: 3,
      minPriorityInTop5: 1
    };
  }
  if (userHours >= 6) {
    return {
      minHours: 5,
      priorityRegions: ['north_africa','atlantic_islands'],
      maxEuropeInTop5: 4,
      minPriorityInTop5: 1
    };
  }
  return { minHours: 0, priorityRegions: [], maxEuropeInTop5: 5, minPriorityInTop5: 0 };
}

/* ================ Prompt (30-minute buffer + sentence highlights) ================= */

function buildHighlightsPrompt(origin, p, bufferHours, excludes, regionPolicy) {
  const raw = Number(p?.flight_time_hours);
  const userHours = Math.min(Math.max(Number.isFinite(raw) ? raw : 8, 1), 20);
  const limit = userHours + bufferHours; // 0.5h buffer

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

  // Short-haul geographic spread hint (helps diversify Europe at ≤4.5h)
  const euBalanceLine = userHours <= 4.5 ? `For short-haul ranges (≤ ~4.5h), ensure geographic spread: include at least one from Nordics/Baltics, one from Balkans/Eastern Europe, and one from Western Europe outside Iberia/Italy/France.` : '';

  const REGION_ENUM = [
    'europe','north_africa','atlantic_islands','middle_east','east_africa','indian_ocean',
    'north_america','caribbean','central_america','south_america','south_asia','southeast_asia','east_asia','oceania','caucasus'
  ].join('|');

  return [
`You are Trip Inspire. Origin airport: ${origin}.`,
`Return JSON ONLY in this exact shape:
{"candidates":[
  {"city":"...","country":"...","region":"${REGION_ENUM}","type":"city|beach|nature|culture","approx_nonstop_hours":7.0,
   "summary":"1–2 lines","highlights":["<12–22 word sentence>","<12–22 word sentence>","<12–22 word sentence>"] }
  // 18–20 items total
]}`,
`Constraints:
- Non-stop flight time must be ≤ ~${limit}h from ${origin}. This is an absolute cap.
- "approx_nonstop_hours" must be a conservative estimate (round UP to one decimal place, do not underestimate).
- ${bandLine}
- ${euBalanceLine}
- Priority regions: ${pri}. Label each item with a "region" from the enum above.
- Travellers: ${groupTxt}. Interests: ${interestsTxt}. Season: ${seasonTxt}.
- Cover AT LEAST 6 different countries across the candidates.
- Aim for a mix of types: city, beach/coast, nature/outdoors where relevant.
- Avoid overused phrasing; each highlight is one crisp, evocative sentence naming a specific place and a micro-detail (dish/view/sound).
${excludeLine}
- Do not include places in restricted countries/cities if asked to exclude them.`,
`Style: No prose outside JSON. Keep "summary" snappy; each highlight 12–22 words, full sentence.`
  ].filter(Boolean).join('\n');
}

/* ================ Itinerary prompt (unchanged) ================= */

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

/* ================ Selection (Europe allowed; 30-min buffer; short-haul variety) ================= */

// No hard avoid/downrank lists globally.
// For short-haul only, we gently rotate over-exposed EU hotspots.
const EU_POPULAR = new Set([
  'lisbon','barcelona','porto','paris','rome','amsterdam','madrid','athens','venice',
  'florence','prague','vienna','budapest','dublin','valencia','nice','catania','dubrovnik','milan','seville','naples','berlin'
]);

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

// Seeded jitter with adjustable amplitude (bigger jitter for short-haul to create rotation)
function seededJitter(seedStr, i, amp = 0.03) {
  let h = 2166136261; const s = (seedStr + '|' + i);
  for (let c = 0; c < s.length; c++) { h ^= s.charCodeAt(c); h = Math.imul(h, 16777619); }
  // map to [-amp, +amp]
  return (((h >>> 0) % 10000) / 10000 - 0.5) * 2 * amp;
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

  // Hard filters (strict ≤ user + 0.5h)
  let hard = cleaned.filter(x => {
    const cityLc = x.city.toLowerCase();
    const key = `${cityLc}|${x.country.toLowerCase()}`;
    if (isRestricted(x)) return false;
    if (excludeSet.has(cityLc) || excludeSet.has(key)) return false;
    if (x.approx_nonstop_hours != null && x.approx_nonstop_hours > limitHours) return false;
    return true;
  });

  const unknownHours = cleaned.filter(x => x.approx_nonstop_hours == null);

  const isShorthaul = limitHours <= 4.5;        // 4h + 30m buffer
  const jitterAmp   = isShorthaul ? 0.12 : 0.03;

  // Score with gentle long-haul preferences + short-haul rotation
  const scored = hard.map((it, i) => {
    const cityLc = it.city.toLowerCase();
    const key = `${cityLc}|${it.country.toLowerCase()}`;
    let score = 1.0;

    // Long-haul nudges only if we actually asked for them
    if (regionPolicy.minHours > 0) {
      const h = it.approx_nonstop_hours ?? 0;
      if (h >= regionPolicy.minHours) score += 0.10; else score -= 0.10;
      if (regionPolicy.priorityRegions.includes(it.region)) score += 0.10;
    }

    // Short-haul only: gently rotate over-exposed EU hotspots
    if (isShorthaul && EU_POPULAR.has(cityLc)) score -= 0.12;

    // De-dupe per-instance; prefer items with known hours
    if (RECENT_SET.has(key)) score -= 0.18;
    if (it.approx_nonstop_hours == null) score -= 0.05;

    score += seededJitter(seed, i, jitterAmp);
    return { ...it, _score: score };
  }).sort((a, b) => b._score - a._score);

  // Greedy selection: priority quota (if any) → country diversity → fill; respect Europe cap
  const picked = [];
  const seenCityCountry = new Set();
  const seenCountry = new Set();

  const pushIfNew = (it) => {
    const key = `${it.city.toLowerCase()}|${it.country.toLowerCase()}`;
    if (seenCityCountry.has(key)) return false;
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

  // 1) Priority region quota first (only applies when minHours > 0)
  for (const it of scored) {
    if (picked.length >= regionPolicy.minPriorityInTop5) break;
    if (regionPolicy.priorityRegions.includes(it.region)) pushIfNew(it);
  }

  // 2) Country diversity
  for (const it of scored) {
    if (picked.length >= 5) break;
    if (!seenCountry.has(it.country.toLowerCase())) pushIfNew(it);
  }

  // 3) Fill to 5 by best score
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

/* ================= Fallback candidate pool (sentence-style highlights) ================= */

function fallbackCandidates(origin, userHours) {
  return [
    // Europe
    { city:'Reykjavik', country:'Iceland', region:'europe', type:'nature', approx_nonstop_hours:3.0,
      summary:'Geothermal sights and modern Nordic culture',
      highlights:[
        'Float in the Blue Lagoon’s milky geothermal waters before a sunset view over mossy lava fields.',
        'Drive the Golden Circle for thundering Gullfoss and the steamy vents and eruptions at Geysir.',
        'Climb Hallgrímskirkja’s tower for a crisp panorama of colorful tin-roofed streets and harbor.'
      ]},
    { city:'Porto', country:'Portugal', region:'europe', type:'city', approx_nonstop_hours:2.0,
      summary:'Ribeira quarter, Douro cellars, tiled churches',
      highlights:[
        'Cross the Dom Luís I Bridge at golden hour as rabelo boats drift past the pastel riverfront.',
        'Sip a tawny port in a Vila Nova de Gaia lodge, then tour cool, barrel-scented aging cellars.',
        'Browse Livraria Lello’s carved staircases before francesinha sandwiches in a buzzing tasca.'
      ]},
    { city:'Seville', country:'Spain', region:'europe', type:'city', approx_nonstop_hours:2.5,
      summary:'Moorish palaces, plazas, and late-night tapas',
      highlights:[
        'Wander the Alcázar’s citrus courtyards and filigreed arches as fountains echo softly.',
        'Glide around Plaza de España’s tiled alcoves, spotting regional murals under curved colonnades.',
        'Snack on garlicky prawns and crisp croquetas in Triana’s ceramic-fronted bars after dusk.'
      ]},

    // North Africa / Atlantic Islands (~6h band)
    { city:'Marrakech', country:'Morocco', region:'north_africa', type:'city', approx_nonstop_hours:3.7,
      summary:'Souks, gardens, riads, and Atlas foothills',
      highlights:[
        'Watch snake charmers and orange-juice stalls ignite Jemaa el-Fnaa as drums quicken at sunset.',
        'Step into Jardin Majorelle’s cobalt walkways beside pencil-thin cacti and rustling bamboo.',
        'Trade mint tea for rooftop tagines as the call to prayer drifts over terracotta rooftops.'
      ]},

    // Middle East / East Africa (~7h band)
    { city:'Dubai', country:'UAE', region:'middle_east', type:'city', approx_nonstop_hours:7.0,
      summary:'Skyline drama, beaches, and desert escapes',
      highlights:[
        'Rocket up Burj Khalifa for hazy desert horizons and tiny dhows threading the Dubai Creek.',
        'Wind through Madinat Jumeirah’s lantern-lit souk before abra rides past palm-lined canals.',
        'Kick up sand on a sunset dune drive, finishing with grilled lamb and oud music at camp.'
      ]},

    // North America / Caribbean (8–10h band)
    { city:'New York', country:'USA', region:'north_america', type:'city', approx_nonstop_hours:7.5,
      summary:'Iconic culture, neighborhoods, and bites',
      highlights:[
        'Walk the High Line’s wildflower beds to Hudson views, ending with art at Chelsea galleries.',
        'Grab a classic slice in Brooklyn before skyline shots from the ferry’s open upper deck.',
        'Catch a Broadway matinee, then nightcap jazz in a dim Village basement club.'
      ]},
    { city:'Barbados', country:'Barbados', region:'caribbean', type:'beach', approx_nonstop_hours:8.5,
      summary:'Caribbean coves, rum shops, and reef snorkeling',
      highlights:[
        'Snorkel with sea turtles in gin-clear Carlisle Bay before toes-in-sand rum punch at sundown.',
        'Join the Friday fish fry at Oistins as grills smoke, steel pans ring, and locals dance.',
        'Descend into Harrison’s Cave by tram to shimmering stalactites and whispering streams.'
      ]},
  ];
}

/* ================= Core generators ================= */

async function generateHighlights(origin, p, excludes = []) {
  const raw = Number(p?.flight_time_hours);
  const userHours = Math.min(Math.max(Number.isFinite(raw) ? raw : 8, 1), 20);
  const regionPolicy = regionPolicyForHours(userHours);
  const limit = userHours + 0.5; // 30-minute buffer

  // True per-request seed: ensures different picks even if candidates repeat
  const seed = randomUUID();

  if (!process.env.OPENAI_API_KEY) {
    const cands = fallbackCandidates(origin, userHours);
    const top5 = pickTop5FromCandidates(cands, limit, excludes, seed, regionPolicy);
    return withMeta({ top5 }, { mode:'sample' });
  }

  const sys = { role:'system', content:'Return JSON only. Include valid "region" and conservative "approx_nonstop_hours" (rounded up to 0.1h).' };
  const usr = { role:'user', content: buildHighlightsPrompt(origin, p, 0.5, excludes, regionPolicy) };

  let parsed = null;
  try {
    let content = await callOpenAI([sys, usr], PRIMARY, 1200, 0.9);
    parsed = tryParse(content) || null;
    if (!parsed) {
      content = await callOpenAI([sys, usr], FALLBACK, 1200, 0.9);
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

    // Error fallback (still honors 30-min buffer and region policy)
    const p = body?.preferences || {};
    const raw = Number(p?.flight_time_hours);
    const userHours = Math.min(Math.max(Number.isFinite(raw) ? raw : 8, 1), 20);
    const regionPolicy = regionPolicyForHours(userHours);
    const limit = userHours + 0.5;
    const cands = fallbackCandidates('LHR', userHours);
    const seed = randomUUID();
    const top5 = pickTop5FromCandidates(cands, limit, [], seed, regionPolicy);

    return NextResponse.json({ meta:{ mode:'error-fallback', error: err?.message || 'unknown' }, top5 }, { status: 200 });
  }
}
