// app/api/inspire/route.js
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const PRIMARY = 'gpt-4o-mini';
const FALLBACK = 'gpt-4o';
const OPENAI_TIMEOUT_MS = 12000; // tighter to prevent timeouts

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

function bufferFor(hours) {
  if (hours <= 3.0) return 0.0;  // strict short-haul
  if (hours <= 4.5) return 0.3;  // gentle short-haul
  return 0.5;                    // 30 min otherwise
}

/* Region minimum plausible hours (prevents model underestimates) */
const MIN_HOURS_BY_REGION = {
  europe: 0,
  north_africa: 3.4,
  atlantic_islands: 3.8,
  middle_east: 5.5,
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
async function callOpenAI(messages, model, max_tokens=900, temperature=0.4, timeoutMs=OPENAI_TIMEOUT_MS) {
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

/* ================= Prompt (small, accuracy-first) ================= */
const REGION_ENUM = [
  'europe','north_africa','atlantic_islands','middle_east','east_africa','indian_ocean',
  'north_america','caribbean','central_america','south_america','south_asia','southeast_asia','east_asia','oceania','caucasus'
].join('|');

function buildTop5Prompt(origin, prefs, limit, europeOnly, excludes=[]) {
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

  const excludeLine = excludes.length ? `Exclude: ${excludes.join(', ')}.` : '';
  const europeOnlyLine = europeOnly
    ? 'EUROPE ONLY — do not include Middle East, North Africa, Atlantic Islands, or any intercontinental region.'
    : '';

  // NOTE: We ask for the final 5 directly (no giant candidate pool) for speed and accuracy.
  return [
`You are Trip Inspire. Origin: ${origin}.`,
`User profile: ${groupTxt}. Interests: ${interestsTxt}. Season: ${seasonTxt}.`,
`Hard limits:
- Non-stop flight time must be ≤ ${limit.toFixed(1)} hours from ${origin} (absolute cap).
- "approx_nonstop_hours" must be conservative and rounded UP to one decimal place.
- Region must be one of: ${REGION_ENUM}.
${europeOnlyLine}
${excludeLine}`,
`Return JSON ONLY in this exact shape:
{
  "top5": [
    { "city":"...", "country":"...", "region":"${REGION_ENUM}", "type":"city|beach|nature|culture",
      "approx_nonstop_hours": 2.7,
      "summary":"1–2 lines",
      "highlights":[
        "<12–22 word sentence with a named place and vivid micro-detail>",
        "<12–22 word sentence with a named place and vivid micro-detail>",
        "<12–22 word sentence with a named place and vivid micro-detail>"
      ]
    }
  ]
}`,
`Selection rules:
- All 5 must fit the user's interests/season/group; make this obvious in the highlights/summary.
- Prefer **direct** fits to interests over generic crowd-pleasers.
- Ensure at least 3 different countries, unless incompatible with the user's interests.
- No prose outside JSON.`
  ].join('\n');
}

/* ================= Fallbacks ================= */
function fallbackShorthaulEU() {
  return [
    { city:'Porto', country:'Portugal', region:'europe', type:'city', approx_nonstop_hours:2.0,
      summary:'Ribeira quarter, Douro cellars, tiled churches',
      highlights:[
        'Cross the Dom Luís I Bridge at golden hour as rabelo boats drift along the Ribeira quay.',
        'Sip a tawny port in a Vila Nova de Gaia lodge, surrounded by cool, barrel-scented cellars.',
        'Browse Livraria Lello’s carved staircases before francesinha sandwiches in a lively tasca.'
      ]},
    { city:'Seville', country:'Spain', region:'europe', type:'city', approx_nonstop_hours:2.5,
      summary:'Moorish palaces, plazas, and late-night tapas',
      highlights:[
        'Wander the Alcázar’s citrus courtyards and filigreed arches while fountains echo softly.',
        'Glide around Plaza de España’s tiled alcoves, spotting regional murals under curved colonnades.',
        'Snack on garlicky prawns and crisp croquetas in Triana’s ceramic-fronted bars after dusk.'
      ]},
    { city:'Copenhagen', country:'Denmark', region:'europe', type:'city', approx_nonstop_hours:1.9,
      summary:'Harborside design, bike lanes, and New Nordic dining',
      highlights:[
        'Cycle past Nyhavn’s pastel townhouses, then linger for smørrebrød and cold beer by the quay.',
        'Explore Designmuseum Danmark’s clean lines before coffee in a candlelit, hygge café.',
        'Catch sunset from Christiansborg Tower with copper roofs glowing over spires and canals.'
      ]},
    { city:'Ljubljana', country:'Slovenia', region:'europe', type:'city', approx_nonstop_hours:2.2,
      summary:'Riverfront cafés, castle views, and alpine day trips',
      highlights:[
        'Stroll the Ljubljanica embankment under Jože Plečnik’s arcades to gelato and buskers.',
        'Ride the funicular to Ljubljana Castle for red-tile rooftops and distant Karavanke peaks.',
        'Bus to Lake Bled for a gentle row to the island church and a slice of cream cake.'
      ]},
    { city:'Gdańsk', country:'Poland', region:'europe', type:'city', approx_nonstop_hours:2.1,
      summary:'Baltic seafront history and amber-fronted lanes',
      highlights:[
        'Walk Długi Targ past Neptune’s Fountain to medieval cranes along the Motława waterfront.',
        'Browse amber workshops near Mariacka Street as bells drift over steep-gabled façades.',
        'Warm up with pierogi and smoked fish in a brick-vaulted tavern off Piwna Street.'
      ]}
  ];
}
function fallbackMixed() {
  return [
    { city:'Marrakech', country:'Morocco', region:'north_africa', type:'city', approx_nonstop_hours:3.7,
      summary:'Souks, gardens, riads, and Atlas foothills',
      highlights:[
        'Watch snake charmers and orange-juice stalls ignite Jemaa el-Fnaa as drums quicken at sunset.',
        'Step into Jardin Majorelle’s cobalt walkways beside pencil-thin cacti and rustling bamboo.',
        'Trade mint tea for rooftop tagines as the call to prayer drifts over terracotta rooftops.'
      ]},
    { city:'New York', country:'USA', region:'north_america', type:'city', approx_nonstop_hours:7.5,
      summary:'Iconic culture, neighborhoods, and bites',
      highlights:[
        'Walk the High Line’s wildflower beds to Hudson views, ending with art at Chelsea galleries.',
        'Grab a classic slice in Brooklyn before skyline shots from the ferry’s open upper deck.',
        'Catch a Broadway matinee, then nightcap jazz in a dim Village basement club.'
      ]},
    { city:'Dubai', country:'UAE', region:'middle_east', type:'city', approx_nonstop_hours:7.0,
      summary:'Skyline drama, beaches, and desert escapes',
      highlights:[
        'Rocket up Burj Khalifa for hazy desert horizons and tiny dhows threading the Dubai Creek.',
        'Wind through Madinat Jumeirah’s lantern-lit souk before abra rides past palm-lined canals.',
        'Kick up sand on a sunset dune drive, finishing with grilled lamb and oud music at camp.'
      ]},
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
        'Cross the Dom Luís I Bridge at golden hour as rabelo boats drift along the Ribeira quay.',
        'Sip a tawny port in a Vila Nova de Gaia lodge, surrounded by cool, barrel-scented cellars.',
        'Browse Livraria Lello’s carved staircases before francesinha sandwiches in a lively tasca.'
      ]}
  ];
}

