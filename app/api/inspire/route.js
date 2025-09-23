// app/api/inspire/route.js
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const PRIMARY = 'gpt-4o-mini';
const FALLBACK = 'gpt-4o';
const OPENAI_TIMEOUT_MS = 10000; // fast, prevents timeouts

/* ================= SAFETY FILTER (countries & specific cities) ================ */
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

/* ================= Flight-time policy =================
   One uniform buffer (30m). Region floors prevent obvious underestimates. */
const TIME_BUFFER = 0.5;

const REGION_ENUM = [
  'europe','north_africa','atlantic_islands','middle_east','east_africa','indian_ocean',
  'north_america','caribbean','central_america','south_america','south_asia',
  'southeast_asia','east_asia','oceania','caucasus'
];

const MIN_HOURS_BY_REGION = {
  europe: 0,
  north_africa: 3.7,        // LHR–RAK/CMN ~3.7–4.2
  atlantic_islands: 3.8,    // Madeira/Canaries ~3.8–4.5
  middle_east: 5.8,         // Dubai/Doha/Abu Dhabi ≥ ~6–7
  east_africa: 7.0,
  indian_ocean: 9.0,
  north_america: 6.5,
  caribbean: 7.5,
  central_america: 9.0,
  south_america: 10.0,
  south_asia: 8.0,
  southeast_asia: 11.5,
  east_asia: 10.0,
  oceania: 16.0,
  caucasus: 4.5
};

function clampHoursByRegion(hours, region) {
  if (!Number.isFinite(hours)) return hours;
  const floor = MIN_HOURS_BY_REGION[region] ?? 0;
  return Math.max(hours, floor);
}

/* ================= OpenAI helper ================= */
async function callOpenAI(messages, model, max_tokens=800, temperature=0.35, timeoutMs=OPENAI_TIMEOUT_MS) {
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
  } finally { clearTimeout(t); }
}

