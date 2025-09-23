// app/api/inspire/route.js
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const PRIMARY = 'gpt-4o-mini';
const FALLBACK = 'gpt-4o';
const TIMEOUT_MS = 10000; // per OpenAI call
const TIME_BUFFER = 0.5;  // 30 minutes

/* ---------------- Safety ---------------- */
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

/* ---------------- Util ---------------- */
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

/* ---------------- Flight-time policy ---------------- */
const REGION_ENUM = [
  'europe','north_africa','atlantic_islands','middle_east','east_africa','indian_ocean',
  'north_america','caribbean','central_america','south_america','south_asia',
  'southeast_asia','east_asia','oceania','caucasus'
];

const MIN_HOURS_BY_REGION = {
  europe: 0,
  north_africa: 3.7,
  atlantic_islands: 3.8,
  middle_east: 5.8,
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

/* ---------------- OpenAI helpers ---------------- */
async function callOpenAI(messages, { model=PRIMARY, max_tokens=600, temperature=0.35, timeout=TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort('timeout'), timeout);
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

/* ---------------- Canonical interests ---------------- */
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

/* ---------------- Prompts ---------------- */
// Phase 1: lean candidates (no prose)
function buildCandidatesPrompt(origin, prefs, limit, excludePairs=[]) {
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
  const excludeLine = excludePairs.length
    ? `Exclude any of these city|country pairs: ${excludePairs.join(' ; ')}`
    : '';

  return [
`You are Trip Inspire. Origin: ${origin}. User: ${groupTxt}. Interests: ${interestsTxt}. Season: ${seasonTxt}.`,
`Return JSON ONLY:
{"candidates":[
  {"city":"...","country":"...","region":"${regionEnumStr}",
   "type":"city|beach|nature|culture",
   "themes":["beach","nature","museums","performing_arts","history","food","wine","nightlife","shopping","wellness","family","luxury","budget","diving","wildlife","ski","festival","all_inclusive"],
   "best_seasons":["spring","summer","autumn","winter"],
   "approx_nonstop_hours": 3.2
  }
  // EXACTLY 15 items total
]}`,
`Hard limits:
- Non-stop flight time must be ≤ ${limit.toFixed(1)} hours from ${origin} (absolute cap).
- "approx_nonstop_hours" must be conservative, rounded UP to one decimal place.
- All items must genuinely fit the user profile (interests/season/group).
- ${excludeLine}
- No prose outside the JSON.`
  ].join('\n');
}

// Phase 2: enrich chosen 5
function buildEnrichPrompt(list) {
  // list = [{city,country}] (max 5)
  const items = list.map((x,i)=>`${i+1}. ${x.city}, ${x.country}`).join('\n');
  return [
`Return JSON ONLY with details for these destinations, same order as given:
${items}`,
`Schema:
{"top5":[
  {"city":"...","country":"...","summary":"1–2 lines, concrete fit to interests/season/group",
   "highlights":[
     "<12–20 words, named place + vivid micro-detail>",
     "<12–20 words, named place + vivid micro-detail>",
     "<12–20 words, named place + vivid micro-detail>"
   ]
  }
]}`,
`No prose outside JSON. Do not invent flight times here. Keep it concise and specific.`
  ].join('\n');
}

/* ---------------- Fallback pools (for guaranteed 5) ---------------- */
function fallbackShorthaulEU() {
  return [
    { city:'Cagliari', country:'Italy', region:'europe', type:'beach', themes:['beach','food','history'], best_seasons:['spring','summer','autumn'], approx_nonstop_hours:2.5 },
    { city:'Split', country:'Croatia', region:'europe', type:'beach', themes:['beach','history','nightlife'], best_seasons:['spring','summer','autumn'], approx_nonstop_hours:2.5 },
    { city:'Copenhagen', country:'Denmark', region:'europe', type:'city', themes:['city','design','museums','food'], best_seasons:['spring','summer','autumn'], approx_nonstop_hours:2.0 },
    { city:'Madeira (Funchal)', country:'Portugal', region:'atlantic_islands', type:'nature', themes:['nature','hiking','beach'], best_seasons:['spring','summer','autumn','winter'], approx_nonstop_hours:3.9 },
    { city:'Valencia', country:'Spain', region:'europe', type:'city', themes:['city','beach','food'], best_seasons:['spring','summer','autumn'], approx_nonstop_hours:2.3 }
  ];
}
function fallbackMixed() {
  return [
    { city:'Marrakech', country:'Morocco', region:'north_africa', type:'city', themes:['city','markets','food','history'], best_seasons:['autumn','winter','spring'], approx_nonstop_hours:3.9 },
    { city:'New York', country:'USA', region:'north_america', type:'city', themes:['city','museums','performing_arts','food','shopping'], best_seasons:['spring','autumn','winter','summer'], approx_nonstop_hours:7.5 },
    { city:'Barbados', country:'Barbados', region:'caribbean', type:'beach', themes:['beach','snorkeling','food','relaxation'], best_seasons:['winter','spring'], approx_nonstop_hours:8.5 },
    { city:'Reykjavik', country:'Iceland', region:'europe', type:'nature', themes:['nature','hot springs','museums'], best_seasons:['winter','spring','autumn','summer'], approx_nonstop_hours:3.0 },
    { city:'Muscat', country:'Oman', region:'middle_east', type:'nature', themes:['nature','beach','history'], best_seasons:['winter','spring'], approx_nonstop_hours:7.3 }
  ];
}

/* ---------------- Normalize + scoring ---------------- */
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
      approx_nonstop_hours: hours
    };
  }).filter(c => c.city && c.country && !isRestricted(c));
}

