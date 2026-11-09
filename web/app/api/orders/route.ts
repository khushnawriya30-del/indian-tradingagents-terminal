import { NextResponse } from "next/server";

import { resolveInstrument } from "@/lib/server/instruments";
import { getQuotes } from "@/lib/server/quotes";
import { sessionState } from "@/lib/server/session";
import { placeOrder } from "@/lib/server/store";
import type { OrderRequest } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: Partial<OrderRequest>;
  try {
    body = (await request.json()) as Partial<OrderRequest>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.instrument_key) {
    return NextResponse.json({ ok: false, error: "instrument_key is required" }, { status: 400 });
  }

  try {
    const instrument = await resolveInstrument(body.instrument_key);
    if (!instrument) {
      return NextResponse.json({ ok: false, error: `Unknown instrument ${body.instrument_key}` }, { status: 404 });
    }
    const session = sessionState();
    const quotes = await getQuotes([instrument.instrument_key], session);
    const payload: OrderRequest = {
      instrument_key: instrument.instrument_key,
      side: body.side === "SELL" ? "SELL" : "BUY",
      quantity: Number(body.quantity || 0),
      order_type: body.order_type || "MARKET",
      product: body.product || "CNC",
      limit_price: body.limit_price ?? null,
      trigger_price: body.trigger_price ?? null,
    };
    const result = await placeOrder(payload, quotes, session);
    return NextResponse.json(
      { ok: result.ok, order: result.order, error: result.error, session },
      { status: result.ok ? 200 : 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Order failed" },
      { status: 400 }
    );
  }
}
