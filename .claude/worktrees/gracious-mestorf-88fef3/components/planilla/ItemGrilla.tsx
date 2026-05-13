"use client";

import type { ItemRespuesta, ItemTemplate } from "@/lib/firestore/types";
import { cn } from "@/lib/utils";

type Props = {
  item: ItemTemplate;
  value: ItemRespuesta | undefined;
  readOnly?: boolean;
  onChange: (next: ItemRespuesta) => void;
};

export function ItemGrillaElec({ item, value, readOnly, onChange }: Props) {
  const cant = value?.cantEnFalla ?? 0;
  const showComent = cant > 0;

  return (
    <div className="space-y-3 rounded-xl border border-zinc-200 bg-white px-3 py-3 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.label}</p>
      <label className="flex min-h-11 cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          disabled={readOnly}
          checked={Boolean(value?.verificada)}
          onChange={(e) => onChange({ ...value, verificada: e.target.checked })}
          className="h-6 w-6 shrink-0 rounded border-zinc-300 accent-emerald-600"
        />
        <span className="text-sm">Verificada</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Cant. en falla
          <input
            type="number"
            inputMode="numeric"
            disabled={readOnly}
            className="mt-1 min-h-11 w-full rounded-lg border border-zinc-200 bg-white px-2 text-base dark:border-zinc-700 dark:bg-zinc-950"
            value={value?.cantEnFalla ?? ""}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                onChange({ ...value, cantEnFalla: undefined });
                return;
              }
              const n = Number(raw);
              if (Number.isFinite(n)) onChange({ ...value, cantEnFalla: n });
            }}
          />
        </label>
        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Operativas
          <input
            type="number"
            inputMode="numeric"
            disabled={readOnly}
            className="mt-1 min-h-11 w-full rounded-lg border border-zinc-200 bg-white px-2 text-base dark:border-zinc-700 dark:bg-zinc-950"
            value={value?.operativas ?? ""}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                onChange({ ...value, operativas: undefined });
                return;
              }
              const n = Number(raw);
              if (Number.isFinite(n)) onChange({ ...value, operativas: n });
            }}
          />
        </label>
      </div>
      <div
        className={cn(
          "overflow-hidden transition-[max-height,opacity] duration-300",
          showComent ? "max-h-56 opacity-100" : "max-h-0 opacity-0",
        )}
      >
        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Comentarios (obligatorio si hay fallas)
          <textarea
            className="mt-1 min-h-24 w-full rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            disabled={readOnly}
            value={value?.comentario ?? value?.observacion ?? ""}
            onChange={(e) => onChange({ ...value, comentario: e.target.value })}
          />
        </label>
      </div>
    </div>
  );
}