function scoreCandidate(c, prefs, limit, canonInterests) {
  const h = c.approx_nonstop_hours;
  if (h != null && h > limit) return -Infinity;

  // Interest fit (soft)
  let hits = 0; for (const t of canonInterests) if (c.themes.includes(t)) hits++;
  const interest = canonInterests.size ? (hits / canonInterests.size) : 0.35;

  // Season fit
  const season = String(prefs?.season || '').toLowerCase();
  const seasonFit = season && c.best_seasons.includes(season) ? 0.15 : 0;

  // Group hints
  const groupFit =
    prefs?.group === 'family' && c.themes.includes('family') ? 0.1 :
    prefs?.group === 'friends' && c.themes.includes('nightlife') ? 0.05 :
    prefs?.group === 'couple'  && (c.themes.includes('luxury') || c.themes.includes('wellness')) ? 0.05 : 0;

  // Slight preference near the cap (uses the time you gave)
  let hoursFit = 0;
  if (Number.isFinite(h)) { const pct = h / limit; if (pct >= 0.6 && pct <= 1.0) hoursFit = 0.05; }

  return 1 + 1.1*interest + seasonFit + groupFit + hoursFit;
}

function pickTopN(cands, prefs, limit, n = 5) {
  const canon = canonizeInterests(prefs?.interests);
  const scored = normalizeCandidates(cands).map(c => ({ c, s: scoreCandidate(c, prefs, limit, canon) }))
                                           .filter(x => x.s > -Infinity)
                                           .sort((a,b)=>b.s-a.s);
  const picked = [];
  const perCountry = new Map();

  for (const { c } of scored) {
    const key = `${c.city.toLowerCase()}|${c.country.toLowerCase()}`;
    if (picked.find(p => `${p.city.toLowerCase()}|${p.country.toLowerCase()}` === key)) continue;
    const cnt = perCountry.get(c.country.toLowerCase()) || 0;
    if (cnt >= 2) continue; // soft cap
    picked.push(c);
    perCountry.set(c.country.toLowerCase(), cnt+1);
    if (picked.length === n) break;
  }
  // fill if needed
  for (const { c } of scored) {
    if (picked.length === n) break;
    const key = `${c.city.toLowerCase()}|${c.country.toLowerCase()}`;
    if (!picked.find(p => `${p.city.toLowerCase()}|${p.country.toLowerCase()}` === key)) picked.push(c);
  }
  return picked.slice(0,n);
}

