"use client";
import Feedback from "./Feedback";
import type { Destination } from "@/lib/destinations";

export default function ResultCard({
  d, onShow, answers
}: { d: Destination; onShow: (id: string) => void; answers: any }) {
  return (
    <div className="p-4 rounded-2xl border shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold">{d.city}</div>
          <div className="text-sm opacity-80">{d.country}</div>
        </div>
        <button
          onClick={() => onShow(d.id)}
          className="px-3 py-2 rounded-lg font-medium bg-[#A8442B] text-white hover:opacity-90"
          aria-label={`Show itinerary for ${d.city}`}
        >
          Show itinerary
        </button>
      </div>

      {/* “Why this pick” bullets – keep or tweak */}
      <ul className="text-sm list-disc ml-5 space-y-1">
        {answers?.month && <li>Great in <strong>{answers.monthLabel}</strong></li>}
        {answers?.maxFlight && <li>Within your flight-time comfort</li>}
        {d.tags?.slice(0,3).map(t => <li key={t}>{t}</li>)}
      </ul>

      <Feedback ideaId={d.id} answers={answers} />
    </div>
  );
}
