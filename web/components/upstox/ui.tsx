"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { cx, pct } from "@/lib/client/format";
import { ChevronRight } from "./icons";
import { Logo } from "./Logo";

export function Section({
  icon,
  title,
  href,
  actions,
  children,
  note,
}: {
  icon?: ReactNode;
  title: string;
  href?: string;
  actions?: ReactNode;
  children: ReactNode;
  note?: string;
}) {
  const head = (
    <div className="section-head">
      {icon && <span className="section-icon">{icon}</span>}
      <span className="section-title">{title}</span>
      {href && (
        <span className="chev">
          <ChevronRight size={14} />
        </span>
      )}
      {note && <span className="section-note">{note}</span>}
      {actions && <div className="section-actions">{actions}</div>}
    </div>
  );
  return (
    <section className="section">
      {href ? (
        <Link href={href} style={{ display: "block" }}>
          {head}
        </Link>
      ) : (
        head
      )}
      {children}
    </section>
  );
}

export function Chip({
  active,
  children,
  onClick,
  className,
  caret,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  caret?: boolean;
}) {
  return (
    <button className={cx("chip", active && "active", className)} onClick={onClick} type="button">
      {children}
      {caret && (
        <span className="caret">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      )}
    </button>
  );
}

export function Change({
  value,
  percent,
  showPercent = true,
  digits = 2,
}: {
  value: number;
  percent?: number;
  showPercent?: boolean;
  digits?: number;
}) {
  const up = value >= 0;
  const text = `${up ? "+" : ""}${value.toFixed(digits)}${showPercent && percent !== undefined ? ` (${pct(percent)})` : ""}`;
  return <span className={cx(up ? "pos" : "neg", "num")}>{text}</span>;
}

export function Tag({ children, tone }: { children: ReactNode; tone?: "brand" | "pos" | "neg" | "outline" }) {
  return <span className={cx("tag", tone)}>{children}</span>;
}

export function StockCard({
  symbol,
  price,
  change,
  changePercent,
  onClick,
}: {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  onClick?: () => void;
}) {
  return (
    <div className="stock-card" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onClick?.()}>
      <Logo symbol={symbol} size={30} radius={8} />
      <div className="stock-card-sym ellipsis">{symbol}</div>
      <div className="stock-card-price">{price ? price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</div>
      <div className={cx("stock-card-chg", change >= 0 ? "pos" : "neg")}>
        {change >= 0 ? "+" : ""}
        {change.toFixed(2)} ({pct(changePercent)})
      </div>
    </div>
  );
}

export function SymbolCell({
  symbol,
  name,
  segment,
  tags,
}: {
  symbol: string;
  name?: string;
  segment?: string;
  tags?: ReactNode;
}) {
  return (
    <div className="symcell">
      <Logo symbol={symbol} size={24} radius={5} />
      <div className="symcell-text">
        <div className="symcell-name">
          <span className="ellipsis">{symbol}</span>
          {tags}
        </div>
        {(name || segment) && (
          <div className="symcell-meta ellipsis">
            {segment && <span>{segment.replace("NSE_EQ", "NSE").replace("BSE_EQ", "BSE").replace("NSE_FO", "NFO").replace("MCX_FO", "MCX")}</span>}
            {name && segment && <span>·</span>}
            {name && <span className="ellipsis">{name}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

export function Sparkline({
  open,
  high,
  low,
  close,
  up,
  width = 64,
  height = 20,
}: {
  open: number;
  high: number;
  low: number;
  close: number;
  up: boolean;
  width?: number;
  height?: number;
}) {
  const values = [open, (open + high) / 2, high, (high + close) / 2, close, (close + low) / 2, low, (low + open) / 2, close];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polyline
        points={points}
        fill="none"
        stroke={up ? "var(--pos)" : "var(--neg)"}
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div
      style={{
        border: "1px dashed var(--stroke)",
        borderRadius: 8,
        padding: "28px 16px",
        textAlign: "center",
        color: "var(--text-2)",
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 600, color: "var(--text)" }}>{title}</div>
      {hint && <div style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export function Skeleton({ height = 120 }: { height?: number }) {
  return <div className="sk" style={{ height, width: "100%" }} />;
}

export function Segmented({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: string; label: string }>;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div style={{ display: "inline-flex", border: "1px solid var(--stroke)", borderRadius: 6, overflow: "hidden" }}>
      {options.map((option) => (
        <button
          key={option.id}
          onClick={() => onChange(option.id)}
          style={{
            height: 30,
            padding: "0 12px",
            border: 0,
            borderRight: "1px solid var(--stroke)",
            background: value === option.id ? "var(--brand-callout)" : "#fff",
            color: value === option.id ? "var(--brand)" : "var(--text)",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
