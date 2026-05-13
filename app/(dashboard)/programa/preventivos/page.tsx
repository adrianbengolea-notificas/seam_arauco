import type { Metadata } from "next";
import { Suspense } from "react";
import { PreventivosHubClient } from "./preventivos-hub-client";

export const metadata: Metadata = {
  title: "Planes preventivos — calendario y vencimientos",
  description:
    "Calendario anual según meses programados en los planes de aviso preventivo y seguimiento de vencimientos (mensual a anual).",
};

function PreventivosFallback() {
  return (
    <div className="space-y-6 px-1 animate-pulse" aria-hidden="true">
      <div className="h-12 w-full max-w-xl rounded-lg bg-foreground/10" />
      <div className="h-9 w-64 rounded-md bg-foreground/10" />
      <div className="h-28 w-full max-w-5xl rounded-xl bg-foreground/[0.04]" />
    </div>
  );
}

export default function ProgramaPreventivosPage() {
  return (
    <Suspense fallback={<PreventivosFallback />}>
      <PreventivosHubClient />
    </Suspense>
  );
}