/* ================= Core generation ================= */
function postFilterTop5(items, limit, europeOnly, excludes=[]) {
  const excludeSet = new Set((excludes||[]).map(s => STRIP(s).toLowerCase()));
  const out = [];
  const seen = new Set();

  for (const it of Array.isArray(items) ? items : []) {
    const city = STRIP(it.city); const country = STRIP(it.country);
    const region = STRIP((it.region || '').toString()).toLowerCase();
    let hours = Number(it.approx_nonstop_hours);
    hours = Number.isFinite(hours) ? clampHoursByRegion(hours, region) : null;

    if (!city || !country || !Array.isArray(it.highlights) || it.highlights.length !== 3) continue;
    if (europeOnly && region !== 'europe') continue;
    if (isRestricted({ city, country })) continue;

    const key = `${city.toLowerCase()}|${country.toLowerCase()}`;
    if (seen.has(key)) continue;
    if (excludeSet.has(city.toLowerCase()) || excludeSet.has(key)) continue;

    if (hours != null && hours > limit) continue; // strict cap

    out.push({
      city, country,
      region,
      type: STRIP(it.type || ''),
      approx_nonstop_hours: hours,
      summary: STRIP(it.summary || ''),
      highlights: it.highlights.map(STRIP)
    });
    seen.add(key);
    if (out.length === 5) break;
  }
  return out;
}

