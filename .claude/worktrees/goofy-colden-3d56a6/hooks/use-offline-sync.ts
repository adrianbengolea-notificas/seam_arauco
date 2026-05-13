"use client";

import { drainOutbox } from "@/lib/offline/ot-db";
import { useEffect, useRef } from "react";
import { useOnlineStatus } from "@/hooks/use-online";

/**
 * Cuando vuelve la red, vacía la cola outbox. El caller debe pasar un handler que
 * re-ejecute server actions con el token vigente.
 */
export function useOfflineSync(
  enabled: boolean,
  flush: (payload: { type: string; payload: unknown }) => Promise<void>,
) {
  const online = useOnlineStatus();
  const flushing = useRef(false);

  useEffect(() => {
    if (!enabled || !online || flushing.current) return;
    flushing.current = true;
    void drainOutbox(async (item) => {
      await flush({ type: item.type, payload: item.payload });
    }).finally(() => {
      flushing.current = false;
    });
  }, [enabled, online, flush]);
}
