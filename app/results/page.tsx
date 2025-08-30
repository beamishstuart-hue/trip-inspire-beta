// app/results/page.tsx
import ResultsCTA from "../components/ResultsCTA";
import ResultCard from "../components/ResultCard";
import { DESTINATIONS, type Destination } from "../../lib/destinations";
import { estimateFlightHours } from "../../lib/flightTime";

type Search = {
  month?: string;
  budget?: string;
  maxFlight?: string;
  origin?: string; // e.g., "London (LON)"
  interests?: string; // comma-separated
};

const ORIGINS: Record<string, {lat:number;lon:number}> = {
  "London (LON)": { lat: 51.5072, lon: -0.1276 },
  "Manchester (MAN)": { lat: 53.4794, lon: -2.2453 },
  "Edinburgh (EDI)": { lat: 55.9533, lon: -3.1883 },
  "Dublin (DUB)": { lat: 53.3498, lon: -6.2603 },
};

function scoreDest(d: Destination, interests: string[]) {
  // very lightweight scoring: +1 per matching tag, slight boost for allInclusive/uncrowded synonyms
  let s = 0;
  for (const i of interests) {
    const key = i.toLowerCase();
    if (key === "all-inclusive" && d.tags.some(t => /allinclusive|resort/i.test(t))) s += 2;
    else if (key === "less crowded" && d.tags.some(t => /uncrowded|secondcity|shoulder/i.test(t))) s += 2;
    else if (d.tags.map(t=>t.toLowerCase()).includes(key)) s += 1;
  }
  return s;
}

export default function Results({ searchParams }: { searchParams: Search }) {
  const month = Number(searchParams.month || new Date().getMonth() + 1);
  const maxFlight = Number(searchParams.maxFlight || 5);
  const originLabel = searchParams.origin || "London (LON)";
  const origin = ORIGINS[originLabel] || ORIGINS["London (LON)"];
  const interests = (searchParams.interests || "").split(",").filter(Boolean);

  // FILTERS
  let list = DESTINATIONS.slice();

  // Month filter (soft)
  list = list.filter(d => !d.bestMonths || d.bestMonths.includes(month));

  // Flight time filter (if provided)
  if (maxFlight) {
    list = list.filter(d => estimateFlightHours(origin, { lat: d.lat, lon: d.lon }) <= maxFlight + 0.2);
  }

  // Sort by interests score
  list.sort((a,b) => scoreDest(b, interests) - scoreDest(a, interests));

  // Fallbacks if empty
  const initialCount = list.length;
  if (list.length === 0) {
    // relax flight time +2h
    list = DESTINATIONS.filter(d => estimateFlightHours(origin, {lat:d.lat, lon:d.lon}) <= (maxFlight + 2));
  }
  const ideas = list.slice(0, 5);

  const answers = {
    month,
    monthLabel: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][month-1],
    maxFlight,
    origin: originLabel,
    interests
  };

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Your trip ideas</h1>

      {initialCount === 0 && (
        <div className="p-3 border rounded-lg text-sm">
          Nothing matched exactly, so we broadened flight time to <strong>+2h</strong>.
        </div>
      )}

      <ResultsCTA />

      <div className="grid gap-4">
        {ideas.map(d => (
          <ResultCard
            key={d.id}
            d={d}
            answers={answers}
            onShow={(id) => {
              // Replace this with your itinerary modal/navigation
              window.location.href = `/itinerary/${id}`;
            }}
          />
        ))}
      </div>

      {/* Mobile sticky CTA */}
      <div className="md:hidden fixed bottom-2 left-0 right-0 flex justify-center px-3">
        <div className="bg-white/95 backdrop-blur border rounded-2xl shadow-lg p-3 w-full max-w-md">
          <ResultsCTA />
        </div>
      </div>
    </main>
  );
}