function tryParse(text) {
  try { return JSON.parse(text); } catch {}
  const m = text && String(text).match(/\{[\s\S]*\}$/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

/* ================= Canonical interests (for scoring) ================= */
const CANON_MAP = [
  [/beach|beaches|coast|island/i, 'beach'],
  [/nature|hiking|outdoors|national park|alps|mountain|lakes/i, 'nature'],
  [/city|urban|architecture|design/i, 'city'],
  [/history|heritage|unesco/i, 'history'],
  [/museum|gallery|art/i, 'museums'],
  [/performing\s*arts|theatre|theater|opera|ballet|concert/i, 'performing_arts'],
  [/food|cuisine|restaurant|gastronomy|tapas|street\s*food/i, 'food'],
  [/wine|vineyard|winery/i, 'wine'],
  [/nightlife|bars|clubs/i, 'nightlife'],
  [/shopping|markets|bazaar|souq/i, 'shopping'],
  [/wellness|spa|thermal|hot\s*spring/i, 'wellness'],
  [/family|kids/i, 'family'],
  [/luxury|five\s*star/i, 'luxury'],
  [/budget|cheap|value/i, 'budget'],
  [/diving|snorkel/i, 'diving'],
  [/wildlife|safari|whale|bird/i, 'wildlife'],
  [/snow|ski|snowboard/i, 'ski'],
  [/festival|carnival/i, 'festival'],
  [/all[-\s]*inclusive/i, 'all_inclusive'],
];

function canonizeInterests(list) {
  const out = new Set();
  for (const raw of (Array.isArray(list) ? list : [])) {
    const s = String(raw);
    for (const [re, tag] of CANON_MAP) if (re.test(s)) out.add(tag);
  }
  return out;
}

/* ================= Prompt (compact, quiz-led) ================= */
function buildCandidatesPrompt(origin, prefs, limit) {
  const groupTxt =
    prefs?.group === 'family' ? 'family with kids' :
    prefs?.group === 'friends' ? 'group of friends' :
    prefs?.group === 'couple' ? 'couple' : 'solo traveler';

  const interestsTxt = Array.isArray(prefs?.interests) && prefs.interests.length
    ? prefs.interests.join(', ')
    : 'surprise me';

  const seasonTxt =
    prefs?.season === 'spring' ? 'Spring (Mar–May)' :
    prefs?.season === 'summer' ? 'Summer (Jun–Aug)' :
    prefs?.season === 'autumn' ? 'Autumn (Sep–Nov)' :
    prefs?.season === 'winter' ? 'Winter (Dec–Feb)' : 'Any season';

  const regionEnumStr = REGION_ENUM.join('|');

  return [
`You are Trip Inspire. Origin: ${origin}. User: ${groupTxt}. Interests: ${interestsTxt}. Season: ${seasonTxt}.`,
`Return JSON ONLY:
{"candidates":[
  {"city":"...","country":"...","region":"${regionEnumStr}","type":"city|beach|nature|culture",
   "themes":["beach","nature","museums","performing_arts","history","food","wine","nightlife","shopping","wellness","family","luxury","budget","diving","wildlife","ski","festival","all_inclusive"],
   "best_seasons":["spring","summer","autumn","winter"],
   "approx_nonstop_hours": 3.2,
   "summary":"1–2 lines that directly show fit to this user",
   "highlights":[
     "<12–22 word sentence naming a place and a vivid micro-detail>",
     "<12–22 word sentence naming a place and a vivid micro-detail>",
     "<12–22 word sentence naming a place and a vivid micro-detail>"
   ]
  }
  // 12–16 items total
]}`,
`Hard limits:
- Non-stop flight time must be ≤ ${limit.toFixed(1)} hours from ${origin} (absolute cap).
- "approx_nonstop_hours" must be conservative and rounded UP to one decimal place.
- All items must be genuine matches to the user’s interests/season/group; reflect this in summary/highlights.
- No prose outside the JSON.`
  ].join('\n');
}

/* ================= Fallbacks (small, sentence style) ================= */
function fallbackShorthaulEU() {
  return [
    { city:'Cagliari', country:'Italy', region:'europe', type:'beach',
      themes:['beach','food','history'], best_seasons:['spring','summer','autumn'], approx_nonstop_hours:2.5,
      summary:'Sandy coves, Phoenician ruins, and seafood trattorias',
      highlights:[
        'Swim off Poetto’s long crescent before a sunset spritz on the marina promenade.',
        'Climb Castello ramparts for lagoon views dotted with wading flamingos.',
        'Share fregola with clams in a family trattoria near Via Sardegna.'
      ]},
    { city:'Split', country:'Croatia', region:'europe', type:'beach',
      themes:['beach','history','nightlife'], best_seasons:['spring','summer','autumn'], approx_nonstop_hours:2.5,
      summary:'Roman palace lanes and island-hopping ferries',
      highlights:[
        'Wander Diocletian’s arcades as church bells echo off pale stone.',
        'Ferry to Pakleni coves for pine shade and glass-clear shallows.',
        'Toast with chilled Pošip on the Riva while yachts bob offshore.'
      ]},
    { city:'Copenhagen', country:'Denmark', region:'europe', type:'city',
      themes:['city','design','food','museums'], best_seasons:['spring','summer','autumn'], approx_nonstop_hours:2.0,
      summary:'Harborside design, bike lanes, and New Nordic dining',
      highlights:[
        'Cycle past Nyhavn’s pastels, then smørrebrød and beer by the quay.',
        'Tour Designmuseum Danmark’s clean lines before a hygge café stop.',
        'Watch copper spires glow from Christiansborg Tower at sunset.'
      ]},
    { city:'Madeira (Funchal)', country:'Portugal', region:'atlantic_islands', type:'nature',
      themes:['nature','hiking','beach'], best_seasons:['spring','summer','autumn','winter'], approx_nonstop_hours:3.9,
      summary:'Levadas, cloud forests, and ocean viewpoints',
      highlights:[
        'Walk the 25 Fontes levada through laurel forest to fern-fringed falls.',
        'Ride the Monte cable car, then wicker toboggan down cobbled lanes.',
        'Watch waves hammer São Lourenço cliffs from a windy headland.'
      ]},
    { city:'Valencia', country:'Spain', region:'europe', type:'city',
      themes:['city','beach','food'], best_seasons:['spring','summer','autumn'], approx_nonstop_hours:2.3,
      summary:'Beachside modernism, paella traditions, and neighborhood markets',
      highlights:[
        'Wander Calatrava’s City of Arts before horchata under shady colonnades.',
        'Eat paella by the sand at La Pepica after a boardwalk stroll.',
        'Browse Central Market’s citrus pyramids and jamón counters.'
      ]}
  ];
}
function fallbackMixed() {
  return [
    { city:'Marrakech', country:'Morocco', region:'north_africa', type:'city',
      themes:['city','markets','food','history'], best_seasons:['autumn','winter','spring'], approx_nonstop_hours:3.9,
      summary:'Souks, gardens, riads, and Atlas foothills',
      highlights:[
        'Watch snake charmers spark Jemaa el-Fnaa as drums quicken at sunset.',
        'Wander Jardin Majorelle’s cobalt paths between cacti and bamboo.',
        'Share rooftop tagines as the call to prayer drifts over terracotta roofs.'
      ]},
    { city:'New York', country:'USA', region:'north_america', type:'city',
      themes:['city','museums','performing_arts','food','shopping'], best_seasons:['spring','autumn','winter','summer'], approx_nonstop_hours:7.5,
      summary:'Iconic culture, neighborhoods, and bites',
      highlights:[
        'Stroll the High Line’s wildflowers to Hudson views and Chelsea galleries.',
        'Catch a Broadway matinee, then late jazz in a Village basement club.',
        'Ride the ferry for skyline shots and a breezy harbor loop.'
      ]},
    { city:'Barbados', country:'Barbados', region:'caribbean', type:'beach',
      themes:['beach','snorkeling','food','relaxation'], best_seasons:['winter','spring'], approx_nonstop_hours:8.5,
      summary:'Caribbean coves, rum shops, and reef snorkeling',
      highlights:[
        'Snorkel with turtles in gin-clear Carlisle Bay before rum punch at dusk.',
        'Join Friday fish fry at Oistins as grills smoke and steel pans ring.',
        'Descend into Harrison’s Cave to shimmering stalactites and streams.'
      ]},
    { city:'Reykjavik', country:'Iceland', region:'europe', type:'nature',
      themes:['nature','hot springs','museums'], best_seasons:['winter','spring','autumn','summer'], approx_nonstop_hours:3.0,
      summary:'Geothermal sights and modern Nordic culture',
      highlights:[
        'Float in the Blue Lagoon’s milky waters amid steam and black lava fields.',
        'Drive the Golden Circle for thundering Gullfoss and erupting Geysir.',
        'Climb Hallgrímskirkja’s tower over colorful tin-roofed streets.'
      ]},
    { city:'Muscat', country:'Oman', region:'middle_east', type:'nature',
      themes:['nature','beach','history'], best_seasons:['winter','spring'], approx_nonstop_hours:7.3,
      summary:'Coastline forts, wadis, and desert mountains',
      highlights:[
        'Walk Mutrah Corniche at dusk, frankincense drifting from the souq.',
        'Hike Wadi Shab’s turquoise pools beneath limestone walls and palms.',
        'Explore Nizwa Fort’s battlements before a coastal swim at Qantab.'
      ]}
  ];
}

/* ================= Scoring (simple, quiz-led; no arbitrary gates) ================= */
function normalizeCandidates(raw) {
  return (Array.isArray(raw) ? raw : []).map(x => {
    const region = STRIP((x.region || '').toString()).toLowerCase();
    const h = Number(x.approx_nonstop_hours);
    const hours = Number.isFinite(h) ? clampHoursByRegion(h, region) : null;

    return {
      city: STRIP(x.city),
      country: STRIP(x.country),
      region,
      type: STRIP(x.type || '').toLowerCase(),
      themes: Array.isArray(x.themes) ? x.themes.map(STRIP).map(s => s.toLowerCase()) : [],
      best_seasons: Array.isArray(x.best_seasons) ? x.best_seasons.map(STRIP).map(s => s.toLowerCase()) : [],
      approx_nonstop_hours: hours,
      summary: STRIP(x.summary || ''),
      highlights: Array.isArray(x.highlights) ? x.highlights.map(STRIP) : []
    };
  }).filter(c => c.city && c.country && !isRestricted(c));
}

function scoreCandidate(c, prefs, limit, canonInterests) {
  // Hard cap
  const h = c.approx_nonstop_hours;
  if (h != null && h > limit) return -Infinity;

  // Interest fit
  let hits = 0;
  for (const t of canonInterests) if (c.themes.includes(t)) hits++;
  const interestScore = canonInterests.size ? (hits / canonInterests.size) : 0.3;

  // Extra boost for beach interest + beach type/theme
  const beachBoost = canonInterests.has('beach') && (c.type === 'beach' || c.themes.includes('beach')) ? 0.3 : 0;

  // Season fit
  const season = String(prefs?.season || '').toLowerCase();
  const seasonFit = season && c.best_seasons.includes(season) ? 0.15 : 0;

  // Group hints (light)
  const groupFit =
    prefs?.group === 'family' && c.themes.includes('family') ? 0.1 :
    prefs?.group === 'friends' && c.themes.includes('nightlife') ? 0.05 :
    prefs?.group === 'couple'  && (c.themes.includes('luxury') || c.themes.includes('wellness')) ? 0.05 : 0;

  // Slight preference for being within 70–100% of cap
  let hoursFit = 0;
  if (Number.isFinite(h)) {
    const pct = h / limit;
    if (pct >= 0.7 && pct <= 1.0) hoursFit = 0.05;
  }

  // Validate highlights (penalize if missing)
  const highlightsOk = Array.isArray(c.highlights) && c.highlights.length >= 3;
  const highlightPenalty = highlightsOk ? 0 : -0.2;

  return 1.0 + 1.0*interestScore + beachBoost + seasonFit + groupFit + hoursFit + highlightPenalty;
}

function pickTop5(cands, prefs, limit, excludes=[]) {
  const excludeSet = new Set((Array.isArray(excludes) ? excludes : []).map(s => STRIP(s).toLowerCase()));
  const canonInterests = canonizeInterests(prefs?.interests);

  // Filter by cap/excludes and ensure at least one interest match when interests provided
  let pool = normalizeCandidates(cands).filter(c => {
    if (excludeSet.has(c.city.toLowerCase())) return false;
    const key = `${c.city.toLowerCase()}|${c.country.toLowerCase()}`;
    if (excludeSet.has(key)) return false;
    if (c.approx_nonstop_hours != null && c.approx_nonstop_hours > limit) return false;
    if (canonInterests.size) {
      const anyHit = c.themes.some(t => canonInterests.has(t));
      if (!anyHit) return false; // enforce at least one thematic match
    }
    return true;
  });

  // Score and sort
  const scored = pool.map(c => ({ c, s: scoreCandidate(c, prefs, limit, canonInterests) }))
                     .filter(x => x.s > -Infinity)
                     .sort((a, b) => b.s - a.s);

  // Country diversity cap: max 2 per country (but allow fill later)
  const picked = [];
  const perCountry = new Map();
  for (const { c } of scored) {
    const cnt = perCountry.get(c.country.toLowerCase()) || 0;
    if (cnt >= 2) continue;
    picked.push(c);
    perCountry.set(c.country.toLowerCase(), cnt + 1);
    if (picked.length === 5) break;
  }

  // Ensure at least one BEAC H when requested
  if (canonInterests.has('beach') && !picked.some(p => p.type === 'beach' || p.themes.includes('beach'))) {
    const beachCand = scored.find(({ c }) =>
      (c.type === 'beach' || c.themes.includes('beach')) &&
      !picked.find(p => p.city === c.city && p.country === c.country)
    );
    if (beachCand) {
      if (picked.length === 5) picked.pop();
      picked.push(beachCand.c);
    }
  }

  // If fewer than 5 (model under-delivered), allow same-country to fill
  if (picked.length < 5) {
    for (const { c } of scored) {
      if (picked.find(p => p.city === c.city && p.country === c.country)) continue;
      picked.push(c);
      if (picked.length === 5) break;
    }
  }

  // Final repair of highlights (rare)
  for (const p of picked) {
    if (!Array.isArray(p.highlights) || p.highlights.length < 3) {
      const need = 3 - (Array.isArray(p.highlights) ? p.highlights.length : 0);
      const fill = [];
      for (let i = 0; i < need; i++) {
        fill.push(`Visit a signature spot in ${p.city} aligned to your selected interests this season.`);
      }
      p.highlights = (p.highlights || []).concat(fill).slice(0,3);
    }
  }

  return picked.slice(0,5);
}

/* ================= Core generation ================= */
async function generateHighlights(origin, prefs, excludes = []) {
  const raw = Number(prefs?.flight_time_hours);
  const hours = Math.min(Math.max(Number.isFinite(raw) ? raw : 8, 1), 20);
  const limit = hours + TIME_BUFFER;

  // No key → curated fallback that still respects the cap
  if (!process.env.OPENAI_API_KEY) {
    const fb = hours <= 4.5 ? fallbackShorthaulEU() : fallbackMixed();
    return withMeta({ top5: pickTop5(fb, prefs, limit, excludes) }, { mode:'sample' });
  }

  const prompt = buildCandidatesPrompt(origin, prefs, limit);
  const sys = { role:'system', content:'Return precise JSON only.' };

  let parsed = null;
  try {
    let text = await callOpenAI([sys, { role:'user', content: prompt }], PRIMARY, 800, 0.35);
    parsed = tryParse(text);
    if (!parsed) {
      text = await callOpenAI([sys, { role:'user', content: prompt }], FALLBACK, 800, 0.35);
      parsed = tryParse(text);
    }
  } catch {}

  let cands = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
  if (!cands.length) {
    const fb = hours <= 4.5 ? fallbackShorthaulEU() : fallbackMixed();
    cands = fb;
  }

  const top5 = pickTop5(cands, prefs, limit, excludes);
  return withMeta({ top5 }, { mode: parsed ? 'live' : 'error-fallback' });
}

/* ================= Itinerary (unchanged, concise) ================= */
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
    // one object per day, exactly ${days} total
  ]
}
Rules:
- Use named places/venues/landmarks and 8–14 words per slot.
- Keep travel sensible (clustered areas). No prose outside JSON.
`.trim();
}

async function generateItinerary(city, country, prefs) {
  const want = daysWanted(prefs?.duration);
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

  const sys = { role:'system', content:'Concrete, named places; concise; JSON only.' };
  const usr = { role:'user', content: buildItineraryPrompt(city, country, want, prefs) };

  let parsed = null;
  try {
    let text = await callOpenAI([sys, usr], PRIMARY, 850, 0.45);
    parsed = tryParse(text) || null;
    if (!parsed) {
      text = await callOpenAI([sys, usr], FALLBACK, 850, 0.45);
      parsed = tryParse(text) || null;
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
  return withMeta({ city, country, days }, { mode: parsed ? 'live' : 'error-fallback', wantDays: want });
}

/* ================= Route handlers ================= */
export async function GET() {
  const data = await generateHighlights('LHR', { interests:['Beaches'], group:'couple', season:'summer', flight_time_hours: 4 }, []);
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req) {
  let body = null;
  try {
    body = await req.json();
    const origin = body?.origin || 'LHR';
    const prefs = body?.preferences || {};
    const build = body?.buildItineraryFor;
    const excludes = Array.isArray(body?.exclude) ? body.exclude : [];

    if (build?.city) {
      const res = await generateItinerary(STRIP(build.city), STRIP(build.country || ''), prefs);
      return NextResponse.json(res, { headers: { 'Cache-Control': 'no-store' } });
    }

    const res = await generateHighlights(origin, prefs, excludes);
    const top5Safe = (Array.isArray(res.top5) ? res.top5 : []).filter(d => !isRestricted(d));
    return NextResponse.json({ ...res, top5: top5Safe }, { headers: { 'Cache-Control': 'no-store' } });

  } catch (err) {
    console.error('API ERROR:', {
      message: err?.message,
      stack: err?.stack,
      bodySummary: body ? { hasPrefs: !!body?.preferences, hasBuildItineraryFor: !!body?.buildItineraryFor } : null
    });

    // Final fallback (quick, quiz-led)
    const prefs = body?.preferences || {};
    const raw = Number(prefs?.flight_time_hours);
    const hours = Math.min(Math.max(Number.isFinite(raw) ? raw : 8, 1), 20);
    const limit = hours + TIME_BUFFER;
    const fb = hours <= 4.5 ? fallbackShorthaulEU() : fallbackMixed();
    const top5 = pickTop5(fb, prefs, limit, []);
    return NextResponse.json({ meta:{ mode:'error-fallback', error: err?.message || 'unknown' }, top5 }, { status: 200 });
  }
}
