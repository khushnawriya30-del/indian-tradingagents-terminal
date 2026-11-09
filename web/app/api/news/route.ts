import { NextResponse } from "next/server";

import { cached } from "@/lib/server/cache";
import { nseSymbol } from "@/lib/server/instruments";
import { runJson } from "@/lib/server/python";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface NewsPayload {
  symbol: string;
  items: Array<{
    title: string;
    source: string;
    link: string;
    published: string | null;
    summary: string;
  }>;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 12), 1), 30);
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  try {
    const payload = await cached<NewsPayload>(`news:${symbol}:${limit}`, 3 * 60_000, () =>
      runJson<NewsPayload>(
        "scripts/indian_data.py",
        ["news", "--symbol", nseSymbol(symbol), "--limit", String(limit)],
        { timeoutMs: 90000 }
      )
    );
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "news failed" },
      { status: 502 }
    );
  }
}
