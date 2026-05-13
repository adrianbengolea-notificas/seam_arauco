"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getFirebaseDb } from "@/firebase/firebaseClient";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type {
  ItemEstadoPlanilla,
  ItemTemplate,
  PlanillaTemplate,
  PlanillaTemplateEspecialidad,
  PlanillaTemplateSubTipo,
  PlanillaSeccionTipo,
  SeccionTemplate,
} from "@/lib/firestore/types";
import { cn } from "@/lib/utils";
import { doc, setDoc } from "firebase/firestore";
import { ArrowDown, ArrowUp, Plus, Save, Trash2, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

const TIPOS_SECCION: { value: PlanillaSeccionTipo; label: string }[] = [
  { value: "checklist", label: "Checklist" },
  { value: "grilla", label: "Grilla" },
  { value: "libre", label: "Texto libre" },
  { value: "datos_equipo", label: "Datos equipo" },
  { value: "datos_persona", label: "Personal" },
  { value: "estado_final", label: "Estado final" },
];

const ESPECIALIDADES: { value: PlanillaTemplateEspecialidad; label: string }[] = [
  { value: "A", label: "AA (A)" },
  { value: "E", label: "Eléctrico (E)" },
  { value: "GG", label: "GG" },
  { value: "*", label: "Todas (*)" },
];

const SUBTIPOS: { value: PlanillaTemplateSubTipo; label: string }[] = [
  { value: "preventivo", label: "Preventivo" },
  { value: "correctivo", label: "Correctivo" },
  { value: "*", label: "Cualquiera (*)" },
];

const ESTADOS_ITEM: ItemEstadoPlanilla[] = ["BUENO", "REGULAR", "MALO", "OK", "FALLA", "N/A"];

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function stripUndefinedDeep(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map(stripUndefinedDeep).filter((v) => v !== undefined);
  }
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const nv = stripUndefinedDeep(v);
    if (nv === undefined) continue;
    out[k] = nv;
  }
  return out;
}

function parseLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function linesToText(lines: string[] | undefined): string {
  return (lines ?? []).join("\n");
}

function sanitizeItem(it: ItemTemplate): Record<string, unknown> {
  const acciones = it.acciones?.filter((a) => a.trim());
  const columnas = it.columnas?.filter((a) => a.trim());
  const row: Record<string, unknown> = {
    id: it.id.trim(),
    label: it.label.trim(),
  };
  if (it.obligatorio) row.obligatorio = true;
  if (acciones?.length) row.acciones = acciones;
  if (columnas?.length) row.columnas = columnas;
  if (it.estadosDisponibles?.length) row.estadosDisponibles = it.estadosDisponibles;
  if (it.requiereObsEn?.length) row.requiereObsEn = it.requiereObsEn;
  return row;
}

function sanitizeTemplate(t: PlanillaTemplate): Record<string, unknown> {
  const secciones = t.secciones.map((sec) => {
    const base: Record<string, unknown> = {
      id: sec.id.trim(),
      titulo: sec.titulo.trim(),
      tipo: sec.tipo,
    };
    if (sec.obligatorio) base.obligatorio = true;
    if (sec.soloAdmin) base.soloAdmin = true;
    const etiqueta = sec.etiquetaLibre?.trim();
    if (etiqueta) base.etiquetaLibre = etiqueta;
    const cols = sec.grillaColumnas?.map((c) => c.trim()).filter(Boolean);
    if (cols?.length) base.grillaColumnas = cols;
    if (sec.maxFilasPersona != null && sec.maxFilasPersona >= 1) {
      base.maxFilasPersona = sec.maxFilasPersona;
    }
    const tiposConItems = sec.tipo === "checklist" || sec.tipo === "grilla";
    if (tiposConItems && sec.items?.length) {
      base.items = sec.items.map(sanitizeItem);
    }
    return base;
  });

  const docData: Record<string, unknown> = {
    id: t.id,
    nombre: t.nombre.trim(),
    especialidad: t.especialidad,
    subTipo: t.subTipo,
    secciones,
  };
  return stripUndefinedDeep(docData) as Record<string, unknown>;
}

