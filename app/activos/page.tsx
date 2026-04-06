"use client";

import { AssetExcelImportPanel } from "@/components/assets/AssetExcelImportPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAssetsLive } from "@/modules/assets/hooks";
import type { Asset, EspecialidadActivo } from "@/modules/assets/types";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { useAuthUser, useUserProfile } from "@/modules/users/hooks";
import { Plus, QrCode, Search, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

const selectClassName = cn(
  "h-10 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm",
  "text-foreground",
  "transition-[border-color,box-shadow] duration-150",
  "focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
);

function foldText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function assetHaystack(a: Asset): string {
  return foldText(
    [
      a.codigo_nuevo,
      a.codigo_legacy,
      a.denominacion,
      a.ubicacion_tecnica,
      a.centro,
      a.clase,
      a.grupo_planificacion,
      a.especialidad_predeterminada,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

const ESPECIALIDADES: (EspecialidadActivo | "")[] = ["", "AA", "ELECTRICO", "GG"];

export default function ActivosPage() {
  const { puede } = usePermisos();
  const { user, loading: authLoading } = useAuthUser();
  const { profile, loading: profileLoading } = useUserProfile(user?.uid);
  const { assets, loading, error } = useAssetsLive();
  const [q, setQ] = useState("");
  const [centro, setCentro] = useState("");
  const [ubicacionContains, setUbicacionContains] = useState("");
  const [operativo, setOperativo] = useState<"all" | "yes" | "no">("all");
  const [especialidad, setEspecialidad] = useState<"" | EspecialidadActivo>("");

  const centrosOptions = useMemo(() => {
    const set = new Set<string>();
    for (const a of assets) {
      const c = a.centro?.trim();
      if (c) set.add(c);
    }
    return [...set].sort((x, y) => foldText(x).localeCompare(foldText(y), "es"));
  }, [assets]);

  const filtered = useMemo(() => {
    const tokens = q
      .trim()
      .split(/\s+/)
      .map((t) => foldText(t))
      .filter(Boolean);

    return assets.filter((a) => {
      if (centro && a.centro !== centro) return false;
      if (ubicacionContains.trim()) {
        const needle = foldText(ubicacionContains.trim());
        if (!foldText(a.ubicacion_tecnica).includes(needle)) return false;
      }
      if (operativo === "yes" && !a.activo_operativo) return false;
      if (operativo === "no" && a.activo_operativo) return false;
      if (especialidad && a.especialidad_predeterminada !== especialidad) return false;
      if (!tokens.length) return true;
      const hay = assetHaystack(a);
      return tokens.every((t) => hay.includes(t));
    });
  }, [assets, q, centro, ubicacionContains, operativo, especialidad]);

  const hasActiveFilters =
    Boolean(q.trim()) ||
    Boolean(centro) ||
    Boolean(ubicacionContains.trim()) ||
    operativo !== "all" ||
    Boolean(especialidad);

  function clearFilters() {
    setQ("");
    setCentro("");
    setUbicacionContains("");
    setOperativo("all");
    setEspecialidad("");
  }

  const sessionLoading = authLoading || profileLoading;
  const canCreateAsset = puede("activos:crear_editar");

  return (
    <div className="space-y-8">
      <header>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="border-l-4 border-accent-warm pl-3 text-xs font-bold uppercase tracking-[0.2em] text-muted">
              Inventario
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">Activos</h1>
            <p className="mt-1 max-w-xl text-sm text-muted">
              Código, nombre del equipo, ubicación técnica y centro.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!sessionLoading && canCreateAsset ? (
              <Button asChild variant="secondary" className="gap-2 shadow-sm">
                <Link href="/activos/nuevo">
                  <Plus className="h-4 w-4 opacity-90" aria-hidden />
                  Nuevo activo
                </Link>
              </Button>
            ) : null}
            <Button asChild className="gap-2 shadow-sm">
              <Link href="/activos/escaner">
                <QrCode className="h-4 w-4 opacity-90" aria-hidden />
                Escanear QR
              </Link>
            </Button>
          </div>
        </div>
      </header>
      <AssetExcelImportPanel />
      <Card>
        <CardHeader>
          <CardTitle>Equipos registrados</CardTitle>
          <CardDescription>Listado en vivo desde Firestore · tocá una fila para ver ficha y QR</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {!loading && !error && assets.length ? (
            <div className="space-y-4">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                  aria-hidden
                />
                <Input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar en código, nombre, ubicación, centro, clase, grupo…"
                  className="pl-9"
                  aria-label="Búsqueda en inventario de activos"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="block space-y-1.5 text-xs font-medium text-muted">
                  Centro
                  <select
                    className={selectClassName}
                    value={centro}
                    onChange={(e) => setCentro(e.target.value)}
                    aria-label="Filtrar por centro"
                  >
                    <option value="">Todos los centros</option>
                    {centrosOptions.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1.5 text-xs font-medium text-muted">
                  Ubicación técnica
                  <Input
                    value={ubicacionContains}
                    onChange={(e) => setUbicacionContains(e.target.value)}
                    placeholder="Contiene texto…"
                    aria-label="Filtrar ubicación técnica"
                  />
                </label>
                <label className="block space-y-1.5 text-xs font-medium text-muted">
                  Estado operativo
                  <select
                    className={selectClassName}
                    value={operativo}
                    onChange={(e) => setOperativo(e.target.value as "all" | "yes" | "no")}
                    aria-label="Filtrar por estado operativo"
                  >
                    <option value="all">Todos</option>
                    <option value="yes">Solo operativos</option>
                    <option value="no">Solo no operativos</option>
                  </select>
                </label>
                <label className="block space-y-1.5 text-xs font-medium text-muted">
                  Especialidad
                  <select
                    className={selectClassName}
                    value={especialidad}
                    onChange={(e) => setEspecialidad(e.target.value as "" | EspecialidadActivo)}
                    aria-label="Filtrar por especialidad"
                  >
                    <option value="">Todas</option>
                    {ESPECIALIDADES.filter(Boolean).map((sp) => (
                      <option key={sp} value={sp}>
                        {sp}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/80 pb-3 text-sm">
                <p className="text-muted">
                  Mostrando{" "}
                  <span className="font-semibold text-foreground">{filtered.length}</span> de{" "}
                  <span className="font-semibold text-foreground">{assets.length}</span> equipos
                  {hasActiveFilters && filtered.length === 0 ? (
                    <span className="ml-1 text-amber-800 dark:text-amber-200">
                      · probá aflojar filtros o la búsqueda
                    </span>
                  ) : null}
                </p>
                {hasActiveFilters ? (
                  <Button type="button" variant="ghost" size="sm" className="h-8 gap-1" onClick={clearFilters}>
                    <X className="h-3.5 w-3.5" aria-hidden />
                    Limpiar filtros
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
          {loading ? <p className="text-sm font-medium text-muted">Cargando…</p> : null}
          {error ? (
            <p className="text-sm font-medium text-red-700 dark:text-red-300">{error.message}</p>
          ) : null}
          {!loading && !error && !assets.length ? (
            <p className="text-sm text-muted">Sin activos en la colección «assets».</p>
          ) : null}
          <ul className="divide-y divide-border/90">
            {filtered.map((a) => (
              <li key={a.id} className="text-sm transition-colors first:pt-0 last:pb-0">
                <Link
                  href={`/activos/${a.id}`}
                  className="-mx-2 block rounded-xl px-2 py-3 hover:bg-foreground/[0.04] dark:hover:bg-white/[0.05]"
                  title={`${a.denominacion} · ${a.codigo_nuevo}`}
                >
                  <div className="font-mono text-sm font-semibold text-foreground">{a.codigo_nuevo}</div>
                  <div className="mt-1 line-clamp-2 text-sm font-medium leading-snug text-foreground">
                    {a.denominacion}
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {a.ubicacion_tecnica} · {a.centro}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