async function generateHighlights(origin, prefs, excludes=[]) {
  const raw = Number(prefs?.flight_time_hours);
  const userHours = Math.min(Math.max(Number.isFinite(raw) ? raw : 8, 1), 20);
  const buffer = bufferFor(userHours);
  const limit = userHours + buffer;
  const europeOnly = limit <= 3.0;

  // No key → curated fallback (and make it respect europeOnly + cap)
  if (!process.env.OPENAI_API_KEY) {
    const fb = europeOnly ? fallbackShorthaulEU() : fallbackMixed();
    const filtered = postFilterTop5(fb, limit, europeOnly, excludes);
    return withMeta({ top5: filtered.slice(0,5) }, { mode:'sample' });
  }

  const prompt = buildTop5Prompt(origin, prefs, limit, europeOnly, excludes);
  const sys = { role:'system', content:'Return concise JSON only.' };
  let parsed = null;
  try {
    let text = await callOpenAI([sys, { role:'user', content: prompt }], PRIMARY, 850, 0.4);
    parsed = tryParse(text);
    if (!parsed) {
      text = await callOpenAI([sys, { role:'user', content: prompt }], FALLBACK, 850, 0.4);
      parsed = tryParse(text);
    }
  } catch {}

  let items = Array.isArray(parsed?.top5) ? parsed.top5 : [];
  let top5 = postFilterTop5(items, limit, europeOnly, excludes);

  // Last-chance fill if model under-delivers
  if (top5.length < 5) {
    const fb = europeOnly ? fallbackShorthaulEU() : fallbackMixed();
    const fill = postFilterTop5(fb, limit, europeOnly, excludes);
    for (const it of fill) {
      const exists = top5.find(x => x.city === it.city && x.country === it.country);
      if (!exists) top5.push(it);
      if (top5.length === 5) break;
    }
  }

  return withMeta({ top5 }, { mode: parsed ? 'live' : 'error-fallback' });
}

/* =============== Itinerary (unchanged) =============== */
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

  const sys = { role:'system', content:'Concrete, named places; concise slots; no filler. Return JSON only.' };
  const usr = { role:'user', content: buildItineraryPrompt(city, country, want, prefs) };

  let parsed = null;
  try {
    let text = await callOpenAI([sys, usr], PRIMARY, 900, 0.5);
    parsed = tryParse(text) || null;
    if (!parsed) {
      text = await callOpenAI([sys, usr], FALLBACK, 900, 0.5);
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
  const data = await generateHighlights('LHR', { interests:['Beaches'], group:'couple', season:'summer', flight_time_hours: 3 }, []);
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

    // Final safety fallback (quick)
    const prefs = body?.preferences || {};
    const raw = Number(prefs?.flight_time_hours);
    const userHours = Math.min(Math.max(Number.isFinite(raw) ? raw : 8, 1), 20);
    const limit = userHours + bufferFor(userHours);
    const europeOnly = limit <= 3.0;
    const fb = europeOnly ? fallbackShorthaulEU() : fallbackMixed();
    const top5 = postFilterTop5(fb, limit, europeOnly, []);
    return NextResponse.json({ meta:{ mode:'error-fallback', error: err?.message || 'unknown' }, top5 }, { status: 200 });
  }
}
