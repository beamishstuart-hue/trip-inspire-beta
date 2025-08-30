import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const data = await req.json();
  // TODO: wire to your store (Plausible/GA event, Vercel KV, Supabase, Airtable, Notion…)
  console.log("feedback", data);
  return NextResponse.json({ ok: true });
}
