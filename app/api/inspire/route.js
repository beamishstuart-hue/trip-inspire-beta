// app/api/inspire/route.js
export const runtime = 'nodejs';

// Map quiz duration to number of days
function daysFromDuration(code) {
  const map = {
    'week-7d': 7,
    'weekend-2d': 2,
    'mini-4d': 4,
    'two-weeks-14d': 14,
    'fortnight-14d': 14,
  };
  return map[code] || 3;
}

// Per-destination highlight bullets (5 items each)
const HIGHLIGHTS = {
  vienna: [
    'Vienna State Opera & classical concerts',
    'Kunsthistorisches & Albertina museums',
    'Schönbrunn Palace & gardens',
    'Coffee houses & cake (Sachertorte!)',
    'St. Stephen’s Cathedral & Ringstrasse walk',
  ],
  barcelona: [
    'Sagrada Família & Gaudí highlights',
    'Gothic Quarter ramble',
    'Tapas crawl & markets (Boqueria)',
    'Barceloneta beach time',
    'Montserrat or Sitges day trip',
  ],
  tenerife: [
    'All-inclusive resorts in Costa Adeje',
    'Teide National Park cable car',
    'Whale/dolphin watching from Los Gigantes',
    'Lava pools at Lago Martiánez',
    'Beaches: Playa del Duque & Las Teresitas',
  ],
  marrakech: [
    'Jemaa el-Fnaa & Medina souks',
    'Jardin Majorelle & YSL Museum',
    'Traditional hammam experience',
    'Bahia Palace & Saadian Tombs',
    'Atlas Mountains day trip',
  ],
  crete: [
    'Elafonissi or Balos beaches',
    'Chania Old Town & Venetian harbor',
    'Samaria Gorge hike (seasonal)',
    'Minoan sites: Knossos & Heraklion Museum',
    'Olive oil & Cretan cuisine tasting',
  ],
};

export async function POST(req) {
  // Read body safely
  let body = {};
  try { body = await req.json(); } catch {}

  const prefs = body?.preferences || {};
  const interests = Array.isArray(prefs.interests) ? prefs.interests : [];
  const days = daysFromDuration(prefs.duration);

  // Base list (top 5)
  const base = [
    { slug: 'vienna',    name: 'Vienna',    country: 'Austria', tags: ['Performing arts','Museums','Cities'] },
    { slug: 'barcelona', name: 'Barcelona', country: 'Spain',   tags: ['Cities','Food & drink','Beaches'] },
    { slug: 'tenerife',  name: 'Tenerife',  country: 'Spain',   tags: ['All-inclusive resorts','Beaches','Sun'] },
    { slug: 'marrakech', name: 'Marrakech', country: 'Morocco', tags: ['Markets','Culture','Sun'] },
    { slug: 'crete',     name: 'Crete',     country: 'Greece',  tags: ['All-inclusive resorts','Beaches','Food'] },
  ];

  // Light scoring just to order
  const scored = base.map((d, i) => {
    const match = interests.filter(x => d.tags.includes(x)).length;
    const highlights = HIGHLIGHTS[d.slug] || [];
    const summary = `Great fit for ${interests.length ? interests.join(', ') : 'your interests'}.`;

    return {
      id: d.slug,
      slug: d.slug,
      title: d.name,
      name: d.name,
      subtitle: d.country,
      country: d.country,
      tags: d.tags,
      score: 0.95 - i * 0.03 + match * 0.01,
      summary,
      itineraryId: `${d.slug}-${days}d`,

      // >>> keys many UIs look for <<<
      highlights,           // array of bullet strings
      bullets: highlights,  // alias
      features: highlights, // alias
      reasons: highlights,  // alias
    };
  });

  const payload = {
    ok: true,
    count: scored.length,
    highlights: scored,
    ideas: scored,
    results: scored,
    top5: scored,
  };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

export function GET() {
  return new Response('Method Not Allowed', { status: 405 });
}
