import { AppSessionChrome } from "@/features/shell/AppSessionChrome";
import { AppMainNav } from "@/features/shell/AppMainNav";
import { AppShellBrandLink } from "@/features/shell/AppShellBrandLink";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-backdrop flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-40 bg-header text-header-fg shadow-md">
        <div className="h-0.5 w-full bg-brand" aria-hidden />
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-3 px-4 py-3 sm:gap-x-5">
          <AppShellBrandLink />

          <AppMainNav />

          <div className="ml-auto flex shrink-0 items-center">
            <AppSessionChrome />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
