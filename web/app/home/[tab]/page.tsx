import { notFound } from "next/navigation";

import { HomeFeed } from "@/components/upstox/home/HomeFeed";

const TABS = new Set(["stocks", "options", "futures", "commodity", "ipo"]);

export const dynamic = "force-dynamic";

export default async function HomeTabPage({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params;
  if (!TABS.has(tab)) notFound();
  return <HomeFeed tab={tab === "ipo" ? "stocks" : tab} />;
}
