import { OIAnalysisPage } from "@/components/upstox/pages/fno";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ symbol?: string }> }) {
  const { symbol } = await searchParams;
  return <OIAnalysisPage initialSymbol={symbol || "NIFTY"} />;
}
