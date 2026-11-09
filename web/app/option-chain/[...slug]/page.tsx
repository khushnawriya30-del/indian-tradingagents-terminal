import { OptionChainPage } from "@/components/upstox/pages/option-chain";

export const dynamic = "force-dynamic";

/**
 * Upstox deep links look like `/option-chain/NSE_INDEX/Nifty%2050`, so the
 * underlying arrives as two path segments rather than a query string.
 */
const SLUG_TO_SYMBOL: Record<string, string> = {
  "nifty 50": "NIFTY",
  nifty: "NIFTY",
  "nifty bank": "BANKNIFTY",
  banknifty: "BANKNIFTY",
  "nifty fin service": "FINNIFTY",
  finnifty: "FINNIFTY",
  "nifty financial services": "FINNIFTY",
  "nifty mid select": "MIDCPNIFTY",
  midcpnifty: "MIDCPNIFTY",
  "bse sensex": "SENSEX",
  sensex: "SENSEX",
};

function resolver(slug: string[]): string {
  const cleaned = slug
    .map((part) => decodeURIComponent(part).replace(/_/g, " ").trim().toLowerCase())
    .filter((part) => part && part !== "nse" && part !== "eq" && part !== "index" && part !== "fo");
  for (let i = cleaned.length - 1; i >= 0; i -= 1) {
    const hit = SLUG_TO_SYMBOL[cleaned[i]];
    if (hit) return hit;
  }
  return "NIFTY";
}

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  return <OptionChainPage initialSymbol={resolver(slug || [])} />;
}
