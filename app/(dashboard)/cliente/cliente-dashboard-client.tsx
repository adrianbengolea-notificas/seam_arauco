"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { KNOWN_CENTROS } from "@/lib/config/app-config";
import { useProgramaSemanaFusion, useSemanasDisponiblesTodas } from "@/modules/scheduling/hooks";
import { getIsoWeekId } from "@/modules/scheduling/iso-week";
import type { DiaSemanaPrograma, EspecialidadPrograma, ProgramaSemana } from "@/modules/scheduling/types";
import { useAuth } from "@/modules/users/hooks";
import Link from "next/link";
import { useMemo } from "react";

const DIAS: DiaSemanaPrograma[] = [
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
  "domingo",
];
const DIA_CORTO: Record<DiaSemanaPrograma, string> = {
  lunes: "L",
  martes: "M",
  miercoles: "X",
  jueves: "J",
  viernes: "V",
  sabado: "S",
  domingo: "D",
};

const ESPECIALIDAD_LABEL: Record<EspecialidadPrograma, string> = {
  Aire: "AA",
  Electrico: "E",
  GG: "GG",
};

function dotColorPrograma(
  programa: ProgramaSemana | null,
  esp: EspecialidadPrograma,
  dia: DiaSemanaPrograma,
): "red" | "amber" | "zinc" {
  const slots = programa?.slots?.filter((s) => s.especialidad === esp && s.dia === dia) ?? [];
  for (const s of slots) {
    for (const a of s.avisos ?? []) {
      if (a.urgente) return "red";
      if (a.tipo === "correctivo") return "amber";
    }
  }
  return "zinc";
}

export function ClienteDashboardClient() {
  const { user, profile } = useAuth();

  const { semanas: semanasTodas } = useSemanasDisponiblesTodas(user?.uid);
  const semanaIsoKey = useMemo(() => {
    if (!semanasTodas.length) return "";
    const hoy = getIsoWeekId(new Date());
    if (semanasTodas.some((s) => s.iso === hoy)) return hoy;
    return semanasTodas[0]!.iso;
  }, [semanasTodas]);

  const docIdsFusion = useMemo(() => {
    if (!semanaIsoKey) return undefined;
    const row = semanasTodas.find((s) => s.iso === semanaIsoKey);
    if (!row) return undefined;
    return KNOWN_CENTROS.map((c) => row.programaDocIdPorCentro[c]).filter((id): id is string =>
      Boolean(id?.trim()),
    );
  }, [semanaIsoKey, semanasTodas]);

  const { programa } = useProgramaSemanaFusion(docIdsFusion, semanaIsoKey || undefined, user?.uid);

  const espRows: EspecialidadPrograma[] = ["Aire", "Electrico", "GG"];

  const nombre = profile?.display_name?.trim() || profile?.email || "Cliente";

  const accesos = [
    {
      href: "/programa",
      titulo: "Programa semanal",
      descripcion: "Vista publicada por planta y especialidad (solo lectura).",
      emoji: "📅",
    },
    {
      href: "/reportes/cumplimiento",
      titulo: "Reporte de cumplimiento",
      descripcion: "Planificado vs ejecutado (solo lectura).",
      emoji: "📊",
    },
    {
      href: "/materiales",
      titulo: "Materiales",
      descripcion: "Catálogo y reporting de consumos (sin cargar ni editar stock).",
      emoji: "📦",
    },
    {
      href: "/activos",
      titulo: "Activos",
      descripcion: "Fichas de equipos (sin editar maestro).",
      emoji: "🏭",
    },
  ] as const;

  return (
    <div className="space-y-8 pb-16">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Bienvenido, {nombre} — Arauco
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Vista de <span className="font-medium text-foreground">solo lectura</span> ·{" "}
          <span className="font-medium text-foreground">Todas las plantas</span>{" "}
          <span className="text-muted-foreground">(consolidado)</span>
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {accesos.map((a) => (
          <Link key={a.href} href={a.href} className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2">
            <Card className="h-full transition-shadow group-hover:shadow-md">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span aria-hidden>{a.emoji}</span>
                  {a.titulo}
                </CardTitle>
                <CardDescription>{a.descripcion}</CardDescription>
              </CardHeader>
              <CardContent>
                <span className="text-sm font-medium text-brand underline-offset-4 group-hover:underline">
                  Abrir sección
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-2">
          <div>
            <CardTitle>Programa semanal</CardTitle>
            <CardDescription>Resumen por especialidad · semana en curso (indicadores de urgencia / correctivo)</CardDescription>
          </div>
          <Link href="/programa" className="text-sm font-medium text-brand underline-offset-4 hover:underline">
            Ver programa completo
          </Link>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[28rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Esp. / Día</th>
                {DIAS.map((d) => (
                  <th key={d} className="px-1 py-2 text-center font-medium">
                    {DIA_CORTO[d]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {espRows.map((esp) => (
                <tr key={esp} className="border-b border-border/60">
                  <td className="py-2 pr-3 font-mono text-xs font-semibold">{ESPECIALIDAD_LABEL[esp]}</td>
                  {DIAS.map((dia) => {
                    const tone = dotColorPrograma(programa, esp, dia);
                    return (
                      <td key={`${esp}-${dia}`} className="px-1 py-2 text-center">
                        <span
                          className={cn(
                            "inline-block h-2.5 w-2.5 rounded-full",
                            tone === "red" && "bg-red-500",
                            tone === "amber" && "bg-amber-500",
                            tone === "zinc" && "bg-zinc-300 dark:bg-zinc-600",
                          )}
                          title={tone === "red" ? "Urgente" : tone === "amber" ? "Correctivo" : "Preventivo / otro"}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
