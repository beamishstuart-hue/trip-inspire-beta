// app/api/inspire/route.js
export const runtime = 'nodejs';

// Map your quiz duration to days
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

export async function POST(req) {
  // Read body safely
  let body = {};
  try { body = await req.json(); } catch {}

  const prefs = body?.preferences || {};
  const days = daysFromDuration(prefs.duration);

  // Very simple “top 5” compatible payload
  const base = [
    { slug: 'vienna',    name: 'Vienna',    country: 'Austria',    tags: ['Performing arts','Museums','Cities'] },
    { slug: 'barcelona', name: 'Barcelona', country: 'Spain',      tags: ['Cities','Food & drink','Beaches'] },
    { slug: 'tenerife',  name: 'Tenerife',  country: 'Spain',      tags: ['All-inclusive resorts','Beaches','Sun'] },
    { slug: 'marrakech', name: 'Marrakech', country: 'Morocco',    tags: ['Markets','Culture','Sun'] },
    { slug: 'crete',     name: 'Crete',     country: 'Greece',     tags: ['All-inclusive resorts','Beaches','Food'] },
  ];

  // Light scoring just so there’s an order
  const interests = Array.isArray(prefs.interests) ? prefs.interests : [];
  const scored = base.map((d, i) => {
    const match = interests.filter(x => d.tags.includes(x)).length;
    return {
      id: d.slug,
      slug: d.slug,
      title: d.name,
      name: d.name,
      subtitle: d.country,
      country: d.country,
      tags: d.tags,
      score: 0.95 - i * 0.03 + match * 0.01,
      summary: `Great fit for ${interests.length ? interests.join(', ') : 'your interests'}.`,
      // what most UIs need to wire the next step:
      itineraryId: `${d.slug}-${days}d`,
    };
  });

  // Return under multiple commonly used keys so the UI finds one it expects
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
