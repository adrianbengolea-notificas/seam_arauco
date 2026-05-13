"use client";

import { AppSessionChrome } from "@/features/shell/AppSessionChrome";
import { AppSidebar } from "@/features/shell/AppSidebar";
import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isLogin = pathname === "/login" || pathname?.startsWith("/login/");

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  if (isLogin) {
    return <div className="app-backdrop flex min-h-full flex-1 flex-col">{children}</div>;
  }

  return (
    <div className="app-backdrop flex min-h-full flex-1">
      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[1px] md:hidden"
          aria-label="Cerrar menú"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}
      <AppSidebar mobileOpen={mobileOpen} onNavigate={() => setMobileOpen(false)} />
      <div className="flex min-h-full min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface/90 px-3 backdrop-blur supports-[backdrop-filter]:bg-surface/80 sm:px-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 w-9 shrink-0 p-0 md:hidden"
            onClick={() => setMobileOpen((o) => !o)}
            aria-expanded={mobileOpen}
            aria-controls="app-sidebar-nav"
          >
            {mobileOpen ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
          </Button>
          <div className="ml-auto flex min-w-0 items-center">
            <AppSessionChrome />
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</main>
      </div>
    </div>
  );
}
