"use client";

import type { ItemRespuesta, ItemTemplate } from "@/lib/firestore/types";
import { cn } from "@/lib/utils";

type Props = {
  item: ItemTemplate;
  value: ItemRespuesta | undefined;
  readOnly?: boolean;
  onChange: (next: ItemRespuesta) => void;
};

function accionRequiereObs(accion: string): boolean {
  const a = accion.toLowerCase();
  return a.includes("cambiar") || a.includes("reemplazar");
}

type AccionRespuesta = { checklist?: boolean; servis?: boolean; observacion?: string };

function toggleAccion(
  value: ItemRespuesta | undefined,
  accion: string,
  col: "checklist" | "servis",
): ItemRespuesta {
  const prev: AccionRespuesta = value?.accionesRespuestas?.[accion] ?? {};
  return {
    ...value,
    accionesRespuestas: {
      ...(value?.accionesRespuestas ?? {}),
      [accion]: { ...prev, [col]: !prev[col] },
    },
  };
}

function setAccionObs(
  value: ItemRespuesta | undefined,
  accion: string,
  observacion: string,
): ItemRespuesta {
  const prev: AccionRespuesta = value?.accionesRespuestas?.[accion] ?? {};
  return {
    ...value,
    accionesRespuestas: {
      ...(value?.accionesRespuestas ?? {}),
      [accion]: { ...prev, observacion },
    },
  };
}

const btnBase =
  "min-h-9 min-w-[6.5rem] rounded-full border px-3 text-[11px] font-semibold uppercase tracking-wide transition-colors";

export function ItemChecklistGG({ item, value, readOnly, onChange }: Props) {
  const acciones = item.acciones ?? [];

  // Items sin acciones: fila única con Check list / Servis a nivel de ítem
  if (acciones.length === 0) {
    return (
      <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.label}</span>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled={readOnly}
            onClick={() => onChange({ ...value, checklist: !value?.checklist })}
            className={cn(
              btnBase,
              value?.checklist
                ? "border-emerald-600 bg-emerald-600 text-white"
                : "border-zinc-300 bg-zinc-50 text-zinc-600 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-400",
            )}
          >
            Check list
          </button>
          <button
            type="button"
            disabled={readOnly}
            onClick={() => onChange({ ...value, servis: !value?.servis })}
            className={cn(
              btnBase,
              value?.servis
                ? "border-sky-600 bg-sky-600 text-white"
                : "border-zinc-300 bg-zinc-50 text-zinc-600 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-400",
            )}
          >
            Servis
          </button>
        </div>
      </div>
    );
  }

  // Items con acciones: header + una fila por acción
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="border-b border-zinc-100 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
        <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{item.label}</span>
      </div>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {acciones.map((accion) => {
          const ar: AccionRespuesta = value?.accionesRespuestas?.[accion] ?? {};
          const needObs = accionRequiereObs(accion) && (ar.checklist || ar.servis) && !readOnly;
          return (
            <div key={accion} className="px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-zinc-700 dark:text-zinc-300">· {accion}</span>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => onChange(toggleAccion(value, accion, "checklist"))}
                    className={cn(
                      btnBase,
                      ar.checklist
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-zinc-300 bg-zinc-50 text-zinc-600 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-400",
                    )}
                  >
                    Check list
                  </button>
                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => onChange(toggleAccion(value, accion, "servis"))}
                    className={cn(
                      btnBase,
                      ar.servis
                        ? "border-sky-600 bg-sky-600 text-white"
                        : "border-zinc-300 bg-zinc-50 text-zinc-600 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-400",
                    )}
                  >
                    Servis
                  </button>
                </div>
              </div>
              {needObs || ar.observacion ? (
                <label className="mt-2 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Observación {needObs ? "(obligatoria)" : ""}
                  {needObs ? (
                    <span className="mt-0.5 block font-normal text-zinc-500 dark:text-zinc-500">
                      Marcaste cambio o reemplazo: el botón no alcanza — escribí qué se hizo en esa tarea.
                    </span>
                  ) : null}
                  <textarea
                    className="mt-1 min-h-16 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                    disabled={readOnly}
                    placeholder={
                      needObs
                        ? "Ej.: pieza cambiada, motivo, marca/modelo…"
                        : undefined
                    }
                    value={ar.observacion ?? ""}
                    onChange={(e) => onChange(setAccionObs(value, accion, e.target.value))}
                  />
                </label>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
