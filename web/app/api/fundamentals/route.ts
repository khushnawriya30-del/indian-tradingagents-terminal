import { NextResponse } from "next/server";

import { cached } from "@/lib/server/cache";
import { runJson } from "@/lib/server/python";
import { nseSymbol } from "@/lib/server/instruments";
import { sessionState } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface FundamentalsPayload {
  symbol: string;
  markdown: string;
  links: Record<string, string>;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol");
  const date = url.searchParams.get("date") || sessionState().last_close_date;
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  try {
    const payload = await cached<FundamentalsPayload>(
      `fundamentals:${symbol}:${date}`,
      15 * 60_000,
      () =>
        runJson<FundamentalsPayload>(
          "scripts/indian_data.py",
          ["fundamentals", "--symbol", nseSymbol(symbol), "--date", date],
          { timeoutMs: 120000 }
        )
    );
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "fundamentals failed" },
      { status: 502 }
    );
  }
}
