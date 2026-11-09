const API_BASE = "https://api.upstox.com";

function isTokenValid(token?: string): boolean {
  if (!token || token.trim().length < 20) return false;
  try {
    const parts = token.trim().split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

export function getUpstoxToken(): string {
  const access = (process.env.UPSTOX_ACCESS_TOKEN || "").trim();
  const analytics = (process.env.UPSTOX_ANALYTICS_TOKEN || "").trim();
  if (isTokenValid(access)) return access;
  if (isTokenValid(analytics)) return analytics;
  return access || analytics || "";
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json" };
  const token = getUpstoxToken();
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export async function quotes(keys: string[]): Promise<Record<string, any>> {
  if (!keys.length) return {};
  const token = getUpstoxToken();
  if (!token) return {};

  const out: Record<string, any> = {};
  // Upstox accepts a large batch; 500 keys round-trip in ~150ms. Verify the
  // batch is fully accepted and fall back to smaller chunks if it is not.
  const CHUNK = 500;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const chunk = keys.slice(i, i + CHUNK);
    const url = `${API_BASE}/v2/market-quote/quotes?instrument_key=${encodeURIComponent(chunk.join(","))}`;
    try {
      const res = await fetch(url, { headers: headers(), cache: "no-store" });
      if (!res.ok) continue;
      const json = await res.json();
      if (json.status === "success" && json.data) {
        for (const [k, v] of Object.entries(json.data)) {
          const norm = k.replace(":", "|");
          out[norm] = v;
          if ((v as any)?.instrument_token) {
            out[(v as any).instrument_token] = v;
          }
          if ((v as any)?.symbol) {
            out[`NSE_EQ|${(v as any).symbol}`] = v;
          }
        }
      }
    } catch {
      // ignore
    }
  }
  return out;
}

export async function historicalCandles(
  instrumentKey: string,
  params: { unit: string; interval: number | string; fromDate: string; toDate: string }
): Promise<any[]> {
  const { unit, interval, fromDate, toDate } = params;
  const url = `${API_BASE}/v3/historical-candle/${encodeURIComponent(instrumentKey)}/${unit}/${interval}/${toDate}/${fromDate}`;
  const res = await fetch(url, { headers: headers(), cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upstox historical candles failed (${res.status}): ${text.slice(0, 100)}`);
  }
  const json = await res.json();
  return json?.data?.candles || [];
}

export async function intradayCandles(
  instrumentKey: string,
  unit: string,
  interval: number | string
): Promise<any[]> {
  const url = `${API_BASE}/v3/historical-candle/intraday/${encodeURIComponent(instrumentKey)}/${unit}/${interval}`;
  const res = await fetch(url, { headers: headers(), cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upstox intraday candles failed (${res.status}): ${text.slice(0, 100)}`);
  }
  const json = await res.json();
  return json?.data?.candles || [];
}

export async function optionContracts(underlyingKey: string): Promise<any[]> {
  const url = `${API_BASE}/v2/option/contract?instrument_key=${encodeURIComponent(underlyingKey)}`;
  const res = await fetch(url, { headers: headers(), cache: "no-store" });
  if (!res.ok) return [];
  const json = await res.json();
  return json.data || [];
}

export async function optionChain(underlyingKey: string, expiry: string): Promise<any[]> {
  const url = `${API_BASE}/v2/option/chain?instrument_key=${encodeURIComponent(underlyingKey)}&expiry_date=${expiry}`;
  const res = await fetch(url, { headers: headers(), cache: "no-store" });
  if (!res.ok) return [];
  const json = await res.json();
  return json.data || [];
}

export async function expiries(underlyingKey: string): Promise<string[]> {
  const contracts = await optionContracts(underlyingKey);
  const set = new Set<string>();
  for (const c of contracts) {
    if (c.expiry) {
      set.add(String(c.expiry).slice(0, 10));
    }
  }
  return Array.from(set).sort();
}
