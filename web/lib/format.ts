export function price(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `₹${price(value)}`;
}

export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function signed(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}₹${price(Math.abs(value))}`;
}

export function toneClass(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || Math.abs(value) < 0.0001) {
    return "text-zinc-400";
  }
  return value > 0 ? "text-emerald-400" : "text-rose-400";
}

export function compactNumber(num: number | null | undefined): string {
  if (num === null || num === undefined || !Number.isFinite(num)) return "—";
  const abs = Math.abs(num);
  if (abs >= 1e7) return `${(num / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${(num / 1e5).toFixed(2)} L`;
  if (abs >= 1e3) return `${(num / 1e3).toFixed(1)} k`;
  return num.toLocaleString("en-IN");
}

export function moneyCompact(num: number | null | undefined): string {
  if (num === null || num === undefined || !Number.isFinite(num)) return "—";
  return `₹${compactNumber(num)}`;
}

export function countdown(seconds: number): string {
  if (seconds <= 0) return "00:00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}
