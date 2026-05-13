"use client";

import type { ItemRespuesta, ItemTemplate } from "@/lib/firestore/types";
import { cn } from "@/lib/utils";
import { useState } from "react";

const ESTADOS = ["BUENO", "REGULAR", "MALO"] as const;

type Props = {
  item: ItemTemplate;
  value: ItemRespuesta | undefined;
  readOnly?: boolean;
  onChange: (next: ItemRespuesta) => void;
};

export function ItemEstadoAA({ item, value, readOnly, onChange }: Props) {
  const [obsOpen, setObsOpen] = useState(() =>
    Boolean(value?.estado === "REGULAR" || value?.estado === "MALO" || value?.observacion),
  );

  const obsObl = value?.estado === "REGULAR" || value?.estado === "MALO";

  return (
    <div className="space-y-2 rounded-xl border border-zinc-200 bg-white px-3 py-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.label}</p>
        <div className="flex flex-wrap gap-2">
          {ESTADOS.map((est) => (
            <button
              key={est}
              type="button"
              disabled={readOnly}
              onClick={() => {
                onChange({
                  ...value,
                  estado: est,
                  observacion: est === "BUENO" ? undefined : value?.observacion,
                });
                setObsOpen(est !== "BUENO");
              }}
              className={cn(
                "min-h-10 min-w-[4.5rem] rounded-lg px-2 py-2 text-xs font-bold uppercase",
                est === "BUENO" && "bg-emerald-600 text-white",
                est === "REGULAR" && "bg-amber-500 text-zinc-950",
                est === "MALO" && "bg-red-600 text-white",
                value?.estado === est ? "ring-2 ring-offset-2 ring-zinc-900 dark:ring-offset-zinc-950" : "opacity-80",
              )}
            >
              {est}
            </button>
          ))}
        </div>
      </div>
      <div
        className={cn(
          "overflow-hidden transition-[max-height] duration-300 ease-out",
          obsOpen || obsObl ? "max-h-48" : "max-h-0",
        )}
      >
        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Observación {obsObl ? "(obligatoria)" : ""}
          <textarea
            required={obsObl}
            className="mt-1 min-h-20 w-full rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            disabled={readOnly}
            value={value?.observacion ?? ""}
            onChange={(e) => onChange({ ...value, observacion: e.target.value })}
          />
        </label>
      </div>
    </div>
  );
}
