"use client";

import { AppProvider } from "../AppProvider";
import { AIDrawer } from "./AIDrawer";
import { FloatingRail } from "./TickerBar";
import { OrderModal } from "./OrderModal";
import { SearchOverlay } from "./SearchOverlay";
import { Sidebar } from "./Sidebar";
import { TickerBar } from "./TickerBar";
import { Toasts } from "./Toasts";
import { TopNav } from "./TopNav";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <div className="top-shell">
        <TickerBar />
        <TopNav />
      </div>
      <div className="shell">
        <Sidebar />
        <main className="main">{children}</main>
      </div>
      <FloatingRail />
      <SearchOverlay />
      <OrderModal />
      <AIDrawer />
      <Toasts />
    </AppProvider>
  );
}
