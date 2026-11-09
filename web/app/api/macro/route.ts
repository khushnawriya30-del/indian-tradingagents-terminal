import { NextResponse } from "next/server";

import { cached } from "@/lib/server/cache";
import { runJson } from "@/lib/server/python";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const payload = await cached<Record<string, unknown>>("macro:snapshot", 5 * 60_000, () =>
      runJson<Record<string, unknown>>("scripts/indian_data.py", ["macro"], {
        timeoutMs: 120000,
      })
    );
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "macro failed" },
      { status: 502 }
    );
  }
}
