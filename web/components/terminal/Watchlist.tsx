"use client";

import { percent, price, toneClass } from "@/lib/format";
import type { Quote, WatchlistItem } from "@/lib/types";

interface WatchlistProps {
  items: WatchlistItem[];
  quotes: Record<string, Quote>;
  selectedKey: string;
  onSelect: (item: WatchlistItem) => void;
  onRemove: (item: WatchlistItem) => void;
}

export function Watchlist({ items, quotes, selectedKey, onSelect, onRemove }: WatchlistProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel)]">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
          Watchlist
        </span>
        <span className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[9px] tabular-nums text-zinc-500">
          {items.length}
        </span>
      </div>
      <div className="max-h-[calc(100vh-330px)] overflow-y-auto minimal-scroll">
        {items.length === 0 && (
          <div className="px-3 py-6 text-center text-[11px] text-zinc-500">
            Search a symbol above to start the tape.
          </div>
        )}
        {items.map((item) => {
          const quote = quotes[item.instrument_key];
          const active = selectedKey === item.instrument_key;
          const isIndex = item.segment.endsWith("_INDEX");
          return (
            <div
              key={item.instrument_key}
              className={`group relative cursor-pointer border-b border-[var(--line)]/60 px-3 py-2 transition last:border-0 ${
                active ? "bg-sky-500/[0.08]" : "hover:bg-white/[0.02]"
              }`}
              onClick={() => onSelect(item)}
            >
              {active && <span className="absolute left-0 top-0 h-full w-[2px] bg-sky-400" />}
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[11.5px] font-semibold tracking-wide text-zinc-200">
                      {isIndex ? quote?.symbol || item.symbol : item.symbol}
                    </span>
                    {isIndex && (
                      <span className="rounded bg-amber-500/10 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-amber-300/80">
                        IDX
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-[9px] text-zinc-600">
                    {quote?.name || item.name || item.segment}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[11.5px] tabular-nums text-zinc-100">
                    {price(quote?.last_price)}
                  </div>
                  <div className={`font-mono text-[9.5px] tabular-nums ${toneClass(quote?.change_percent)}`}>
                    {percent(quote?.change_percent)}
                  </div>
                </div>
              </div>
              {!isIndex && (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove(item);
                  }}
                  className="absolute right-1 top-1 hidden h-4 w-4 items-center justify-center rounded text-[10px] text-zinc-500 hover:bg-rose-500/20 hover:text-rose-300 group-hover:flex"
                  title="Remove from watchlist"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
