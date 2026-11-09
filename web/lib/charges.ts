import type { Product, Side } from "./types";

export function round2(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

export interface ChargesBreakdown {
  brokerage: number;
  stt: number;
  exchange: number;
  sebi: number;
  gst: number;
  stamp: number;
  total: number;
}

export function computeCharges(
  side: Side,
  product: Product,
  price: number,
  quantity: number
): ChargesBreakdown {
  const turnover = price * quantity;
  if (turnover <= 0) {
    return { brokerage: 0, stt: 0, exchange: 0, sebi: 0, gst: 0, stamp: 0, total: 0 };
  }

  // Brokerage: ₹0 for CNC equity delivery, ₹20 or 0.05% for MIS
  const brokerage = product === "CNC" ? 0 : Math.min(20, round2(turnover * 0.0005));

  // STT / CTT: 0.1% on delivery buy/sell, 0.025% on intraday sell only
  let stt = 0;
  if (product === "CNC") {
    stt = round2(turnover * 0.001);
  } else if (side === "SELL") {
    stt = round2(turnover * 0.00025);
  }

  // Exchange transaction charges (NSE equity ~ 0.00325%)
  const exchange = round2(turnover * 0.0000325);

  // SEBI turnover charges (₹10 per crore = 0.0001%)
  const sebi = round2(turnover * 0.000001);

  // GST: 18% on (brokerage + exchange + sebi)
  const gst = round2((brokerage + exchange + sebi) * 0.18);

  // Stamp duty: 0.015% on buy delivery, 0.003% on buy intraday (applicable on BUY only)
  let stamp = 0;
  if (side === "BUY") {
    stamp = product === "CNC" ? round2(turnover * 0.00015) : round2(turnover * 0.00003);
  }

  const total = round2(brokerage + stt + exchange + sebi + gst + stamp);

  return {
    brokerage,
    stt,
    exchange,
    sebi,
    gst,
    stamp,
    total,
  };
}
