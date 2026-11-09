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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const keys = [
    ...INDEX_KEYS,
    ...(url.searchParams.get("keys") || "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean),
  ];
  const unique = [...new Set(keys)].slice(0, 80);

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const tick = async () => {
        if (closed) return;
        const session = sessionState();
        let quotes = {};
        let warning: string | undefined;
        try {
          quotes = await getQuotes(unique, session);
        } catch (error) {
          warning = error instanceof Error ? error.message : "quote stream error";
        }
        send({ type: "tick", at: new Date().toISOString(), session, quotes, warning });
        if (!closed) timer = setTimeout(tick, 1000);
      };

      send({ type: "hello", keys: unique, at: new Date().toISOString() });
      void tick();

      request.signal.addEventListener("abort", () => {
        closed = true;
        if (timer) clearTimeout(timer);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      closed = true;
      if (timer) clearTimeout(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
