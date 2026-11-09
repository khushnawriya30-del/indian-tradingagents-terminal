import { NextResponse } from "next/server";

import { resolveInstrument } from "@/lib/server/instruments";
import { logoUrl, resolveLogoId, type LogoKind } from "@/lib/server/logos";

export const runtime = "nodejs";

const WEEK = 60 * 60 * 24 * 7;

const INDEX_NAMES = new Set([
  "NIFTY",
  "NIFTY 50",
  "NIFTY50",
  "BANKNIFTY",
  "NIFTY BANK",
  "FINNIFTY",
  "NIFTY FIN SERVICE",
  "MIDCPNIFTY",
  "NIFTY MID SELECT",
  "NIFTYNXT50",
  "SENSEX",
  "BANKEX",
  "INDIA VIX",
  "INDIAVIX",
  "NIFTY IT",
  "NIFTY AUTO",
  "NIFTY PHARMA",
  "NIFTY FMCG",
  "NIFTY METAL",
  "NIFTY ENERGY",
  "NIFTY REALTY",
  "NIFTY PSU BANK",
  "NIFTY MEDIA",
  "NIFTY INFRA",
  "NIFTY 500",
  "NIFTY 100",
  "NIFTY 200",
  "NIFTY MIDCAP 100",
  "NIFTY SMALLCAP 100",
  "NIFTY NEXT 50",
]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawKey = url.searchParams.get("key") || "";
  const kindParam = (url.searchParams.get("kind") || "").toLowerCase();
  let symbol = (url.searchParams.get("symbol") || "").trim().toUpperCase();
  let exchange = (url.searchParams.get("exchange") || "").toUpperCase();
  let kind: LogoKind = kindParam === "index" ? "index" : "stock";

  if (rawKey) {
    if (rawKey.includes("_INDEX")) kind = "index";
    const ins = await resolveInstrument(rawKey).catch(() => null);
    if (ins?.trading_symbol) symbol = ins.trading_symbol.toUpperCase();
    if (ins?.is_index) kind = "index";
    if (!exchange) exchange = rawKey.startsWith("BSE") ? "BSE" : "NSE";
  }

  if (!symbol) return new NextResponse(null, { status: 404 });

  // Derivative contracts inherit the underlying's identity.
  const underlying = symbol.match(/^([A-Z]+(?:\s+[A-Z]+)?)\s+\d+/)?.[1];
  if (underlying && underlying !== symbol) symbol = underlying;

  if (INDEX_NAMES.has(symbol)) kind = "index";
  if (/^NIFTY/.test(symbol) || /INDEX$/.test(symbol) || /^CNX/.test(symbol)) kind = "index";
  if (symbol === "SENSEX" || symbol === "BANKEX") {
    kind = "index";
    if (!exchange) exchange = "BSE";
  }

  if (!exchange) exchange = "NSE";

  const logoid = await resolveLogoId(symbol, exchange, kind);
  if (!logoid) {
    return new NextResponse(null, {
      status: 404,
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  }

  return NextResponse.redirect(logoUrl(logoid), {
    status: 302,
    headers: { "Cache-Control": `public, max-age=${WEEK}, immutable` },
  });
}
