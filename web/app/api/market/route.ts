import { NextResponse } from "next/server";

import { getHomePayload } from "@/lib/server/market";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TABS = new Set(["ideas", "stocks", "options", "futures", "commodity"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") || "ideas";
  if (!TABS.has(tab)) {
    return NextResponse.json({ error: `Unknown tab ${tab}` }, { status: 400 });
  }
  try {
    const payload = await getHomePayload(tab);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Market feed unavailable" },
      { status: 502 }
    );
  }
}
