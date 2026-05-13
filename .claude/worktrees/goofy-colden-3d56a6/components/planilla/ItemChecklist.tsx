"use client";

import type { ItemRespuesta, ItemTemplate } from "@/lib/firestore/types";
import { cn } from "@/lib/utils";
import { useState } from "react";

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

export function ItemChecklistGG({ item, value, readOnly, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const acciones = item.acciones ?? [];
  const needObs =
    value?.accionSeleccionada && accionRequiereObs(value.accionSeleccionada) && !readOnly;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <button
        type="button"
        disabled={readOnly}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-3 text-left text-sm font-medium text-zinc-900 dark:text-zinc-100"
      >
        <span>{item.label}</span>
        <span className="text-xs font-normal text-zinc-500">{open ? "▲" : "▼"}</span>
      </button>

      <div className="border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
        <div className="flex flex-wrap gap-2">
          {(["checklist", "servis"] as const).map((col) => (
            <button
              key={col}
              type="button"
              disabled={readOnly}
              onClick={() => {
                const base = { ...value };
                if (col === "checklist") base.checklist = !base.checklist;
                else base.servis = !base.servis;
                onChange(base);
              }}
              className={cn(
                "min-h-11 min-w-[7rem] rounded-full border px-3 text-xs font-semibold uppercase tracking-wide transition-colors",
                col === "checklist"
                  ? value?.checklist
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-zinc-300 bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900"
                  : value?.servis
                    ? "border-sky-600 bg-sky-600 text-white"
                    : "border-zinc-300 bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900",
              )}
            >
              {col === "checklist" ? "Check list" : "Servis"}
            </button>
          ))}
        </div>
      </div>

      {open || acciones.length === 0 ? (
        <div className="space-y-2 border-t border-zinc-100 px-3 py-3 dark:border-zinc-800">
          <p className="text-[11px] font-medium uppercase text-zinc-500">Acción realizada</p>
          <div className="flex flex-wrap gap-2">
            {acciones.map((a) => (
              <button
                key={a}
                type="button"
                disabled={readOnly}
                onClick={() =>
                  onChange({
                    ...value,
                    accionSeleccionada: value?.accionSeleccionada === a ? undefined : a,
                  })
                }
                className={cn(
                  "min-h-11 rounded-lg border px-3 py-2 text-sm transition-colors",
                  value?.accionSeleccionada === a
                    ? "border-indigo-600 bg-indigo-600 text-white"
                    : "border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900",
                )}
              >
                {a}
              </button>
            ))}
            {!acciones.length ? (
              <p className="text-xs text-zinc-500">Marcá Check list o Servis según corresponda.</p>
            ) : null}
          </div>
          {needObs || value?.observacion ? (
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Observación {needObs ? "(obligatoria)" : ""}
              <textarea
                className="mt-1 min-h-20 w-full rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                disabled={readOnly}
                value={value?.observacion ?? ""}
                onChange={(e) => onChange({ ...value, observacion: e.target.value })}
              />
            </label>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
