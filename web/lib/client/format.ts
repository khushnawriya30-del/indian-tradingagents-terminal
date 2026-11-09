import type { Quote } from "@/lib/types";

export function inr(value: number | null | undefined, digits = 2): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function compactInr(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_00_00_000) return `${(n / 1_00_00_000).toFixed(2)} Cr`;
  if (abs >= 1_00_000) return `${(n / 1_00_000).toFixed(2)} L`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(2)} K`;
  return inr(n, 0);
}

export function pct(value: number | null | undefined, digits = 2): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

export function signed(value: number | null | undefined, digits = 2): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${inr(n, digits)}`;
}

export function changeText(q: Pick<Quote, "change" | "change_percent"> | null | undefined): string {
  if (!q) return "—";
  const c = Number(q.change || 0);
  const p = Number(q.change_percent || 0);
  return `${c >= 0 ? "+" : ""}${c.toFixed(2)} (${p.toFixed(2)}%)`;
}

export function tone(value: number | null | undefined): "pos" | "neg" | "flat" {
  const n = Number(value ?? 0);
  if (n > 0) return "pos";
  if (n < 0) return "neg";
  return "flat";
}

const LOGO_COLORS = [
  "#542087", "#007a4f", "#c63224", "#1a519a", "#b26a00",
  "#7132b0", "#0f766e", "#9d174d", "#3f6212", "#7c2d12",
];

export function logoColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return LOGO_COLORS[h % LOGO_COLORS.length];
}

export function monogram(symbol: string): string {
  const clean = (symbol || "?").replace(/[^A-Za-z0-9]/g, "");
  if (!clean) return "?";
  if (clean.length <= 2) return clean.toUpperCase();
  // use the first letters of up to two words when the symbol has a natural split
  const parts = (symbol || "").split(/[\s-]+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}

export function expiryLabel(iso: string | number | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(typeof iso === "number" ? iso : iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }).toUpperCase();
}

export function timeLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function dateTimeLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} · ${timeLabel(iso)}`;
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
