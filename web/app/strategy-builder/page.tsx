import { StrategyBuilderPage } from "@/components/upstox/pages/strategy-builder";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ symbol?: string }> }) {
  const { symbol } = await searchParams;
  return <StrategyBuilderPage initialSymbol={symbol || "NIFTY"} />;
}
