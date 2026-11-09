import { NextResponse } from "next/server";

import { ensureMaster, toHit } from "@/lib/server/instruments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 20), 1), 50);
  if (query.length < 1) return NextResponse.json({ query, results: [] });
  try {
    const master = await ensureMaster();
    const segments = (url.searchParams.get("segments") || "")
      .split(",")
      .map((segment) => segment.trim())
      .filter(Boolean);
    const results = master
      .search(query, limit, segments.length ? segments : undefined)
      .map(toHit);
    return NextResponse.json({ query, results });
  } catch (error) {
    return NextResponse.json(
      { query, results: [], error: error instanceof Error ? error.message : "search failed" },
      { status: 503 }
    );
  }
}
