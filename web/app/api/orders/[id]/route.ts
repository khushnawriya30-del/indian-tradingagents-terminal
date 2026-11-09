import { NextResponse } from "next/server";

import { cancelOrder } from "@/lib/server/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    const order = await cancelOrder(id);
    if (!order) return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    return NextResponse.json({ ok: true, order });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Cancel failed" },
      { status: 400 }
    );
  }
}
