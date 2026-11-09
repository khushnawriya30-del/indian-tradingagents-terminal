import fs from "node:fs";
import path from "node:path";

import { dataDir } from "@/lib/server/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ReportMeta {
  id: string;
  symbol: string;
  name: string;
  ticker: string;
  date: string;
  created_at: string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function auditBanner(meta: ReportMeta | null): string {
  if (!meta) return "";
  const ticker = meta.symbol.replace(/\.(NS|BO)$/i, "");
  const links = [
    ["Screener.in", `https://www.screener.in/company/${ticker}/consolidated/`],
    ["Moneycontrol", `https://www.moneycontrol.com/india/stockpricequote/${ticker}`],
    ["NSE", `https://www.nseindia.com/get-quotes/equity?symbol=${ticker}`],
    ["TradingView", `https://www.tradingview.com/symbols/NSE-${ticker}/`],
  ];
  return `<div style="margin:0;padding:18px 32px;background:#0b1017;border-bottom:1px solid #1e2a36;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;color:#d7e3ee">
  <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#5f7a90">TradingAgents India · audit trail</div>
  <div style="font-size:20px;font-weight:700;margin-top:6px">${escapeHtml(meta.symbol)} <span style="color:#7d93a8;font-weight:400">· ${escapeHtml(meta.name || "")}</span></div>
  <div style="font-size:12px;color:#8ba3b8;margin-top:4px">Decision date ${escapeHtml(meta.date)} · generated ${escapeHtml(meta.created_at)}</div>
  <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:14px;font-size:12px">
    ${links.map(([label, href]) => `<a href="${href}" style="color:#38bdf8;text-decoration:none">${label} &rarr;</a>`).join("")}
  </div>
</div>`;
}

function section(title: string, body: unknown): string {
  if (!body) return "";
  return `<section style="margin:28px 0">
  <h2 style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#67e8f9;border-bottom:1px solid #1e2a36;padding-bottom:8px">${escapeHtml(title)}</h2>
  <pre style="white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.65;color:#c9d7e4">${escapeHtml(body)}</pre>
</section>`;
}

function fallbackReport(payload: any, meta: ReportMeta | null): string {
  const rating = payload?.rating;
  const ratingText =
    typeof rating === "string"
      ? rating
      : rating?.action
        ? `${rating.action}${rating.confidence ? ` · confidence ${rating.confidence}` : ""}${rating.rationale ? ` — ${rating.rationale}` : ""}`
        : "—";
  const debate = payload?.research_debate || {};
  const risk = payload?.risk_debate || {};
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(meta?.symbol || payload?.ticker || "TradingAgents")} · Research Report</title>
</head>
<body style="margin:0;background:#05080c;color:#d7e3ee;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif">
${auditBanner(meta)}
<main style="max-width:980px;margin:0 auto;padding:32px 28px 80px">
  <div style="display:flex;align-items:center;gap:16px;margin:8px 0 26px">
    <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#5f7a90">House view</div>
    <div style="font-size:18px;font-weight:700;color:#f8fafc">${escapeHtml(ratingText)}</div>
  </div>
  ${section("Market analyst", payload?.reports?.market)}
  ${section("Sentiment analyst", payload?.reports?.sentiment)}
  ${section("News analyst", payload?.reports?.news)}
  ${section("Fundamentals analyst", payload?.reports?.fundamentals)}
  ${section("Bull researcher", debate?.bull_history)}
  ${section("Bear researcher", debate?.bear_history)}
  ${section("Research manager", payload?.investment_plan || debate?.judge_decision)}
  ${section("Trader plan", payload?.trader_plan)}
  ${section("Aggressive risk analyst", risk?.aggressive_history)}
  ${section("Conservative risk analyst", risk?.conservative_history)}
  ${section("Neutral risk analyst", risk?.neutral_history)}
  ${section("Portfolio manager decision", payload?.final_decision || risk?.judge_decision)}
  <footer style="margin-top:40px;padding-top:16px;border-top:1px solid #1e2a36;color:#5f7a90;font-size:11px">
    Generated ${escapeHtml(payload?.generated_at || new Date().toISOString())} · TradingAgents India · NSE/BSE research desk
  </footer>
</main>
</body>
</html>`;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    return new Response("Invalid report id", { status: 400 });
  }
  const dir = path.join(dataDir(), "reports", id);
  const metaPath = path.join(dir, "meta.json");
  const htmlPath = path.join(dir, "report", "complete_report.html");
  const jobPath = path.join(dir, "job.json");

  let meta: ReportMeta | null = null;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as ReportMeta;
  } catch {
    meta = null;
  }

  let html: string | null = null;
  if (fs.existsSync(htmlPath)) {
    html = fs.readFileSync(htmlPath, "utf-8");
    const banner = auditBanner(meta);
    if (banner) {
      if (/<body[^>]*>/i.test(html)) {
        html = html.replace(/<body[^>]*>/i, (match) => `${match}${banner}`);
      } else {
        html = banner + html;
      }
    }
  } else if (fs.existsSync(jobPath)) {
    const payload = JSON.parse(fs.readFileSync(jobPath, "utf-8"));
    html = fallbackReport(payload, meta);
  }

  if (!html) return new Response("Report not found", { status: 404 });

  const download = new URL(request.url).searchParams.get("download") === "1";
  const filename = `${meta?.symbol || "TradingAgents"}_${meta?.date || new Date().toISOString().slice(0, 10)}_research.html`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      ...(download
        ? { "Content-Disposition": `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"` }
        : {}),
    },
  });
}
