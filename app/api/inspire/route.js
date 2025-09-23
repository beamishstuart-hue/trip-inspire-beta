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

/* ====== Dynamic buffer (strict for very short-haul) ====== */
function bufferFor(userHours) {
  if (userHours <= 3.0) return 0.0;   // NO buffer for ≤3h (prevents Marrakech/Dubai leakage)
  if (userHours <= 4.5) return 0.3;   // gentle for short-haul
  return 0.5;                         // 30 min as you wanted for longer ranges
}

/* ====== Region minimum plausible hours (guardrail against model underestimates) ====== */
const MIN_HOURS_BY_REGION = {
  europe: 0,
  north_africa: 3.4,         // Marrakech/Casablanca from LHR ~3.5–4.0
  atlantic_islands: 3.8,     // Madeira/Canaries typically 3.8–4.5
  middle_east: 5.5,          // Dubai/Doha/Abu Dhabi ≥ ~6–7
  east_africa: 7.0,          // Nairobi/ADD ≥ ~7–9
  indian_ocean: 9.0,         // Maldives/Mauritius ≥ ~9–12
  north_america: 6.5,        // NYC/BOS ≥ ~6.5–8
  caribbean: 7.5,            // Barbados/Jamaica ≥ ~8–9
  central_america: 9.0,
  south_america: 10.0,
  south_asia: 8.0,
  southeast_asia: 11.5,
  east_asia: 10.0,
  oceania: 16.0,
  caucasus: 4.5
};

/* ================ Prompt (sentence highlights + conservative hours) ================= */

function buildHighlightsPrompt(origin, p, bufferHours, excludes, regionPolicy, hardShorthaulEuropeOnly) {
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

  const pri = regionPolicy.priorityRegions.join(', ') || 'no special priority';
  const bandLine = regionPolicy.minHours > 0
    ? `Prefer candidates clustered in the ${regionPolicy.minHours}–${limit}h band. Include AT LEAST ${Math.max(6, regionPolicy.minPriorityInTop5)*2} candidates with approx_nonstop_hours ≥ ${regionPolicy.minHours}h.`
    : `Prefer flights up to ~${limit}h.`;

  const shorthaulEuropeOnlyLine = hardShorthaulEuropeOnly
    ? `Because the user allows only ~${userHours}h, include EUROPE ONLY. Do not include Middle East, North Africa, Atlantic Islands, or any intercontinental region.`
    : '';

  // Short-haul Europe spread hint
  const euBalanceLine = userHours <= 4.5 ? `Ensure European geographic spread: include at least one from Nordics/Baltics, one from Balkans/Eastern Europe, and one from Western Europe outside Iberia/Italy/France.` : '';

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
- ${shorthaulEuropeOnlyLine}
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

/* ================ Selection (strict short-haul, region floors, weighted sampling) ================= */

// No global avoid/downrank lists; we rely on policies + randomness.

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
  return (((h >>> 0) % 10000) / 10000 - 0.5) * 2 * amp; // [-amp, +amp]
}

function clampHoursByRegion(hours, region) {
  if (!Number.isFinite(hours)) return hours;
  const floor = MIN_HOURS_BY_REGION[region] ?? 0;
  return Math.max(hours, floor);
}

