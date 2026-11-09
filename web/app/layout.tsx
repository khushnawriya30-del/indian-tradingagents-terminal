import type { Metadata, Viewport } from "next";

import { AppShell } from "@/components/upstox/shell/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Upstox Pro — Paper Trading Terminal",
  description:
    "Indian markets paper-trading terminal with the full TradingAgents 12-agent research desk, official Upstox market data, Screener fundamentals and NSE option analytics.",
  applicationName: "Upstox Pro · Paper",
  authors: [{ name: "TradingAgents India" }],
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
