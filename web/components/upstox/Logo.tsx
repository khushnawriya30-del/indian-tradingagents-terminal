"use client";

import { useState } from "react";

import { logoColor, monogram } from "@/lib/client/format";

export function Logo({
  symbol,
  size = 30,
  radius = 6,
  exchange,
  label,
}: {
  symbol: string;
  size?: number;
  radius?: number;
  exchange?: string;
  label?: string;
}) {
  const [failed, setFailed] = useState(false);
  const text = monogram(label || symbol);
  const src = `/api/logo?symbol=${encodeURIComponent(symbol)}${exchange ? `&exchange=${exchange}` : ""}`;

  return (
    <span
      className="inst-logo"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: failed ? logoColor(symbol) : "#fff",
        fontSize: Math.max(9, Math.round(size * 0.34)),
      }}
      aria-hidden
    >
      {!failed && (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
      {failed && <span>{text}</span>}
    </span>
  );
}