function validateTemplate(t: PlanillaTemplate): string | null {
  if (!t.nombre.trim()) return "El nombre de la plantilla es obligatorio.";
  if (!t.secciones.length) return "Agregá al menos una sección.";

  const secIds = new Set<string>();
  for (const sec of t.secciones) {
    if (!sec.id.trim()) return "Hay una sección sin ID.";
    if (secIds.has(sec.id.trim())) return `ID de sección duplicado: ${sec.id.trim()}`;
    secIds.add(sec.id.trim());
    if (!sec.titulo.trim()) return `La sección “${sec.id}” necesita título.`;

    if (sec.tipo === "checklist" || sec.tipo === "grilla") {
      if (!sec.items?.length) {
        return `La sección “${sec.titulo}” (${sec.tipo}) necesita al menos un ítem.`;
      }
      const itemIds = new Set<string>();
      for (const it of sec.items) {
        if (!it.id.trim()) return `Ítem sin ID en “${sec.titulo}”.`;
        if (itemIds.has(it.id.trim())) return `ID duplicado en “${sec.titulo}”: ${it.id.trim()}`;
        itemIds.add(it.id.trim());
        if (!it.label.trim()) return `Ítem ${it.id} en “${sec.titulo}” necesita etiqueta.`;
      }
    }
  }
  return null;
}

const selectClass = cn(
  "flex h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm shadow-sm",
  "text-foreground transition-[border-color,box-shadow] duration-150",
  "focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
);

type Props = {
  template: PlanillaTemplate;
  onCancel: () => void;
  onSaved: () => void;
};

