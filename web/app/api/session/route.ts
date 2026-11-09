import { NextResponse } from "next/server";

import { getQuotes } from "@/lib/server/quotes";
import { sessionState } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const INDEX_KEYS = [
  "NSE_INDEX|Nifty 50",
  "NSE_INDEX|Nifty Bank",
  "BSE_INDEX|SENSEX",
  "NSE_INDEX|India VIX",
];

export async function GET() {
  const session = sessionState();
  let indices: unknown[] = [];
  let warning: string | undefined;
  try {
    const quotes = await getQuotes(INDEX_KEYS, session);
    indices = INDEX_KEYS.map((key) => quotes[key]).filter(Boolean);
  } catch (error) {
    warning = error instanceof Error ? error.message : "index quotes unavailable";
  }
  return NextResponse.json({
    session,
    indices,
    last_close_date: session.last_close_date,
    today: session.session_date,
    warning,
  });
}