/* ---------------- Phase 1: fetch candidates robustly ---------------- */
async function fetchCandidates(origin, prefs, baseLimit) {
  const limit = baseLimit;
  const excludePairs1 = []; // first pass, none
  const prompt1 = buildCandidatesPrompt(origin, prefs, limit, excludePairs1);

  let parsed = null; let text = null;
  try { text = await callOpenAI(
      [{ role:'system', content:'Return precise JSON only.' }, { role:'user', content: prompt1 }],
      { model: PRIMARY, max_tokens: 600, temperature: 0.3, timeout: TIMEOUT_MS }
    );
    parsed = tryParse(text);
    if (!parsed) {
      text = await callOpenAI(
        [{ role:'system', content:'Return precise JSON only.' }, { role:'user', content: prompt1 }],
        { model: FALLBACK, max_tokens: 600, temperature: 0.3, timeout: TIMEOUT_MS }
      );
      parsed = tryParse(text);
    }
  } catch {}

  let cands = Array.isArray(parsed?.candidates) ? parsed.candidates : [];

  // If too few usable items (<8 within cap), fetch a second page excluding the first set
  let usable = normalizeCandidates(cands).filter(c => c.approx_nonstop_hours == null || c.approx_nonstop_hours <= limit);
  if (usable.length < 8) {
    const excludes = normalizeCandidates(cands).map(c => `${c.city}|${c.country}`);
    const prompt2 = buildCandidatesPrompt(origin, prefs, limit, excludes.slice(0,30));
    try {
      let t2 = await callOpenAI(
        [{ role:'system', content:'Return precise JSON only.' }, { role:'user', content: prompt2 }],
        { model: PRIMARY, max_tokens: 600, temperature: 0.35, timeout: TIMEOUT_MS }
      );
      const p2 = tryParse(t2);
      if (Array.isArray(p2?.candidates)) cands = cands.concat(p2.candidates);
    } catch {}
  }

  // If still thin, merge a curated fallback filtered by cap
  usable = normalizeCandidates(cands).filter(c => c.approx_nonstop_hours == null || c.approx_nonstop_hours <= limit);
  if (usable.length < 8) {
    const isShort = baseLimit <= 4.5;
    const fb = isShort ? fallbackShorthaulEU() : fallbackMixed();
    const fbOK = normalizeCandidates(fb).filter(c => c.approx_nonstop_hours == null || c.approx_nonstop_hours <= limit);
    // merge unique
    const seen = new Set(usable.map(c => `${c.city}|${c.country}`));
    for (const c of fbOK) {
      const key = `${c.city}|${c.country}`;
      if (!seen.has(key)) { usable.push(c); seen.add(key); }
    }
  }

  return usable;
}

/* ---------------- Phase 2: enrich top5 (summaries+highlights) ---------------- */
async function enrichTop5(list) {
  if (!process.env.OPENAI_API_KEY) {
    // basic templated enrichment
    return list.map(x => ({
      ...x,
      summary: `Great fit for your profile with plenty to do in ${x.city}.`,
      highlights: [
        `Explore a signature spot in ${x.city} with sights matched to your interests.`,
        `Sample local food and a neighborhood walk ideal for this season.`,
        `Catch a view or waterfront stroll to wrap up the day.`
      ]
    }));
  }

  const prompt = buildEnrichPrompt(list.map(({city,country})=>({city,country})));
  let parsed = null;
  try {
    let text = await callOpenAI(
      [{ role:'system', content:'Return concise JSON only.' }, { role:'user', content: prompt }],
      { model: PRIMARY, max_tokens: 700, temperature: 0.5, timeout: TIMEOUT_MS }
    );
    parsed = tryParse(text);
    if (!parsed) {
      text = await callOpenAI(
        [{ role:'system', content:'Return concise JSON only.' }, { role:'user', content: prompt }],
        { model: FALLBACK, max_tokens: 700, temperature: 0.5, timeout: TIMEOUT_MS }
      );
      parsed = tryParse(text);
    }
  } catch {}

  const out = [];
  const arr = Array.isArray(parsed?.top5) ? parsed.top5 : [];
  for (let i = 0; i < list.length; i++) {
    const base = list[i];
    const add  = arr[i] || {};
    const highlights = Array.isArray(add.highlights) ? add.highlights.map(STRIP).filter(Boolean).slice(0,3) : [];
    out.push({
      ...base,
      summary: STRIP(add.summary || `A concise, first-timer friendly plan in ${base.city}.`),
      highlights: highlights.length === 3 ? highlights : [
        ...(highlights),
        ...Array.from({length: Math.max(0, 3 - highlights.length)}).map(() => `Visit a named highlight in ${base.city} aligned to your interests.`)
      ].slice(0,3)
    });
  }
  return out;
}

