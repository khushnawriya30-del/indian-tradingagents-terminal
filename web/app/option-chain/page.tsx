import { OptionChainPage } from "@/components/upstox/pages/option-chain";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ symbol?: string }> }) {
  const { symbol } = await searchParams;
  return <OptionChainPage initialSymbol={symbol || "NIFTY"} />;
}
