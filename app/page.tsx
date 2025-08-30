"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

const INTERESTS = [
  "Beaches","Food","Culture","Adventure","Nightlife","Family",
  "Spa","Hiking","All-inclusive","Less crowded"
];

export default function Page() {
  const r = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [origin, setOrigin] = useState("London (LON)");
  const [month, setMonth] = useState<number>(new Date().getMonth() + 1);
  const [budget, setBudget] = useState("mid");
  const [maxFlight, setMaxFlight] = useState(5);

  const canPick = useMemo(() => selected.length < 3, [selected]);
  const toggle = (i: string) => {
    setSelected(prev =>
      prev.includes(i) ? prev.filter(x => x !== i) :
      canPick ? [...prev, i] : prev
    );
  };

  function submit() {
    const params = new URLSearchParams({
      month: String(month),
      budget,
      maxFlight: String(maxFlight),
      origin,
      interests: selected.join(","),
    });
    r.push(`/results?${params.toString()}`);
  }

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Find your next trip</h1>

      <div>
        <label className="block text-sm mb-1">Departing from (optional)</label>
        <input
          list="origins" value={origin} onChange={e=>setOrigin(e.target.value)}
          className="w-full border rounded-lg px-3 py-2"
        />
        <datalist id="origins">
          <option value="London (LON)" />
          <option value="Manchester (MAN)" />
          <option value="Edinburgh (EDI)" />
          <option value="Dublin (DUB)" />
        </datalist>
        <p className="text-xs opacity-70 mt-1">We’ll estimate flight time from this city.</p>
      </div>

      <div>
        <label className="block text-sm mb-1">When?</label>
        <select className="border rounded-lg px-3 py-2"
          value={month} onChange={e=>setMonth(Number(e.target.value))}
        >
          {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
            .map((m,i)=><option key={m} value={i+1}>{m}</option>)}
        </select>
      </div>

      <div>
        <label className="block text-sm mb-1">Budget</label>
        <select className="border rounded-lg px-3 py-2"
          value={budget} onChange={e=>setBudget(e.target.value)}
        >
          <option value="budget">Budget</option>
          <option value="mid">Mid</option>
          <option value="premium">Premium</option>
          <option value="luxury">Luxury</option>
        </select>
      </div>

      <div>
        <label className="block text-sm mb-1">
          Max flight time (hours)
        </label>
        <input type="range" min={2} max={17} value={maxFlight}
          onChange={e=>setMaxFlight(Number(e.target.value))}
          className="w-full" />
        <div className="text-sm">{maxFlight}h</div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className="block text-sm mb-1">Interests</label>
          <span className="text-xs opacity-70">Select up to 3</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {INTERESTS.map(i => (
            <button key={i}
              onClick={()=>toggle(i)}
              className={`px-3 py-1 rounded-full border ${selected.includes(i) ? "bg-[#A8442B] text-white border-transparent" : ""}`}
            >
              {i}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={submit}
        className="px-4 py-2 rounded-xl bg-[#A8442B] text-white hover:opacity-90"
      >
        See my ideas
      </button>
    </main>
  );
}