/* ---------------- Core: generate highlights (always 5) ---------------- */
async function generateHighlights(origin, prefs, excludes = []) {
  const raw = Number(prefs?.flight_time_hours);
  const cap = Math.min(Math.max(Number.isFinite(raw) ? raw : 8, 1), 20);
  const limitBase = cap + TIME_BUFFER;

  if (!process.env.OPENAI_API_KEY) {
    const pool = cap <= 4.5 ? fallbackShorthaulEU() : fallbackMixed();
    const top = pickTopN(pool, prefs, limitBase, 5);
    const enriched = await enrichTop5(top);
    return withMeta({ top5: enriched }, { mode:'sample' });
  }

  // Phase 1: candidates (two pages + fallback)
  let pool = await fetchCandidates(origin, prefs, limitBase);

  // Try strict cap first
  let top = pickTopN(pool, prefs, limitBase, 5);

  // If fewer than 5, gradually relax the cap in +0.5h steps (max +2.0h), then re-pick
  let relax = 0.0;
  while (top.length < 5 && relax < 2.01) {
    relax += 0.5;
    top = pickTopN(pool, prefs, limitBase + relax, 5);
    if (top.length >= 5) break;
    // If pool is thin, fetch more with relaxed cap once
    if (relax === 0.5) {
      const more = await fetchCandidates(origin, prefs, limitBase + 1.0);
      // merge unique
      const seen = new Set(pool.map(c => `${c.city}|${c.country}`));
      for (const c of more) {
        const key = `${c.city}|${c.country}`;
        if (!seen.has(key)) { pool.push(c); seen.add(key); }
      }
    }
  }

  // Absolute last resort: add curated pool under relaxed cap
  if (top.length < 5) {
    const fb = cap <= 4.5 ? fallbackShorthaulEU() : fallbackMixed();
    const merged = pool.concat(normalizeCandidates(fb));
    top = pickTopN(merged, prefs, limitBase + Math.min(relax, 2.0), 5);
  }

  // Phase 2: enrich chosen 5
  const enriched = await enrichTop5(top);

  // Final safety + shape
  const safe = enriched.filter(d => !isRestricted(d)).slice(0,5);
  return withMeta({ top5: safe }, { mode:'live', capHours: cap, limitUsed: limitBase + Math.min(relax, 2.0) });
}

/* ---------------- Itinerary (unchanged) ---------------- */
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
    let text = await callOpenAI([sys, usr], { model: PRIMARY, max_tokens: 850, temperature: 0.45, timeout: TIMEOUT_MS });
    parsed = tryParse(text) || null;
    if (!parsed) {
      text = await callOpenAI([sys, usr], { model: FALLBACK, max_tokens: 850, temperature: 0.45, timeout: TIMEOUT_MS });
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

/* ---------------- Routes ---------------- */
export async function GET() {
  const data = await generateHighlights('LHR', { interests:['Beaches'], group:'couple', season:'summer', flight_time_hours: 7 }, []);
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req) {
  let body = null;
  try {
    body = await req.json();
    const origin = body?.origin || 'LHR';
    const prefs  = body?.preferences || {};
    const build  = body?.buildItineraryFor;

    if (build?.city) {
      const res = await generateItinerary(STRIP(build.city), STRIP(build.country || ''), prefs);
      return NextResponse.json(res, { headers: { 'Cache-Control': 'no-store' } });
    }

    const res = await generateHighlights(origin, prefs, []);
    return NextResponse.json(res, { headers: { 'Cache-Control': 'no-store' } });

  } catch (err) {
    console.error('API ERROR:', {
      message: err?.message, stack: err?.stack,
      bodySummary: body ? { hasPrefs: !!body?.preferences, hasBuildItineraryFor: !!body?.buildItineraryFor } : null
    });

    // Hard fallback: curated pool scored by quiz
    const prefs = body?.preferences || {};
    const raw = Number(prefs?.flight_time_hours);
    const cap = Math.min(Math.max(Number.isFinite(raw) ? raw : 8, 1), 20);
    const limit = cap + TIME_BUFFER;
    const pool = cap <= 4.5 ? fallbackShorthaulEU() : fallbackMixed();
    const top = pickTopN(pool, prefs, limit, 5);
    const enriched = await enrichTop5(top);
    return NextResponse.json({ meta:{ mode:'error-fallback', error: err?.message || 'unknown' }, top5: enriched }, { status: 200 });
  }
}
