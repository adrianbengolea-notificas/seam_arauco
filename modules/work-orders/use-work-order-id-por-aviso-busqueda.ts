"use client";

import { actionBuscarWorkOrderIdPorAviso } from "@/app/actions/work-orders";
import { KNOWN_CENTROS } from "@/lib/config/app-config";
import { getClientIdToken } from "@/modules/users/hooks";
import { useEffect, useMemo, useState } from "react";

/**
 * Resuelve el id de OT vinculada a un aviso vía servidor (Admin SDK).
 * Cubre OT archivadas y vínculos rotos en `avisos`.
 */
export function useWorkOrderIdPorAvisoBusqueda(input: {
  avisoDocId?: string;
  avisoNumero?: string;
  centros?: string[];
  buscarEnTodasLasPlantas?: boolean;
  enabled?: boolean;
}): { workOrderId: string | undefined; loading: boolean } {
  const avisoDocId = input.avisoDocId?.trim() || undefined;
  const avisoNumero = input.avisoNumero?.trim() || undefined;
  const centros = useMemo(() => {
    if (input.buscarEnTodasLasPlantas) return [...KNOWN_CENTROS];
    return [...new Set((input.centros ?? []).map((c) => c.trim()).filter(Boolean))];
  }, [input.buscarEnTodasLasPlantas, input.centros]);
  const centrosKey = centros.join("\0");
  const enabled = input.enabled !== false && Boolean(avisoDocId || avisoNumero);

  const [workOrderId, setWorkOrderId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(Boolean(enabled));

  useEffect(() => {
    if (!enabled) {
      setWorkOrderId(undefined);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void (async () => {
      const tok = await getClientIdToken();
      if (cancelled || !tok || !avisoNumero) {
        if (!cancelled) {
          setWorkOrderId(undefined);
          setLoading(false);
        }
        return;
      }

      try {
        const res = await actionBuscarWorkOrderIdPorAviso(tok, {
          avisoNumero,
          avisoDocId,
          centros: centros.length ? centros : undefined,
        });
        if (!cancelled) {
          setWorkOrderId(res.ok && res.data.workOrderId ? res.data.workOrderId : undefined);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setWorkOrderId(undefined);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, avisoDocId, avisoNumero, centrosKey]);

  return { workOrderId, loading };
}
