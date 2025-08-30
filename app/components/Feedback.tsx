"use client";
import { useState } from "react";

export default function Feedback({ ideaId, answers }: { ideaId: string; answers: any }) {
  const [sent, setSent] = useState(false);
  const send = async (value: "up"|"down", note?: string) => {
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ideaId, value, note, answers, ts: Date.now() }),
      });
    } finally {
      setSent(true);
    }
  };
  if (sent) return <p className="text-sm opacity-70">Thanks! We’ll use this to improve picks.</p>;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span>Was this useful?</span>
      <button onClick={() => send("up")} className="px-2 py-1 rounded-xl border">👍</button>
      <button onClick={() => send("down")} className="px-2 py-1 rounded-xl border">👎</button>
      <button onClick={() => {
        const note = prompt("What didn’t work? (optional)");
        if (note !== null) send("down", note || undefined);
      }} className="underline">Add note</button>
    </div>
  );
}
