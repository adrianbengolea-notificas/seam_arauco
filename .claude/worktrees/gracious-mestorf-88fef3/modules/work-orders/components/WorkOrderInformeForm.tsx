"use client";

import { actionGenerateWorkReportDraft } from "@/app/actions/ai";
import { actionUpdateWorkOrderInforme } from "@/app/actions/work-orders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getClientIdToken } from "@/modules/users/hooks";
import type { WorkOrder } from "@/modules/work-orders/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const schema = z.object({
  texto_trabajo: z.string().min(1, "Completá el informe").max(24_000),
  ai_keywords: z.string().max(8000).optional(),
});

type FormValues = z.infer<typeof schema>;

export function WorkOrderInformeForm({
  workOrder,
  onMessage,
  iaEnabled = true,
}: {
  workOrder: WorkOrder;
  onMessage: (msg: string | null) => void;
  /** `centros/{id}.modulos.ia` */
  iaEnabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      texto_trabajo: workOrder.texto_trabajo ?? "",
      ai_keywords: "",
    },
  });

  async function token() {
    const t = await getClientIdToken();
    if (!t) throw new Error("Sin sesión");
    return t;
  }

  async function onSubmit(values: FormValues) {
    onMessage(null);
    setBusy(true);
    try {
      const res = await actionUpdateWorkOrderInforme(await token(), {
        workOrderId: workOrder.id,
        texto_trabajo: values.texto_trabajo,
      });
      onMessage(res.ok ? "Informe guardado" : res.error.message);
    } catch (e) {
      onMessage(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setBusy(false);
    }
  }

  async function onAi(field: "trabajo_realizado" | "observaciones") {
    onMessage(null);
    const keywords =
      form.getValues("ai_keywords")?.trim() || form.getValues("texto_trabajo").trim().slice(0, 2000);
    if (!keywords) {
      onMessage("Agregá palabras clave o texto en el informe para usar la IA");
      return;
    }
    setBusy(true);
    try {
      const res = await actionGenerateWorkReportDraft(await token(), {
        keywords,
        fieldType: field,
        assetLabel: `${workOrder.codigo_activo_snapshot} · ${workOrder.ubicacion_tecnica}`,
        otN: workOrder.n_ot,
      });
      if (res.ok) {
        form.setValue("texto_trabajo", res.data.text);
        onMessage("Borrador generado — revisá y guardá");
      } else {
        onMessage(res.error.message);
      }
    } catch (e) {
      onMessage(e instanceof Error ? e.message : "Error de IA");
    } finally {
      setBusy(false);
    }
  }

  const cerrada = workOrder.estado === "CERRADA" || workOrder.estado === "ANULADA";

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
      {iaEnabled ? (
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Palabras clave (para IA, opcional)
          </label>
          <Input
            placeholder="Ej.: reemplazo sello, prueba 15 min sin fugas…"
            disabled={cerrada || busy}
            {...form.register("ai_keywords")}
          />
        </div>
      ) : (
        <p className="text-xs text-zinc-500">El módulo de IA está deshabilitado para este centro.</p>
      )}
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Informe / trabajo ejecutado
        </label>
        <Textarea disabled={cerrada || busy} className="min-h-[160px]" {...form.register("texto_trabajo")} />
        {form.formState.errors.texto_trabajo ? (
          <p className="mt-1 text-xs text-red-600">{form.formState.errors.texto_trabajo.message}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={cerrada || busy}>
          Guardar informe
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={cerrada || busy || !iaEnabled}
          onClick={() => void onAi("trabajo_realizado")}
        >
          IA: trabajo realizado
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={cerrada || busy || !iaEnabled}
          onClick={() => void onAi("observaciones")}
        >
          IA: observaciones
        </Button>
      </div>
      {cerrada ? (
        <p className="text-xs text-zinc-500">La OT cerrada o anulada no admite edición del informe.</p>
      ) : null}
    </form>
  );
}
