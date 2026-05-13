"use client";

import { firmarPlanilla, guardarBorradorPlanilla } from "@/app/actions/planillas";
import { Button } from "@/components/ui/button";
import { ItemChecklistGG } from "@/components/planilla/ItemChecklist";
import { ItemEstadoAA } from "@/components/planilla/ItemEstado";
import { ItemGrillaElec } from "@/components/planilla/ItemGrilla";
import { useOfflineSync } from "@/hooks/use-offline-sync";
import { useOnlineStatus } from "@/hooks/use-online";
import { enqueueOutbox } from "@/lib/offline/ot-db";
import type { Equipo } from "@/lib/firestore/types";
import type {
  ItemRespuesta,
  PlanillaRespuesta,
  PlanillaTemplate,
  SeccionTemplate,
} from "@/lib/firestore/types";
import { planillaItemKey } from "@/lib/planillas/item-key";
import {
  planillaItemsOkSinFirmas,
  planillaProgreso,
  validatePlanillaFirmable,
} from "@/lib/planillas/form-utils";
import type { MaterialCatalogItem } from "@/modules/materials/types";
import { useMaterialSearch, useMaterialsCatalogLive } from "@/modules/materials/hooks";
import { SignaturePad } from "@/modules/signatures/components/SignaturePad";
import { useAuth } from "@/modules/users/hooks";
import { getClientIdToken } from "@/modules/users/hooks";
import { hasAdminCapabilities } from "@/modules/users/roles";
import type { WorkOrder } from "@/modules/work-orders/types";
import { formatFirestoreDate } from "@/lib/pdf/format-firestore-date";
import { cn } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Props = {
  template: PlanillaTemplate;
  ot: WorkOrder;
  equipo?: Equipo | null;
  respuestaInicial: PlanillaRespuesta;
  readOnly?: boolean;
  onCerrar: () => void;
};

