"use client";

import { usePermisos } from "@/lib/permisos/usePermisos";
import { cn } from "@/lib/utils";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect } from "react";
import { AnualClient } from "../anual/anual-client";
import { VencimientosClient } from "../vencimientos/vencimientos-client";

type Pestana = "calendario" | "vencimientos";

export function PreventivosHubClient() {
  const { puede } = usePermisos();
  const puedeCal = puede("programa:ver_calendario_anual");
  const puedeVen = puede("programa:ver_vencimientos_sa");
  const sp = useSearchParams();
  const router = useRouter();

  /** Ajustar URL cuando solo corresponde una de las vistas. */
  useEffect(() => {
    const raw = sp.get("pestana");
    if (!puedeCal && puedeVen && raw !== "vencimientos") {
      const p = new URLSearchParams(sp.toString());
      p.set("pestana", "vencimientos");
      router.replace(`/programa/preventivos?${p.toString()}`, { scroll: false });
      return;
    }
    if (puedeCal && !puedeVen && raw === "vencimientos") {
      const p = new URLSearchParams(sp.toString());
      p.delete("pestana");
      const qs = p.toString();
      router.replace(qs ? `/programa/preventivos?${qs}` : "/programa/preventivos", { scroll: false });
    }
  }, [puedeCal, puedeVen, router, sp]);

  const pestanaPedida: Pestana = sp.get("pestana") === "vencimientos" ? "vencimientos" : "calendario";

  let pestanaActiva: Pestana;
  if (!puedeCal && puedeVen) pestanaActiva = "vencimientos";
  else if (puedeCal && !puedeVen) pestanaActiva = "calendario";
  else pestanaActiva = pestanaPedida;

  const setPestana = useCallback(
    (pest: Pestana) => {
      if (pest === "calendario" && !puedeCal) return;
      if (pest === "vencimientos" && !puedeVen) return;
      const p = new URLSearchParams(sp.toString());
      if (pest === "vencimientos") p.set("pestana", "vencimientos");
      else p.delete("pestana");
      if (pest === "calendario") {
        p.delete("tab");
        p.delete("filter");
      }
      const qs = p.toString();
      router.replace(qs ? `/programa/preventivos?${qs}` : "/programa/preventivos", { scroll: false });
    },
    [puedeCal, puedeVen, router, sp],
  );

  const tabClass = (on: boolean, disabled?: boolean) =>
    cn(
      "flex w-full items-center justify-start gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-colors sm:flex-1 md:min-h-[3rem] md:px-4",
      disabled
        ? "cursor-not-allowed opacity-45"
        : on
          ? "bg-brand text-brand-foreground shadow-sm ring-2 ring-brand/35"
          : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
    );

  if (!puedeCal && !puedeVen) {
    return <p className="text-sm text-muted-foreground">No tenés permiso para ver esta sección.</p>;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5" aria-label="Selector de vista">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Planes preventivos</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Una sola página: cambiá de pestaña para ir del calendario mensual al seguimiento de vencimientos (incluye semestral y anual).
        </p>
        <div
          role="tablist"
          aria-label="Vistas de planes preventivos"
          className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap"
        >
          <button
            type="button"
            role="tab"
            aria-selected={pestanaActiva === "calendario"}
            disabled={!puedeCal}
            title={!puedeCal ? "Tu rol no incluye esta vista" : undefined}
            className={tabClass(pestanaActiva === "calendario", !puedeCal)}
            onClick={() => setPestana("calendario")}
          >
            📆 Calendario anual — avisos preventivos
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pestanaActiva === "vencimientos"}
            disabled={!puedeVen}
            title={!puedeVen ? "Tu rol no incluye esta vista" : undefined}
            className={tabClass(pestanaActiva === "vencimientos", !puedeVen)}
            onClick={() => setPestana("vencimientos")}
          >
            🗓️ Vencimientos
          </button>
        </div>
      </section>

      {pestanaActiva === "calendario" && puedeCal ? <AnualClient dentroDelHub /> : null}
      {pestanaActiva === "vencimientos" && puedeVen ? <VencimientosClient dentroDelHub /> : null}
    </div>
  );
}
