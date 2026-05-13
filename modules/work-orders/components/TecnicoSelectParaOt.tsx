"use client";

import { actionListTecnicosParaAsignacionOt } from "@/app/actions/work-orders";
import { nombreCentro } from "@/lib/config/app-config";
import { getClientIdToken } from "@/modules/users/hooks";
import { useEffect, useState } from "react";

type Opt = { uid: string; display_name: string; email: string };

/**
 * Desplegable de técnicos del centro (carga vía server action con Admin SDK).
 * Requiere permiso de reasignar, crear OT manual o crear orden desde programa.
 */
export function TecnicoSelectParaOt({
  centro,
  valueUid,
  onValueChange,
  disabled,
  id,
  className,
}: {
  centro: string;
  valueUid: string;
  onValueChange: (uid: string, displayName: string) => void | Promise<void>;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const [opts, setOpts] = useState<Opt[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    const c = centro.trim();
    if (!c) {
      setOpts([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadErr(null);
    void (async () => {
      const t = await getClientIdToken();
      if (!t || cancelled) {
        if (!cancelled) setLoading(false);
        return;
      }
      const res = await actionListTecnicosParaAsignacionOt(t, { centro: c });
      if (cancelled) return;
      setLoading(false);
      if (res.ok) {
        setOpts(res.data);
      } else {
        setOpts([]);
        setLoadErr(res.error.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [centro]);

  const valueNorm = valueUid.trim();
  const valueInList = !valueNorm || opts.some((o) => o.uid === valueNorm);

  return (
    <div className="space-y-1">
      <select
        id={id}
        className={
          className ??
          "flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"
        }
        value={valueInList ? valueNorm : "__unknown__"}
        disabled={disabled || loading || !centro.trim()}
        aria-busy={loading}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__unknown__") return;
          if (!v) {
            void onValueChange("", "");
            return;
          }
          const row = opts.find((o) => o.uid === v);
          void onValueChange(v, row?.display_name ?? "");
        }}
      >
        {!valueInList && valueNorm ? (
          <option value="__unknown__" disabled>
            Asignado (uid no listado)…
          </option>
        ) : null}
        <option value="">Sin técnico aún (equipo de esta planta)</option>
        {opts.map((o) => (
          <option key={o.uid} value={o.uid}>
            {o.display_name}
            {o.email ? ` · ${o.email}` : ""}
          </option>
        ))}
      </select>
      {loading ? <p className="text-xs text-muted-foreground">Cargando técnicos…</p> : null}
      {loadErr ? (
        <p className="text-xs text-destructive" role="alert">
          {loadErr.includes("insuficientes")
            ? "Tu usuario no tiene permiso para cargar la lista de técnicos, o la sesión está desactualizada. Cerrá sesión y volvé a entrar; si sos supervisor o admin y sigue igual, consultá con quien gestiona permisos."
            : loadErr}
        </p>
      ) : null}
      {!loading && !loadErr && opts.length === 0 && centro.trim() ? (
        <p className="text-xs text-amber-800 dark:text-amber-200">
          No hay usuarios con rol <span className="font-medium">técnico</span> activos para la planta{" "}
          <span className="font-medium">{nombreCentro(centro)}</span> en el sistema, por eso no aparece nadie para elegir.
          Revisá en administración de usuarios que el personal de campo tenga rol técnico, centro correcto y cuenta
          activa; después podrás asignar desde acá o desde el detalle de la orden.
        </p>
      ) : null}
    </div>
  );
}
