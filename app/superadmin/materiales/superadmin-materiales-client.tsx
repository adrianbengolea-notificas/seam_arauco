"use client";

import {
  confirmarMatchMaterial,
  crearMaterialEnCatalogo,
  rechazarMatchMaterial,
} from "@/app/actions/ai";
import { registrarEntradaStock } from "@/app/actions/materials";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  useMaterialOtByNormalizacion,
  useMaterialsCatalogLive,
  useStockMovimientos,
} from "@/modules/materials/hooks";
import { getClientIdToken, useAuthUser, useUserProfile } from "@/modules/users/hooks";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { isSuperAdminRole } from "@/modules/users/roles";
import { useState } from "react";

export function SuperadminMaterialesClient() {
  const { puede } = usePermisos();
  const searchParams = useSearchParams();
  const filter = searchParams.get("filter");

  const { user, loading: authLoading } = useAuthUser();
  const { profile, loading: profileLoading } = useUserProfile(user?.uid);
  const canReviewIa = puede("materiales:revisar_ia");

  const { rows: revisionRows, loading: revLoading } = useMaterialOtByNormalizacion(
    canReviewIa ? "revision_pendiente" : null,
    user?.uid,
    { limit: 100 },
  );
  const { rows: sinMatchRows, loading: smLoading } = useMaterialOtByNormalizacion(
    canReviewIa ? "sin_match" : null,
    user?.uid,
    { limit: 100 },
  );

  const { items: catalogItems, itemsBajoStock, loading: catLoading } = useMaterialsCatalogLive(600);
  const [stockFilterMaterialId, setStockFilterMaterialId] = useState<string>("");
  const { movimientos, loading: movLoading } = useStockMovimientos(
    stockFilterMaterialId || undefined,
    user?.uid,
    {
      filterCentro: profile?.centro && !isSuperAdminRole(profile.rol) ? profile.centro : undefined,
      includeLegacySinCentro: isSuperAdminRole(profile?.rol),
    },
  );

  const [entradaMaterialId, setEntradaMaterialId] = useState("");
  const [entradaCant, setEntradaCant] = useState("1");
  const [entradaOrigen, setEntradaOrigen] = useState<"ARAUCO" | "EXTERNO">("ARAUCO");
  const [entradaObs, setEntradaObs] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const [crearOpen, setCrearOpen] = useState<string | null>(null);
  const [crearCodigo, setCrearCodigo] = useState("");
  const [crearDesc, setCrearDesc] = useState("");
  const [crearUd, setCrearUd] = useState("unidad");

  const loading = authLoading || profileLoading;
  const allowed = puede("materiales:ver_reporting") || puede("materiales:ingresar_stock");

  const bajoStockDestacado = filter === "bajo_stock";
  const catalogRows =
    bajoStockDestacado && itemsBajoStock.length > 0 ? itemsBajoStock : catalogItems;

  async function token() {
    const t = await getClientIdToken();
    if (!t) throw new Error("Sin sesión");
    return t;
  }

  async function onConfirmar(otId: string, lineId: string, catalogoId: string) {
    setMsg(null);
    try {
      const res = await confirmarMatchMaterial(await token(), { workOrderId: otId, lineId, catalogoId });
      setMsg(res.ok ? "Match confirmado y stock descontado" : res.error.message);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    }
  }

  async function onRechazar(otId: string, lineId: string) {
    setMsg(null);
    try {
      const res = await rechazarMatchMaterial(await token(), { workOrderId: otId, lineId });
      setMsg(res.ok ? "Marcado sin match" : res.error.message);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    }
  }

  async function onCrearCatalogo(otId: string, lineId: string) {
    setMsg(null);
    try {
      const res = await crearMaterialEnCatalogo(await token(), {
        codigo_material: crearCodigo.trim(),
        descripcion: crearDesc.trim(),
        unidad_medida: crearUd.trim(),
      });
      if (!res.ok) {
        setMsg(res.error.message);
        return;
      }
      const confirm = await confirmarMatchMaterial(await token(), {
        workOrderId: otId,
        lineId,
        catalogoId: res.data,
      });
      setMsg(confirm.ok ? "Material creado y asignado a la OT" : confirm.error.message);
      setCrearOpen(null);
      setCrearCodigo("");
      setCrearDesc("");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    }
  }

  async function onEntrada(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const cant = Number(entradaCant.replace(",", "."));
    if (!entradaMaterialId.trim() || !Number.isFinite(cant) || cant < 1) {
      setMsg("Elegí material y cantidad válida");
      return;
    }
    try {
      const res = await registrarEntradaStock(await token(), {
        materialId: entradaMaterialId.trim(),
        cantidad: cant,
        origen: entradaOrigen,
        observaciones: entradaObs.trim() || undefined,
      });
      setMsg(res.ok ? "Entrada registrada" : res.error.message);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    }
  }

  if (loading) {
    return <p className="py-8 text-sm text-zinc-600 dark:text-zinc-400">Cargando…</p>;
  }

  if (!user) {
    return null;
  }

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg py-8">
        <Card>
          <CardHeader>
            <CardTitle>Acceso restringido</CardTitle>
            <CardDescription>
              Solo supervisores y administradores pueden gestionar inventario y revisar mapeos IA.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/dashboard">Volver al panel</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 py-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-amber-950 dark:text-amber-100">
          Materiales e inventario
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {canReviewIa
            ? "Revisión de mapeo IA, catálogo y movimientos de stock."
            : "Entradas de stock y movimientos (supervisor)."}
        </p>
      </div>

      {bajoStockDestacado ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          Vista filtrada: catálogo limitado a ítems con stock disponible ≤ stock mínimo (
          <span className="font-mono">{itemsBajoStock.length}</span> ítems).
        </p>
      ) : null}

      {msg ? (
        <p className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950">
          {msg}
        </p>
      ) : null}

      <Card className={bajoStockDestacado ? "ring-2 ring-amber-400/50" : ""}>
        <CardHeader>
          <CardTitle>Ingresar stock</CardTitle>
          <CardDescription>Entradas de material (supervisor / admin). Queda registro en stock_movimientos.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void onEntrada(e)} className="space-y-3">
            <label className="block text-sm font-medium">
              Catálogo
              <select
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                value={entradaMaterialId}
                onChange={(e) => setEntradaMaterialId(e.target.value)}
                disabled={catLoading}
              >
                <option value="">— Elegir —</option>
                {catalogRows.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.codigo_material} — {c.descripcion} (stock: {c.stock_disponible ?? "—"})
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium">
                Cantidad
                <Input
                  className="mt-1"
                  value={entradaCant}
                  onChange={(e) => setEntradaCant(e.target.value)}
                  inputMode="decimal"
                />
              </label>
              <fieldset className="text-sm font-medium">
                Origen
                <div className="mt-2 flex gap-4">
                  <label className="flex items-center gap-2 font-normal">
                    <input
                      type="radio"
                      name="ent-origen"
                      checked={entradaOrigen === "ARAUCO"}
                      onChange={() => setEntradaOrigen("ARAUCO")}
                    />
                    Arauco
                  </label>
                  <label className="flex items-center gap-2 font-normal">
                    <input
                      type="radio"
                      name="ent-origen"
                      checked={entradaOrigen === "EXTERNO"}
                      onChange={() => setEntradaOrigen("EXTERNO")}
                    />
                    Externo
                  </label>
                </div>
              </fieldset>
            </div>
            <label className="block text-sm font-medium">
              Observaciones
              <Input
                className="mt-1"
                value={entradaObs}
                onChange={(e) => setEntradaObs(e.target.value)}
                placeholder="Remito, OC…"
              />
            </label>
            <Button type="submit">Registrar entrada</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Últimos movimientos de stock</CardTitle>
          <CardDescription>
            Filtrar por material opcional.{" "}
            <select
              className="ml-2 rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
              value={stockFilterMaterialId}
              onChange={(e) => setStockFilterMaterialId(e.target.value)}
            >
              <option value="">Todos</option>
              {catalogItems.slice(0, 200).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.codigo_material}
                </option>
              ))}
            </select>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {movLoading ? (
            <p className="text-sm text-zinc-500">Cargando…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                    <th className="py-2 pr-2">Fecha</th>
                    <th className="py-2 pr-2">Material</th>
                    <th className="py-2 pr-2">Tipo</th>
                    <th className="py-2 pr-2">Cantidad</th>
                    <th className="py-2 pr-2">Origen</th>
                    <th className="py-2 pr-2">Stock result.</th>
                  </tr>
                </thead>
                <tbody>
                  {movimientos.map((m) => (
                    <tr key={m.id} className="border-b border-zinc-100 dark:border-zinc-900">
                      <td className="py-2 pr-2 whitespace-nowrap">
                        {m.fecha?.toDate?.().toLocaleString?.("es-AR") ?? "—"}
                      </td>
                      <td className="py-2 pr-2">
                        <span className="font-mono text-xs">{m.codigoMaterial}</span>
                        <br />
                        <span className="text-xs text-zinc-500">{m.descripcion}</span>
                      </td>
                      <td className="py-2 pr-2">
                        <span
                          className={
                            m.tipo === "entrada"
                              ? "rounded bg-emerald-100 px-1.5 py-0 text-xs dark:bg-emerald-950"
                              : "rounded bg-orange-100 px-1.5 py-0 text-xs dark:bg-orange-950"
                          }
                        >
                          {m.tipo}
                        </span>
                      </td>
                      <td className="py-2 pr-2">
                        {m.cantidad} {m.unidad}
                      </td>
                      <td className="py-2 pr-2">{m.origen}</td>
                      <td className="py-2 pr-2 font-mono text-xs">{m.stockDespues}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!movimientos.length ? <p className="mt-2 text-sm text-zinc-500">Sin movimientos aún.</p> : null}
            </div>
          )}
        </CardContent>
      </Card>

      {canReviewIa ? (
        <Card>
          <CardHeader>
            <CardTitle>Pendientes de revisión (IA)</CardTitle>
            <CardDescription>
              Confianza intermedia — confirmá el match o asigná otro código del catálogo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {revLoading ? (
              <p className="text-sm text-zinc-500">Cargando…</p>
            ) : (
              <div className="space-y-3">
                {revisionRows.map((r) => (
                  <div
                    key={`${r.otId}-${r.lineId}`}
                    className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
                  >
                    <p className="font-mono text-xs text-zinc-500">
                      OT <Link href={`/tareas/${r.otId}`}>{r.otId}</Link> · línea {r.lineId}
                    </p>
                    <p className="mt-1">
                      <span className="font-medium">Texto:</span> {r.descripcion}
                    </p>
                    <p className="text-xs text-zinc-600">
                      Sugerido: {r.descripcion_match ?? "—"} ({r.codigo_material ?? "—"}) · IA{" "}
                      {r.confianza_ia != null ? (r.confianza_ia * 100).toFixed(0) : "—"}%
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {r.catalogo_id ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void onConfirmar(r.otId, r.lineId, r.catalogo_id!)}
                        >
                          Confirmar match
                        </Button>
                      ) : null}
                      <label className="flex items-center gap-1 text-xs">
                        Otro:
                        <select
                          className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v) void onConfirmar(r.otId, r.lineId, v);
                          }}
                          defaultValue=""
                        >
                          <option value="" disabled>
                            Elegir del catálogo
                          </option>
                          {catalogItems.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.codigo_material}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Button type="button" size="sm" variant="outline" onClick={() => void onRechazar(r.otId, r.lineId)}>
                        No está en catálogo
                      </Button>
                    </div>
                  </div>
                ))}
                {!revisionRows.length ? <p className="text-zinc-500">Nada pendiente.</p> : null}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {canReviewIa ? (
        <Card>
          <CardHeader>
            <CardTitle>Sin match en catálogo</CardTitle>
            <CardDescription>Creá el ítem o asigná uno existente a la línea de la OT.</CardDescription>
          </CardHeader>
          <CardContent>
            {smLoading ? (
              <p className="text-sm text-zinc-500">Cargando…</p>
            ) : (
              <div className="space-y-3">
                {sinMatchRows.map((r) => (
                  <div
                    key={`${r.otId}-${r.lineId}`}
                    className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
                  >
                    <p className="font-mono text-xs">
                      OT{" "}
                      <Link href={`/tareas/${r.otId}`} className="text-blue-600 underline">
                        {r.otId}
                      </Link>
                    </p>
                    <p className="mt-1">{r.nombre_normalizado || r.descripcion}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => setCrearOpen(`${r.otId}|${r.lineId}`)}
                      >
                        Crear en catálogo
                      </Button>
                      <select
                        className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v) void onConfirmar(r.otId, r.lineId, v);
                        }}
                        defaultValue=""
                      >
                        <option value="" disabled>
                          Asignar existente
                        </option>
                        {catalogItems.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.codigo_material}
                          </option>
                        ))}
                      </select>
                    </div>
                    {crearOpen === `${r.otId}|${r.lineId}` ? (
                      <div className="mt-3 space-y-2 rounded-md border border-dashed border-zinc-300 p-2 dark:border-zinc-700">
                        <Input
                          placeholder="Código material"
                          value={crearCodigo}
                          onChange={(e) => setCrearCodigo(e.target.value)}
                        />
                        <Input placeholder="Descripción" value={crearDesc} onChange={(e) => setCrearDesc(e.target.value)} />
                        <Input placeholder="Unidad" value={crearUd} onChange={(e) => setCrearUd(e.target.value)} />
                        <Button type="button" size="sm" onClick={() => void onCrearCatalogo(r.otId, r.lineId)}>
                          Guardar y asignar
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
                {!sinMatchRows.length ? <p className="text-zinc-500">Sin registros.</p> : null}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <p className="text-center text-xs text-zinc-500">
        {canReviewIa ? (
          <Link href="/superadmin" className="underline">
            Volver a superadmin
          </Link>
        ) : (
          <Link href="/dashboard" className="underline">
            Volver al panel
          </Link>
        )}
      </p>
    </div>
  );
}
