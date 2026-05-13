"use client";

import { countOutbox, drainOutbox } from "@/lib/offline/ot-db";
import { useEffect, useRef } from "react";
import { useOnlineStatus } from "@/hooks/use-online";

export type OfflineSyncOptions = {
  onSyncStart?: () => void;
  onSyncEnd?: () => void;
};

/**
 * Cuando vuelve la red, vacía la cola outbox. El caller debe pasar un handler que
 * re-ejecute server actions con el token vigente.
 *
 * Notas: `options` no debe formar parte de las dependencias del efecto (suele ser un
 * objeto literal en cada render); se lee vía ref. Si la cola está vacía no se invocan
 * callbacks ni se bloquea UI — evita parpadeos de banner por re-renders en vivo (Firestore).
 */
export function useOfflineSync(
  enabled: boolean,
  flush: (payload: { type: string; payload: unknown }) => Promise<void>,
  options?: OfflineSyncOptions,
) {
  const online = useOnlineStatus();
  const flushing = useRef(false);
  const flushRef = useRef(flush);
  const optionsRef = useRef(options);
  flushRef.current = flush;
  optionsRef.current = options;

  useEffect(() => {
    if (!enabled || !online || flushing.current) return;
    flushing.current = true;

    void (async () => {
      let started = false;
      try {
        const pending = await countOutbox();
        if (pending === 0) return;
        started = true;
        optionsRef.current?.onSyncStart?.();
        await drainOutbox(async (item) => {
          await flushRef.current({ type: item.type, payload: item.payload });
        });
      } finally {
        flushing.current = false;
        if (started) optionsRef.current?.onSyncEnd?.();
      }
    })();
  }, [enabled, online, flush]);
}