export function PlanillaTemplateEditor({ template, onCancel, onSaved }: Props) {
  const [draft, setDraft] = useState<PlanillaTemplate>(() => structuredClone(template));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const validationError = useMemo(() => validateTemplate(draft), [draft]);

  const updateSec = useCallback((index: number, patch: Partial<SeccionTemplate>) => {
    setDraft((d) => {
      const secciones = [...d.secciones];
      secciones[index] = { ...secciones[index], ...patch };
      return { ...d, secciones };
    });
  }, []);

  const moveSec = useCallback((index: number, dir: -1 | 1) => {
    setDraft((d) => {
      const j = index + dir;
      if (j < 0 || j >= d.secciones.length) return d;
      const secciones = [...d.secciones];
      [secciones[index], secciones[j]] = [secciones[j], secciones[index]];
      return { ...d, secciones };
    });
  }, []);

  const removeSec = useCallback((index: number) => {
    setDraft((d) => ({
      ...d,
      secciones: d.secciones.filter((_, i) => i !== index),
    }));
  }, []);

  const addSec = useCallback(() => {
    setDraft((d) => ({
      ...d,
      secciones: [
        ...d.secciones,
        {
          id: newId("seccion"),
          titulo: "Nueva sección",
          tipo: "libre",
          obligatorio: false,
        },
      ],
    }));
  }, []);

  const updateItem = useCallback((secIndex: number, itemIndex: number, patch: Partial<ItemTemplate>) => {
    setDraft((d) => {
      const secciones = [...d.secciones];
      const sec = { ...secciones[secIndex] };
      const items = [...(sec.items ?? [])];
      items[itemIndex] = { ...items[itemIndex], ...patch };
      sec.items = items;
      secciones[secIndex] = sec;
      return { ...d, secciones };
    });
  }, []);

  const moveItem = useCallback((secIndex: number, itemIndex: number, dir: -1 | 1) => {
    setDraft((d) => {
      const secciones = [...d.secciones];
      const sec = { ...secciones[secIndex] };
      const items = [...(sec.items ?? [])];
      const j = itemIndex + dir;
      if (j < 0 || j >= items.length) return d;
      [items[itemIndex], items[j]] = [items[j], items[itemIndex]];
      sec.items = items;
      secciones[secIndex] = sec;
      return { ...d, secciones };
    });
  }, []);

  const removeItem = useCallback((secIndex: number, itemIndex: number) => {
    setDraft((d) => {
      const secciones = [...d.secciones];
      const sec = { ...secciones[secIndex] };
      sec.items = (sec.items ?? []).filter((_, i) => i !== itemIndex);
      secciones[secIndex] = sec;
      return { ...d, secciones };
    });
  }, []);

  const addItem = useCallback((secIndex: number) => {
    setDraft((d) => {
      const secciones = [...d.secciones];
      const sec = { ...secciones[secIndex] };
      const items = [...(sec.items ?? [])];
      items.push({
        id: newId("item"),
        label: "",
        obligatorio: false,
      });
      sec.items = items;
      secciones[secIndex] = sec;
      return { ...d, secciones };
    });
  }, []);

  const toggleEstado = useCallback(
    (secIndex: number, itemIndex: number, field: "estadosDisponibles" | "requiereObsEn", est: ItemEstadoPlanilla) => {
      setDraft((d) => {
        const secciones = [...d.secciones];
        const sec = { ...secciones[secIndex] };
        const items = [...(sec.items ?? [])];
        const it = { ...items[itemIndex] };
        const cur = new Set(it[field] ?? []);
        if (cur.has(est)) cur.delete(est);
        else cur.add(est);
        it[field] = cur.size ? (Array.from(cur) as ItemEstadoPlanilla[]) : undefined;
        items[itemIndex] = it;
        sec.items = items;
        secciones[secIndex] = sec;
        return { ...d, secciones };
      });
    },
    [],
  );

  async function guardar() {
    setMessage(null);
    const err = validateTemplate(draft);
    if (err) {
      setMessage({ type: "err", text: err });
      return;
    }
    setSaving(true);
    try {
      const db = getFirebaseDb();
      const ref = doc(db, COLLECTIONS.planilla_templates, draft.id);
      const payload = sanitizeTemplate(draft);
      await setDoc(ref, payload);
      onSaved();
    } catch (e) {
      setMessage({
        type: "err",
        text: e instanceof Error ? e.message : "No se pudo guardar",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border-brand/40 shadow-md">
      <CardHeader className="space-y-1 border-b border-zinc-100 pb-4 dark:border-zinc-800">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-lg">Editar plantilla</CardTitle>
            <CardDescription>
              Documento <span className="font-mono">{draft.id}</span> · Cambiar IDs de secciones o ítems puede afectar OT en curso.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setDraft(structuredClone(template))}>
              Deshacer cambios
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              <X className="mr-1 h-4 w-4" />
              Cerrar
            </Button>
            <Button type="button" size="sm" disabled={saving || !!validationError} onClick={() => void guardar()}>
              <Save className="mr-1 h-4 w-4" />
              {saving ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </div>
        {validationError ? (
          <p className="text-sm text-amber-800 dark:text-amber-200">{validationError}</p>
        ) : null}
        {message ? (
          <p
            className={cn(
              "text-sm rounded-md px-2 py-1",
              message.type === "ok"
                ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100"
                : "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200",
            )}
          >
            {message.text}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Nombre visible</label>
            <Input
              value={draft.nombre}
              onChange={(e) => setDraft((d) => ({ ...d, nombre: e.target.value }))}
              placeholder="Ej. Planilla GG"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Especialidad</label>
            <select
              className={selectClass}
              value={draft.especialidad}
              onChange={(e) =>
                setDraft((d) => ({ ...d, especialidad: e.target.value as PlanillaTemplateEspecialidad }))
              }
            >
              {ESPECIALIDADES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Subtipo OT</label>
            <select
              className={selectClass}
              value={draft.subTipo}
              onChange={(e) =>
                setDraft((d) => ({ ...d, subTipo: e.target.value as PlanillaTemplateSubTipo }))
              }
            >
              {SUBTIPOS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Secciones</h3>
          <Button type="button" variant="outline" size="sm" onClick={addSec}>
            <Plus className="mr-1 h-4 w-4" />
            Agregar sección
          </Button>
        </div>

        <ul className="space-y-4">
          {draft.secciones.map((sec, si) => {
            const conItems = sec.tipo === "checklist" || sec.tipo === "grilla";
            return (
              <li
                key={`${sec.id}-${si}`}
                className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-700 dark:bg-zinc-900/30"
              >
                <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200/80 pb-3 dark:border-zinc-700">
                  <span className="text-xs font-medium text-zinc-500">#{si + 1}</span>
                  <Button type="button" variant="ghost" size="sm" className="h-8 w-8" onClick={() => moveSec(si, -1)}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-8 w-8" onClick={() => moveSec(si, 1)}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <span className="flex-1" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:text-red-700 dark:text-red-400"
                    onClick={() => removeSec(si)}
                  >
                    <Trash2 className="mr-1 h-4 w-4" />
                    Quitar sección
                  </Button>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">ID (técnico)</label>
                    <Input value={sec.id} onChange={(e) => updateSec(si, { id: e.target.value })} className="font-mono text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Título</label>
                    <Input value={sec.titulo} onChange={(e) => updateSec(si, { titulo: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Tipo</label>
                    <select
                      className={selectClass}
                      value={sec.tipo}
                      onChange={(e) => {
                        const tipo = e.target.value as PlanillaSeccionTipo;
                        const patch: Partial<SeccionTemplate> = { tipo };
                        if (tipo === "checklist" || tipo === "grilla") {
                          patch.items = sec.items?.length ? sec.items : [{ id: newId("item"), label: "", obligatorio: false }];
                          if (tipo === "grilla" && !(sec.grillaColumnas?.length)) {
                            patch.grillaColumnas = ["Verificada", "Cant. en falla", "Operativas", "Comentarios"];
                          }
                          if (tipo === "checklist") patch.grillaColumnas = undefined;
                        } else {
                          patch.items = undefined;
                          patch.grillaColumnas = undefined;
                        }
                        if (tipo !== "libre") patch.etiquetaLibre = undefined;
                        updateSec(si, patch);
                      }}
                    >
                      {TIPOS_SECCION.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 pt-6 sm:pt-8">
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(sec.obligatorio)}
                        onChange={(e) => updateSec(si, { obligatorio: e.target.checked })}
                        className="rounded border-zinc-300"
                      />
                      Obligatorio
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(sec.soloAdmin)}
                        onChange={(e) => updateSec(si, { soloAdmin: e.target.checked })}
                        className="rounded border-zinc-300"
                      />
                      Solo admin
                    </label>
                  </div>
                </div>

                {sec.tipo === "libre" ? (
                  <div className="mt-3 space-y-1.5">
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Etiqueta del campo (opcional)</label>
                    <Input
                      value={sec.etiquetaLibre ?? ""}
                      onChange={(e) => updateSec(si, { etiquetaLibre: e.target.value || undefined })}
                      placeholder="Texto de ayuda encima del área"
                    />
                  </div>
                ) : null}

                {sec.tipo === "grilla" ? (
                  <div className="mt-3 space-y-1.5">
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Columnas de la grilla (una por línea)
                    </label>
                    <Textarea
                      className="min-h-[88px] font-mono text-xs"
                      value={linesToText(sec.grillaColumnas)}
                      onChange={(e) =>
                        updateSec(si, {
                          grillaColumnas: parseLines(e.target.value),
                        })
                      }
                      placeholder="Verificada&#10;Cant. en falla"
                    />
                  </div>
                ) : null}

                {sec.tipo === "datos_persona" ? (
                  <div className="mt-3 space-y-1.5">
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Máx. filas de personal</label>
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      value={sec.maxFilasPersona ?? ""}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        updateSec(si, { maxFilasPersona: Number.isFinite(n) ? n : undefined });
                      }}
                    />
                  </div>
                ) : null}

                {conItems ? (
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Ítems</span>
                      <Button type="button" variant="outline" size="sm" onClick={() => addItem(si)}>
                        <Plus className="mr-1 h-4 w-4" />
                        Ítem
                      </Button>
                    </div>
                    <ul className="space-y-3">
                      {(sec.items ?? []).map((it, ii) => {
                        const showEstadoOpts =
                          draft.especialidad === "A" ||
                          Boolean(it.estadosDisponibles?.length || it.requiereObsEn?.length);
                        return (
                        <li
                          key={`${it.id}-${ii}`}
                          className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-600 dark:bg-zinc-950/40"
                        >
                          <div className="flex flex-wrap items-start gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 shrink-0"
                              onClick={() => moveItem(si, ii, -1)}
                            >
                              <ArrowUp className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 shrink-0"
                              onClick={() => moveItem(si, ii, 1)}
                            >
                              <ArrowDown className="h-4 w-4" />
                            </Button>
                            <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                              <Input
                                className="font-mono text-xs"
                                value={it.id}
                                onChange={(e) => updateItem(si, ii, { id: e.target.value })}
                                placeholder="id_item"
                              />
                              <label className="flex cursor-pointer items-center gap-2 text-sm sm:col-span-2">
                                <input
                                  type="checkbox"
                                  checked={Boolean(it.obligatorio)}
                                  onChange={(e) => updateItem(si, ii, { obligatorio: e.target.checked })}
                                  className="rounded border-zinc-300"
                                />
                                Ítem obligatorio
                              </label>
                              <Textarea
                                className="min-h-[72px] sm:col-span-2"
                                value={it.label}
                                onChange={(e) => updateItem(si, ii, { label: e.target.value })}
                                placeholder="Texto del ítem"
                              />
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="shrink-0 text-red-600"
                              onClick={() => removeItem(si, ii)}
                              aria-label="Quitar ítem"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                          <div className="mt-3 space-y-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                              Acciones (GG checklist, una por línea)
                            </label>
                            <Textarea
                              className="min-h-[64px] text-sm"
                              value={linesToText(it.acciones)}
                              onChange={(e) =>
                                updateItem(si, ii, {
                                  acciones: parseLines(e.target.value).length ? parseLines(e.target.value) : undefined,
                                })
                              }
                              placeholder="Verificar&#10;Cambiar"
                            />
                            {showEstadoOpts ? (
                              <div className="space-y-2 rounded-md border border-zinc-200 bg-zinc-50/90 p-3 dark:border-zinc-700 dark:bg-zinc-900/50">
                                <p className="text-[11px] leading-snug text-zinc-600 dark:text-zinc-400">
                                  <span className="font-medium text-zinc-700 dark:text-zinc-300">Selector de estado (planilla AA).</span>{" "}
                                  Las dos filas de opciones no están duplicadas: la primera define qué estados ve el técnico; la segunda, en
                                  cuáles debe completar observación.
                                </p>
                                <div>
                                  <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200">Estados disponibles en el selector</p>
                                  <div className="mt-1.5 flex flex-wrap gap-2">
                                    {ESTADOS_ITEM.map((est) => (
                                      <label key={est} className="flex cursor-pointer items-center gap-1.5 text-xs">
                                        <input
                                          type="checkbox"
                                          checked={Boolean(it.estadosDisponibles?.includes(est))}
                                          onChange={() => toggleEstado(si, ii, "estadosDisponibles", est)}
                                          className="rounded border-zinc-300"
                                        />
                                        {est}
                                      </label>
                                    ))}
                                  </div>
                                </div>
                                <div>
                                  <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200">
                                    Exigir observación cuando el estado sea
                                  </p>
                                  <div className="mt-1.5 flex flex-wrap gap-2">
                                    {ESTADOS_ITEM.map((est) => (
                                      <label key={`req-${est}`} className="flex cursor-pointer items-center gap-1.5 text-xs">
                                        <input
                                          type="checkbox"
                                          checked={Boolean(it.requiereObsEn?.includes(est))}
                                          onChange={() => toggleEstado(si, ii, "requiereObsEn", est)}
                                          className="rounded border-zinc-300"
                                        />
                                        {est}
                                      </label>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