function pickTop5FromCandidates(cands, limitHours, excludes = [], seed = 'x', regionPolicy, hardShorthaulEuropeOnly) {
  const excludeSet = new Set((Array.isArray(excludes)?excludes:[]).map(x => STRIP(x).toLowerCase()));
  const cleaned = (Array.isArray(cands) ? cands : []).map(x => {
    const baseHours = Number(x.approx_nonstop_hours);
    const region = STRIP((x.region || '').toString()).toLowerCase();
    const correctedHours = Number.isFinite(baseHours) ? clampHoursByRegion(baseHours, region) : baseHours;
    return {
      city: STRIP(x.city),
      country: STRIP(x.country),
      region,
      type: STRIP(x.type || '').toLowerCase(),
      approx_nonstop_hours: Number.isFinite(correctedHours) ? correctedHours : null,
      summary: STRIP(x.summary || ''),
      highlights: Array.isArray(x.highlights) ? x.highlights.slice(0,3).map(STRIP) : []
    };
  }).filter(x =>
    x.city && x.country && x.highlights.length === 3
  );

  // Hard region block for very short-haul: Europe only
  let pool = cleaned;
  if (hardShorthaulEuropeOnly) {
    pool = pool.filter(x => EUROPE_NAMES.has(x.region));
  }

  // Hard filters (strict ≤ user + buffer)
  let hard = pool.filter(x => {
    const cityLc = x.city.toLowerCase();
    const key = `${cityLc}|${x.country.toLowerCase()}`;
    if (isRestricted(x)) return false;
    if (excludeSet.has(cityLc) || excludeSet.has(key)) return false;
    if (x.approx_nonstop_hours != null && x.approx_nonstop_hours > limitHours) return false;
    return true;
  });

  const unknownHours = pool.filter(x => x.approx_nonstop_hours == null);

  const isShorthaul = limitHours <= 4.5;
  const isVeryShort = limitHours <= 3.0;
  const jitterAmp   = isShorthaul ? 0.12 : 0.03;

  // For very short-haul, require known hours (avoid “cheats”)
  if (isVeryShort) {
    hard = hard.filter(x => x.approx_nonstop_hours != null);
  }

  // Score with gentle long-haul preferences and short-haul rotation
  const scored = hard.map((it, i) => {
    const cityLc = it.city.toLowerCase();
    const key = `${cityLc}|${it.country.toLowerCase()}`;
    let score = 1.0;

    if (regionPolicy.minHours > 0) {
      const h = it.approx_nonstop_hours ?? 0;
      if (h >= regionPolicy.minHours) score += 0.10; else score -= 0.10;
      if (regionPolicy.priorityRegions.includes(it.region)) score += 0.10;
    }

    if (RECENT_SET.has(key)) score -= 0.18;
    if (it.approx_nonstop_hours == null) score -= 0.05;

    score += seededJitter(seed, i, jitterAmp);
    return { ...it, _score: score };
  }).sort((a, b) => b._score - a._score);

  // Greedy selection with weighted sampling to increase diversity
  const picked = [];
  const seenCityCountry = new Set();
  const seenCountry = new Set();

  function pushIfNew(it) {
    const key = `${it.city.toLowerCase()}|${it.country.toLowerCase()}`;
    if (seenCityCountry.has(key)) return false;
    // Europe cap (gentle)
    if (EUROPE_NAMES.has((it.region||'').toLowerCase())) {
      const europeCount = picked.filter(p => EUROPE_NAMES.has(p.region)).length;
      if (europeCount >= (regionPolicy.maxEuropeInTop5 ?? 5)) return false;
    }
    picked.push(it);
    seenCityCountry.add(key);
    seenCountry.add(it.country.toLowerCase());
    noteRecent(it.city, it.country);
    return true;
  }

  // 1) Priority quota first (only if minHours > 0)
  for (const it of scored) {
    if (picked.length >= regionPolicy.minPriorityInTop5) break;
    if (regionPolicy.priorityRegions.includes(it.region)) pushIfNew(it);
  }

  // 2) Country diversity — sample from top 10 rather than strict order to vary outputs
  const topSlice = scored.slice(0, 10);
  while (picked.length < 5 && topSlice.length) {
    // Weighted pick by score
    const total = topSlice.reduce((s, it) => s + Math.max(0.01, it._score), 0);
    let r = Math.random() * total;
    let idx = 0;
    for (let i = 0; i < topSlice.length; i++) {
      r -= Math.max(0.01, topSlice[i]._score);
      if (r <= 0) { idx = i; break; }
    }
    const cand = topSlice.splice(idx, 1)
