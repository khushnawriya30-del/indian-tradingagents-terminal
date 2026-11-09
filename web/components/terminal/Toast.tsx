"use client";

import { useEffect, useState } from "react";

export interface ToastMessage {
  id: number;
  tone: "success" | "error" | "warn" | "info";
  title: string;
  message?: string;
}

const TONE: Record<ToastMessage["tone"], string> = {
  success: "border-emerald-500/35 bg-emerald-500/[0.08] text-emerald-300",
  error: "border-rose-500/35 bg-rose-500/[0.08] text-rose-300",
  warn: "border-amber-500/35 bg-amber-500/[0.08] text-amber-300",
  info: "border-sky-500/35 bg-sky-500/[0.08] text-sky-300",
};

export function Toast({
  message,
  onDismiss,
}: {
  message: ToastMessage | null;
  onDismiss: () => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!message) return;
    setVisible(true);
    let clear: ReturnType<typeof setTimeout> | null = null;
    const timer = setTimeout(() => {
      setVisible(false);
      clear = setTimeout(onDismiss, 180);
    }, 4200);
    return () => {
      clearTimeout(timer);
      if (clear) clearTimeout(clear);
    };
  }, [message?.id]);

  if (!message) return null;

  return (
    <div
      className={`pointer-events-none fixed bottom-4 right-4 z-[60] w-[300px] rounded-lg border bg-[#0b1117] px-3 py-2.5 shadow-2xl shadow-black/60 transition-all duration-200 ${
        visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      } ${TONE[message.tone]}`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-[10px]">{message.tone === "success" ? "✓" : message.tone === "error" ? "✕" : "•"}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold tracking-wide">{message.title}</div>
          {message.message && (
            <div className="mt-0.5 break-words text-[10px] leading-relaxed text-zinc-400">
              {message.message}
            </div>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="pointer-events-auto text-[11px] text-zinc-600 hover:text-zinc-300"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}