export function PlanillaForm({ template, ot, equipo, respuestaInicial, readOnly: readOnlyProp, onCerrar }: Props) {
  const { user, profile } = useAuth();
  const online = useOnlineStatus();
  const isAdmin = hasAdminCapabilities(profile?.rol);

  const [state, setState] = useState<PlanillaRespuesta>(() => ({
    ...respuestaInicial,
    respuestas: { ...respuestaInicial.respuestas },
    datosEquipo: { ...(respuestaInicial.datosEquipo ?? {}) },
    filasPersonal: [...(respuestaInicial.filasPersonal ?? [])],
  }));

  const readOnly = readOnlyProp || state.status === "firmada";

  const [guardado, setGuardado] = useState<"idle" | "saving" | "saved" | "queued">("idle");
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const progreso = useMemo(() => planillaProgreso(template, state), [template, state]);

  const flushOutbox = useCallback(
    async ({ type, payload }: { type: string; payload: unknown }) => {
      const t = await getClientIdToken();
      if (!t) throw new Error("Sin sesión");
      if (type === "planilla_borrador") {
        const p = payload as { otId: string; respuestaId: string; datos: Partial<PlanillaRespuesta> };
        const res = await guardarBorradorPlanilla(t, p);
        if (!res.ok) throw new Error(res.error.message);
        return;
      }
      if (type === "planilla_firmar") {
        const p = payload as {
          otId: string;
          respuestaId: string;
          firmas: {
            firmaUsuario: string;
            firmaUsuarioNombre: string;
            firmaUsuarioLegajo: string;
            firmaResponsable: string;
            firmaResponsableNombre: string;
          };
        };
        const res = await firmarPlanilla(t, { otId: p.otId, respuestaId: p.respuestaId, firmas: p.firmas });
        if (!res.ok) throw new Error(res.error.message);
      }
    },
    [],
  );

  useOfflineSync(!readOnly, flushOutbox);

  const queueGuardar = useCallback(
    (datos: Partial<PlanillaRespuesta>) => {
      if (readOnly) return;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        void (async () => {
          setGuardado("saving");
          const patch = { ...datos };
          try {
            if (online) {
              const t = await getClientIdToken();
              if (!t) throw new Error("Sin sesión");
              const res = await guardarBorradorPlanilla(t, {
                otId: ot.id,
                respuestaId: state.id,
                datos: patch,
              });
              if (!res.ok) throw new Error(res.error.message);
              setGuardado("saved");
              setTimeout(() => setGuardado("idle"), 1600);
            } else {
              await enqueueOutbox("planilla_borrador", {
                otId: ot.id,
                respuestaId: state.id,
                datos: patch,
              });
              setGuardado("queued");
            }
          } catch {
            setGuardado("idle");
          }
        })();
      }, 3000);
    },
    [online, ot.id, readOnly, state.id],
  );

  const patchState = useCallback(
    (partial: Partial<PlanillaRespuesta>) => {
      setState((s) => {
        const next = { ...s, ...partial };
        queueGuardar(partial);
        return next;
      });
    },
    [queueGuardar],
  );

  const setItemRespuesta = useCallback(
    (seccionId: string, itemId: string, ir: ItemRespuesta) => {
      const key = planillaItemKey(seccionId, itemId);
      setState((s) => {
        const respuestas = { ...s.respuestas, [key]: ir };
        queueGuardar({ respuestas });
        return { ...s, respuestas };
      });
    },
    [queueGuardar],
  );

  const fechaLabel = formatFirestoreDate(ot.created_at);

  const sigWrapRef = useRef<HTMLDivElement | null>(null);
  const [sigW, setSigW] = useState(320);
  useEffect(() => {
    const el = sigWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = Math.min(480, Math.max(280, Math.floor(el.getBoundingClientRect().width)));
      setSigW(w);
    });
    ro.observe(el);
    setSigW(Math.min(480, Math.max(280, Math.floor(el.getBoundingClientRect().width))));
    return () => ro.disconnect();
  }, []);

  const puedeFirmar =
    !readOnly &&
    planillaItemsOkSinFirmas(template, state, { isAdmin }) &&
    Boolean(state.firmaUsuario?.trim()) &&
    Boolean(state.firmaResponsable?.trim()) &&
    Boolean(state.firmaUsuarioNombre?.trim()) &&
    Boolean(state.firmaResponsableNombre?.trim());

  async function onCompletarYFirmar() {
    const v = validatePlanillaFirmable(template, state, { isAdmin });
    if (!v.ok) return;
    if (!state.firmaUsuario || !state.firmaResponsable) return;
    try {
      if (online) {
        const t = await getClientIdToken();
        if (!t) return;
        const res = await firmarPlanilla(t, {
          otId: ot.id,
          respuestaId: state.id,
          firmas: {
            firmaUsuario: state.firmaUsuario,
            firmaUsuarioNombre: state.firmaUsuarioNombre ?? "",
            firmaUsuarioLegajo: state.firmaUsuarioLegajo ?? "",
            firmaResponsable: state.firmaResponsable,
            firmaResponsableNombre: state.firmaResponsableNombre ?? "",
          },
        });
        if (!res.ok) throw new Error(res.error.message);
      } else {
        await enqueueOutbox("planilla_firmar", {
          otId: ot.id,
          respuestaId: state.id,
          firmas: {
            firmaUsuario: state.firmaUsuario,
            firmaUsuarioNombre: state.firmaUsuarioNombre ?? "",
            firmaUsuarioLegajo: state.firmaUsuarioLegajo ?? "",
            firmaResponsable: state.firmaResponsable,
            firmaResponsableNombre: state.firmaResponsableNombre ?? "",
          },
        });
      }
      onCerrar();
    } catch {
      /* mensaje en UI: podría ampliarse */
    }
  }

  const { items: catalogItems } = useMaterialsCatalogLive(500);
  const [matDraft, setMatDraft] = useState("");
  const materialSuggestions = useMaterialSearch(matDraft, catalogItems);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-100 dark:bg-zinc-950">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
        <div className="mx-auto flex max-w-lg items-center gap-2">
          <Button type="button" variant="ghost" size="sm" className="min-h-11 min-w-11 shrink-0" onClick={onCerrar}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{template.nombre}</p>
            <p className="text-[11px] text-zinc-500">
              {progreso.hechos} / {progreso.total} ítems · {progreso.pct}%
              {guardado === "saving" ? " · Guardando…" : null}
              {guardado === "saved" ? " · Guardado" : null}
              {guardado === "queued" ? " · En cola (sin red)" : null}
            </p>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div
                className="h-full bg-emerald-600 transition-all duration-500"
                style={{ width: `${progreso.pct}%` }}
              />
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-4 pb-28">
        <div className="mx-auto flex max-w-lg flex-col gap-3">
          <div className="flex flex-wrap gap-2 text-[11px] text-zinc-600 dark:text-zinc-400">
            <span className="rounded-full bg-zinc-200 px-2 py-1 font-mono dark:bg-zinc-800">
              Aviso {ot.aviso_numero || ot.aviso_id || "—"}
            </span>
            <span className="rounded-full bg-zinc-200 px-2 py-1 dark:bg-zinc-800">{ot.ubicacion_tecnica}</span>
            <span className="rounded-full bg-zinc-200 px-2 py-1 dark:bg-zinc-800">{fechaLabel}</span>
            <span className="rounded-full bg-zinc-200 px-2 py-1 dark:bg-zinc-800">
              {profile?.display_name || user?.displayName || user?.email || "Usuario"}
            </span>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-xs font-medium text-zinc-500">Equipo</p>
            <p className="font-mono font-semibold">
              {equipo?.codigo ?? ot.equipo_codigo ?? ot.codigo_activo_snapshot}
            </p>
            <p className="text-zinc-700 dark:text-zinc-300">{equipo?.descripcion ?? ot.texto_trabajo}</p>
          </div>

          {template.secciones.map((sec) => (
            <SeccionRenderer
              key={sec.id}
              sec={sec}
              template={template}
              state={state}
              readOnly={readOnly}
              isAdmin={isAdmin}
              matDraft={matDraft}
              setMatDraft={setMatDraft}
              materialSuggestions={materialSuggestions}
              onPickCatalog={(it) => {
                const line = `${it.codigo_material ?? ""} ${it.descripcion}`.trim();
                setMatDraft((d) => (d ? `${d}\n${line}` : line));
              }}
              patchState={patchState}
              setItemRespuesta={setItemRespuesta}
            />
          ))}

          <div ref={sigWrapRef} className="space-y-4 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-sm font-semibold">Firmas</p>
            <div className="space-y-2">
              <p className="text-xs font-medium text-zinc-600">Firma del usuario (conformidad)</p>
              {readOnly && state.firmaUsuario ? (
                <img
                  src={state.firmaUsuario}
                  alt="Firma usuario"
                  className="max-w-full rounded-md border border-zinc-200 bg-white"
                />
              ) : (
                <SignaturePad
                  width={sigW}
                  height={144}
                  onChange={(url) => patchState({ firmaUsuario: url ?? undefined })}
                />
              )}
              <label className="text-xs text-zinc-600">
                Aclaración / Legajo
                <input
                  className="mt-1 min-h-11 w-full rounded-lg border border-zinc-200 px-2 dark:border-zinc-700 dark:bg-zinc-950"
                  disabled={readOnly}
                  value={state.firmaUsuarioLegajo ?? ""}
                  onChange={(e) => patchState({ firmaUsuarioLegajo: e.target.value })}
                />
              </label>
              <label className="text-xs text-zinc-600">
                Nombre y apellido
                <input
                  className="mt-1 min-h-11 w-full rounded-lg border border-zinc-200 px-2 dark:border-zinc-700 dark:bg-zinc-950"
                  disabled={readOnly}
                  value={state.firmaUsuarioNombre ?? ""}
                  onChange={(e) => patchState({ firmaUsuarioNombre: e.target.value })}
                />
              </label>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-zinc-600">Firma responsable mantenimiento / supervisor</p>
              {readOnly && state.firmaResponsable ? (
                <img
                  src={state.firmaResponsable}
                  alt="Firma responsable"
                  className="max-w-full rounded-md border border-zinc-200 bg-white"
                />
              ) : (
                <SignaturePad
                  width={sigW}
                  height={144}
                  onChange={(url) => patchState({ firmaResponsable: url ?? undefined })}
                />
              )}
              <label className="text-xs text-zinc-600">
                Nombre y apellido
                <input
                  className="mt-1 min-h-11 w-full rounded-lg border border-zinc-200 px-2 dark:border-zinc-700 dark:bg-zinc-950"
                  disabled={readOnly}
                  value={state.firmaResponsableNombre ?? ""}
                  onChange={(e) => patchState({ firmaResponsableNombre: e.target.value })}
                />
              </label>
            </div>

            {!readOnly ? (
              <Button
                type="button"
                className="min-h-12 w-full"
                disabled={!puedeFirmar}
                onClick={() => void onCompletarYFirmar()}
              >
                Completar y firmar
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function SeccionRenderer({
  sec,
  template,
  state,
  readOnly,
  isAdmin,
  matDraft,
  setMatDraft,
  materialSuggestions,
  onPickCatalog,
  patchState,
  setItemRespuesta,
}: {
  sec: SeccionTemplate;
  template: PlanillaTemplate;
  state: PlanillaRespuesta;
  readOnly: boolean;
  isAdmin: boolean;
  matDraft: string;
  setMatDraft: (s: string | ((p: string) => string)) => void;
  materialSuggestions: MaterialCatalogItem[];
  onPickCatalog: (it: MaterialCatalogItem) => void;
  patchState: (p: Partial<PlanillaRespuesta>) => void;
  setItemRespuesta: (seccionId: string, itemId: string, ir: ItemRespuesta) => void;
}) {
  if (sec.soloAdmin && !isAdmin) return null;

  if (sec.tipo === "datos_equipo" && (template.id === "AA" || template.id === "GG")) {
    const d = state.datosEquipo ?? {};
    return (
      <section className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
        <h3 className="mb-3 text-sm font-semibold">{sec.titulo}</h3>
        <div className="space-y-3 text-sm">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Código">
              <input
                className="min-h-11 w-full rounded-lg border border-zinc-200 px-2 dark:border-zinc-700 dark:bg-zinc-950"
                disabled={readOnly}
                value={d.codigoEquipo ?? ""}
                onChange={(e) => patchState({ datosEquipo: { ...d, codigoEquipo: e.target.value } })}
              />
            </Field>
            <Field label="Marca">
              <input
                className="min-h-11 w-full rounded-lg border border-zinc-200 px-2 dark:border-zinc-700 dark:bg-zinc-950"
                disabled={readOnly}
                value={d.marca ?? ""}
                onChange={(e) => patchState({ datosEquipo: { ...d, marca: e.target.value } })}
              />
            </Field>
            <Field label="Modelo">
              <input
                className="min-h-11 w-full rounded-lg border border-zinc-200 px-2 dark:border-zinc-700 dark:bg-zinc-950"
                disabled={readOnly}
                value={d.modelo ?? ""}
                onChange={(e) => patchState({ datosEquipo: { ...d, modelo: e.target.value } })}
              />
            </Field>
            <Field label="Tipo">
              <input
                className="min-h-11 w-full rounded-lg border border-zinc-200 px-2 dark:border-zinc-700 dark:bg-zinc-950"
                disabled={readOnly}
                value={d.tipo ?? ""}
                onChange={(e) => patchState({ datosEquipo: { ...d, tipo: e.target.value } })}
              />
            </Field>
          </div>
          {template.id === "AA" ? (
            <>
              <div>
                <p className="mb-2 text-xs font-medium text-zinc-500">Rendimiento</p>
                <div className="flex flex-wrap gap-2">
                  {(["A", "B", "C", "D"] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      disabled={readOnly}
                      onClick={() => patchState({ datosEquipo: { ...d, rendimiento: r } })}
                      className={cn(
                        "min-h-11 min-w-12 rounded-lg border-2 text-sm font-bold",
                        d.rendimiento === r
                          ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-950"
                          : "border-zinc-200 dark:border-zinc-700",
                      )}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <Field label="Tipo gas">
                <input
                  className="min-h-11 w-full rounded-lg border border-zinc-200 px-2 dark:border-zinc-700 dark:bg-zinc-950"
                  disabled={readOnly}
                  value={d.tipoGas ?? ""}
                  onChange={(e) => patchState({ datosEquipo: { ...d, tipoGas: e.target.value } })}
                />
              </Field>
              <Field label="Frigorías">
                <input
                  inputMode="decimal"
                  className="min-h-11 w-full rounded-lg border border-zinc-200 px-2 dark:border-zinc-700 dark:bg-zinc-950"
                  disabled={readOnly}
                  value={d.frigorias ?? ""}
                  onChange={(e) => patchState({ datosEquipo: { ...d, frigorias: e.target.value } })}
                />
              </Field>
              <Field label="Potencia">
                <input
                  className="min-h-11 w-full rounded-lg border border-zinc-200 px-2 dark:border-zinc-700 dark:bg-zinc-950"
                  disabled={readOnly}
                  value={d.potencia ?? ""}
                  onChange={(e) => patchState({ datosEquipo: { ...d, potencia: e.target.value } })}
                />
              </Field>
              <div>
                <p className="mb-2 text-xs font-medium text-zinc-500">Tipo placa</p>
                <div className="flex flex-col gap-2">
                  {(["Original", "Universal", "C/Vistato"] as const).map((tp) => (
                    <button
                      key={tp}
                      type="button"
                      disabled={readOnly}
                      onClick={() => patchState({ datosEquipo: { ...d, tipoPlaca: tp } })}
                      className={cn(
                        "min-h-11 rounded-lg border px-2 text-left text-sm",
                        d.tipoPlaca === tp
                          ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-950"
                          : "border-zinc-200 dark:border-zinc-700",
                      )}
                    >
                      {tp}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={readOnly}
                    checked={Boolean(d.frioCalor)}
                    onChange={(e) => patchState({ datosEquipo: { ...d, frioCalor: e.target.checked } })}
                    className="h-5 w-5"
                  />
                  Frío / Calor
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={readOnly}
                    checked={Boolean(d.frioSolo)}
                    onChange={(e) => patchState({ datosEquipo: { ...d, frioSolo: e.target.checked } })}
                    className="h-5 w-5"
                  />
                  Solo frío
                </label>
              </div>
              <Field label="Serie exterior">
                <input
                  className="min-h-11 w-full rounded-lg border border-zinc-200 px-2 dark:border-zinc-700 dark:bg-zinc-950"
                  disabled={readOnly}
                  value={d.serie_ext ?? ""}
                  onChange={(e) => patchState({ datosEquipo: { ...d, serie_ext: e.target.value } })}
                />
              </Field>
              <Field label="Serie interior">
                <input
                  className="min-h-11 w-full rounded-lg border border-zinc-200 px-2 dark:border-zinc-700 dark:bg-zinc-950"
                  disabled={readOnly}
                  value={d.serie_int ?? ""}
                  onChange={(e) => patchState({ datosEquipo: { ...d, serie_int: e.target.value } })}
                />
              </Field>
            </>
          ) : null}
          {template.id === "GG" ? (
            <div>
              <p className="mb-2 text-xs font-medium text-zinc-500">Rendimiento (equipo)</p>
              <div className="flex flex-wrap gap-2">
                {(["A", "B", "C", "D"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    disabled={readOnly}
                    onClick={() => patchState({ datosEquipo: { ...d, rendimiento: r } })}
                    className={cn(
                      "min-h-11 min-w-12 rounded-lg border-2 text-sm font-bold",
                      d.rendimiento === r
                        ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-950"
                        : "border-zinc-200 dark:border-zinc-700",
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  if (sec.tipo === "checklist") {
    const isGG = template.id === "GG";
    return (
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{sec.titulo}</h3>
        <div className="flex flex-col gap-3">
          {sec.items?.map((it) => {
            const key = planillaItemKey(sec.id, it.id);
            const val = state.respuestas[key];
            return isGG ? (
              <ItemChecklistGG
                key={it.id}
                item={it}
                value={val}
                readOnly={readOnly}
                onChange={(next) => setItemRespuesta(sec.id, it.id, next)}
              />
            ) : (
              <ItemEstadoAA
                key={it.id}
                item={it}
                value={val}
                readOnly={readOnly}
                onChange={(next) => setItemRespuesta(sec.id, it.id, next)}
              />
            );
          })}
        </div>
      </section>
    );
  }

  if (sec.tipo === "grilla") {
    return (
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{sec.titulo}</h3>
        {sec.grillaColumnas?.length ? (
          <p className="text-[11px] text-zinc-500">{sec.grillaColumnas.join(" · ")}</p>
        ) : null}
        <div className="flex flex-col gap-3">
          {sec.items?.map((it) => (
            <ItemGrillaElec
              key={it.id}
              item={it}
              value={state.respuestas[planillaItemKey(sec.id, it.id)]}
              readOnly={readOnly}
              onChange={(next) => setItemRespuesta(sec.id, it.id, next)}
            />
          ))}
        </div>
      </section>
    );
  }

  if (sec.tipo === "libre") {
    const value =
      sec.id === "corr_actividad"
        ? state.actividadRealizada ?? ""
        : sec.id === "corr_mats"
          ? state.materialesTexto ?? ""
          : sec.id === "corr_obs"
            ? state.observacionesUsuario ?? ""
            : sec.id === "corr_ssgg"
              ? state.controlCalidadSSGG ?? ""
              : sec.id === "aa_obs"
                ? state.observacionesFinales ?? ""
              : sec.id === "elec_rec"
                ? state.recomendaciones ?? ""
                : sec.id === "elec_pedido"
                  ? state.pedidoMateriales ?? ""
                  : state.textoLibrePorSeccion?.[sec.id] ?? "";

    const setVal = (t: string) => {
      if (sec.id === "corr_actividad") patchState({ actividadRealizada: t });
      else if (sec.id === "corr_mats") patchState({ materialesTexto: t });
      else if (sec.id === "corr_obs") patchState({ observacionesUsuario: t });
      else if (sec.id === "corr_ssgg") patchState({ controlCalidadSSGG: t });
      else if (sec.id === "elec_rec") patchState({ recomendaciones: t });
      else if (sec.id === "elec_pedido") patchState({ pedidoMateriales: t });
      else patchState({ textoLibrePorSeccion: { ...(state.textoLibrePorSeccion ?? {}), [sec.id]: t } });
    };

    const showCat = sec.id === "corr_mats";

    return (
      <section className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
        <h3 className="mb-2 text-sm font-semibold">{sec.titulo}</h3>
        {sec.etiquetaLibre ? <p className="mb-2 text-xs text-zinc-500">{sec.etiquetaLibre}</p> : null}
        {showCat && !readOnly ? (
          <div className="mb-2 space-y-1">
            <input
              className="min-h-11 w-full rounded-lg border border-zinc-200 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              placeholder="Buscar en catálogo…"
              value={matDraft}
              onChange={(e) => setMatDraft(e.target.value)}
            />
            {materialSuggestions.slice(0, 6).map((s) => (
              <button
                key={s.id}
                type="button"
                className="block w-full min-h-10 truncate rounded border border-zinc-100 px-2 text-left text-xs dark:border-zinc-800"
                onClick={() => onPickCatalog(s)}
              >
                {s.descripcion}
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          className="min-h-28 w-full rounded-lg border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          disabled={readOnly}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => {
            const t = e.target.value;
            setVal(t);
            if (showCat) setMatDraft(t);
          }}
        />
      </section>
    );
  }

  if (sec.tipo === "datos_persona") {
    const max = sec.maxFilasPersona ?? 5;
    const rows = state.filasPersonal ?? [];
    return (
      <section className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
        <h3 className="mb-3 text-sm font-semibold">{sec.titulo}</h3>
        <div className="flex flex-col gap-4">
          {Array.from({ length: max }).map((_, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-zinc-100 p-2 dark:border-zinc-800">
              <p className="text-xs font-medium text-zinc-500">Persona {i + 1}</p>
              <input
                placeholder="Nombre y apellido"
                className="min-h-11 w-full rounded border px-2 text-sm dark:bg-zinc-950"
                disabled={readOnly}
                value={rows[i]?.nombreApellido ?? ""}
                onChange={(e) => {
                  const next = [...(state.filasPersonal ?? [])];
                  next[i] = { ...(next[i] ?? {}), nombreApellido: e.target.value };
                  patchState({ filasPersonal: next });
                }}
              />
              <input
                placeholder="Cargo / categoría"
                className="min-h-11 w-full rounded border px-2 text-sm dark:bg-zinc-950"
                disabled={readOnly}
                value={rows[i]?.cargoCategoria ?? ""}
                onChange={(e) => {
                  const next = [...(state.filasPersonal ?? [])];
                  next[i] = { ...(next[i] ?? {}), cargoCategoria: e.target.value };
                  patchState({ filasPersonal: next });
                }}
              />
              <textarea
                placeholder="Observaciones"
                className="min-h-16 w-full rounded border px-2 py-1 text-sm dark:bg-zinc-950"
                disabled={readOnly}
                value={rows[i]?.observaciones ?? ""}
                onChange={(e) => {
                  const next = [...(state.filasPersonal ?? [])];
                  next[i] = { ...(next[i] ?? {}), observaciones: e.target.value };
                  patchState({ filasPersonal: next });
                }}
              />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (sec.tipo === "estado_final") {
    const ef = state.estadoFinal;
    return (
      <section className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
        <h3 className="mb-3 text-sm font-semibold">{sec.titulo}</h3>
        <div className="flex flex-col gap-2">
          {(["BUENO", "REGULAR", "REPARAR"] as const).map((x) => (
            <button
              key={x}
              type="button"
              disabled={readOnly}
              onClick={() => patchState({ estadoFinal: x })}
              className={cn(
                "min-h-12 rounded-lg border text-sm font-bold",
                ef === x ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-950" : "border-zinc-200 dark:border-zinc-700",
              )}
            >
              {x}
            </button>
          ))}
        </div>
      </section>
    );
  }

  return null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
      {label}
      {children}
    </label>
  );
}

