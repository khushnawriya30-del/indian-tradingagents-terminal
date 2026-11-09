import { NextResponse } from "next/server";

import { getScreenerPayload } from "@/lib/server/market";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const payload = await getScreenerPayload();
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "screener unavailable" },
      { status: 502 }
    );
  }
}
