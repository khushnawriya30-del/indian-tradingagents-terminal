import fs from "node:fs";
import path from "node:path";

import { dataDir } from "@/lib/server/env";
import { resolveInstrument, yahooSymbol } from "@/lib/server/instruments";
import { spawnPython } from "@/lib/server/python";
import { sessionState } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 3600;

declare global {
  // eslint-disable-next-line no-var
  var __analysisActive: boolean | undefined;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export async function POST(request: Request) {
  if (globalThis.__analysisActive) {
    return Response.json(
      { error: "An analysis run is already in progress. Wait for it to finish." },
      { status: 409 }
    );
  }

  let body: {
    symbol?: string;
    date?: string;
    debate_rounds?: number;
    risk_rounds?: number;
    tool_rounds?: number;
    analysts?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const symbol = body.symbol;
  if (!symbol) return Response.json({ error: "symbol required" }, { status: 400 });

  const instrument = await resolveInstrument(symbol);
  if (!instrument) return Response.json({ error: `Unknown instrument ${symbol}` }, { status: 404 });
  if (!["NSE_EQ", "BSE_EQ"].includes(instrument.segment)) {
    return Response.json(
      { error: "Full AI coverage currently targets NSE/BSE cash equities" },
      { status: 400 }
    );
  }

  const ticker = yahooSymbol(instrument.trading_symbol, instrument);
  const date = body.date || sessionState().last_close_date;
  const debate = clamp(body.debate_rounds, 1, 3, 1);
  const risk = clamp(body.risk_rounds, 1, 3, 1);
  const tools = clamp(body.tool_rounds, 2, 12, Number(process.env.TRADINGAGENTS_MAX_TOOL_ROUNDS || 8));
  const analysts = body.analysts || "market,social,news,fundamentals";

  const id = `${instrument.trading_symbol.replace(/[^A-Za-z0-9]/g, "")}-${date}-${Date.now()}`;
  const dir = path.join(dataDir(), "reports", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "meta.json"),
    JSON.stringify(
      {
        id,
        symbol: instrument.trading_symbol,
        name: instrument.name,
        instrument_key: instrument.instrument_key,
        ticker,
        date,
        created_at: new Date().toISOString(),
      },
      null,
      2
    )
  );

  const args = [
    "--ticker",
    ticker,
    "--date",
    date,
    "--out",
    path.join(dir, "job.json"),
    "--debate-rounds",
    String(debate),
    "--risk-rounds",
    String(risk),
    "--tool-rounds",
    String(tools),
    "--analysts",
    analysts,
  ];

  globalThis.__analysisActive = true;
  const child = spawnPython("scripts/analyze.py", args);
  const encoder = new TextEncoder();
  let buffer = "";
  let sawFinal = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        } catch {
          // client disconnected; the run still finishes and saves its report
        }
      };

      send({
        type: "bridge_started",
        id,
        ticker,
        date,
        settings: { debate_rounds: debate, risk_rounds: risk, tool_rounds: tools, analysts },
      });

      const consume = (chunk: string) => {
        buffer += chunk;
        let index = buffer.indexOf("\n");
        while (index >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (line) {
            try {
              const event = JSON.parse(line);
              if (event?.type === "final") sawFinal = true;
              send(event);
            } catch {
              send({ type: "log", message: line.slice(0, 2000) });
            }
          }
          index = buffer.indexOf("\n");
        }
      };

      child.stdout?.on("data", (chunk) => consume(String(chunk)));
      child.stderr?.on("data", (chunk) => {
        const text = String(chunk).trim();
        if (text) send({ type: "log", message: text.slice(-3000) });
      });

      child.on("error", (error) => {
        globalThis.__analysisActive = false;
        send({ type: "error", message: error.message });
        try {
          controller.close();
        } catch {
          // closed
        }
      });

      child.on("close", (code) => {
        if (buffer.trim()) consume("\n");
        globalThis.__analysisActive = false;
        const html = path.join(dir, "report", "complete_report.html");
        const job = path.join(dir, "job.json");
        if (sawFinal || fs.existsSync(job)) {
          send({
            type: "report_ready",
            id,
            download: `/api/report/${id}?download=1`,
            view: `/api/report/${id}`,
            html_ready: fs.existsSync(html),
          });
        }
        if (code !== 0) {
          send({ type: "error", message: `Analysis bridge exited with code ${code}` });
        }
        try {
          controller.close();
        } catch {
          // closed
        }
      });
    },
    cancel() {
      // Detaching the drawer must not throw away a running analysis.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
