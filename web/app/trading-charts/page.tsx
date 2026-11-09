import { TradingChartPage } from "@/components/upstox/pages/trading-charts";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string; side?: string }>;
}) {
  const { symbol, side } = await searchParams;
  return (
    <TradingChartPage
      initialKey={symbol || "NSE_INDEX|Nifty 50"}
      initialSide={side === "SELL" ? "SELL" : "BUY"}
    />
  );
}
