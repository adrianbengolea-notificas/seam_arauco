"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { DEFAULT_CENTRO, KNOWN_CENTROS } from "@/lib/config/app-config";
import { mergeCentroConfig } from "@/modules/centros/merge-config";
import type { CentroConfigEffective } from "@/modules/centros/types";
import { TODAS_ESPECIALIDADES, type CentroFirestoreDoc } from "@/modules/centros/types";
import type { Especialidad } from "@/modules/notices/types";
import { isSuperAdminRole } from "@/modules/users/roles";
import { useAuth } from "@/modules/users/hooks";
import { getFirebaseDb } from "@/firebase/firebaseClient";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";

const ESP_LABEL: Record<Especialidad, string> = {
  AA: "Aire (AA)",
  ELECTRICO: "Eléctrico",
  GG: "GG",
  HG: "HG",
};

export function SuperadminCentroFlagsPanel() {
  const { profile } = useAuth();
  const superAdmin = isSuperAdminRole(profile?.rol);
  const baseCentro = profile?.centro?.trim() || DEFAULT_CENTRO;

  const [centroOptions, setCentroOptions] = useState<string[]>([...KNOWN_CENTROS]);
  const [selectedCentro, setSelectedCentro] = useState(baseCentro);
  const [config, setConfig] = useState<CentroConfigEffective>(() => mergeCentroConfig(undefined));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  /** Aviso persistente si falla listar la colección (onSnapshot exitoso no lo borra). */
  const [listCentrosNote, setListCentrosNote] = useState<string | null>(null);

  const effectiveCentro = superAdmin ? selectedCentro.trim() : baseCentro.trim();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const db = getFirebaseDb();
        const snap = await getDocs(collection(db, COLLECTIONS.centros));
        if (cancelled) return;
        const ids = snap.docs.map((d) => d.id);
        setCentroOptions(Array.from(new Set([...KNOWN_CENTROS, ...ids])).sort());
      } catch (e) {
        if (cancelled) return;
        const code = e && typeof e === "object" && "code" in e ? String((e as { code?: unknown }).code) : "";
        const errMsg = e instanceof Error ? e.message : "Error al listar centros";
        setCentroOptions([...KNOWN_CENTROS]);
        setListCentrosNote(
          code === "permission-denied" || /permissions/i.test(errMsg)
            ? "Firestore denegó listar centros (¿reglas desplegadas o base de datos equivocada?). Se usan solo centros definidos en la app; revisá `firebase deploy --only firestore:rules` y NEXT_PUBLIC_FIREBASE_FIRESTORE_DATABASE_ID."
            : errMsg,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const db = getFirebaseDb();
    const ref = doc(db, COLLECTIONS.centros, effectiveCentro);
    const unsub: Unsubscribe = onSnapshot(
      ref,
      (snap) => {
        setConfig(mergeCentroConfig(snap.exists() ? (snap.data() as CentroFirestoreDoc) : undefined));
        setLoading(false);
        setErrorMsg(null);
      },
      (err) => {
        setLoading(false);
        const raw = err instanceof Error ? err.message : "Error al leer centro";
        setErrorMsg(
          /permission|permissions/i.test(raw)
            ? "Sin permiso para leer este documento de centro. Verificá reglas Firestore y que tu usuario tenga rol en users/{uid} o claims sincronizados tras login."
            : raw,
        );
      },
    );
    return () => unsub();
  }, [effectiveCentro]);

  const toggleModulo = useCallback((key: "materiales" | "activos" | "ia") => {
    setConfig((c) => ({
      ...c,
      modulos: { ...c.modulos, [key]: !c.modulos[key] },
    }));
  }, []);

  const toggleEspecialidad = useCallback((esp: Especialidad) => {
    setConfig((c) => {
      const set = new Set(c.especialidades_activas);
      if (set.has(esp)) set.delete(esp);
      else set.add(esp);
      let next = TODAS_ESPECIALIDADES.filter((e) => set.has(e));
      if (next.length === 0) next = [...TODAS_ESPECIALIDADES];
      return { ...c, especialidades_activas: next };
    });
  }, []);

  async function guardar() {
    setSuccessMsg(null);
    setErrorMsg(null);
    setSaving(true);
    try {
      const db = getFirebaseDb();
      const ref = doc(db, COLLECTIONS.centros, effectiveCentro);
      const payload: CentroFirestoreDoc = {
        modulos: { ...config.modulos },
        especialidades_activas: [...config.especialidades_activas],
        requiere_firma_usuario_cierre: config.requiere_firma_usuario_cierre,
        auto_publicar_propuesta: config.auto_publicar_propuesta,
      };
      await setDoc(
        ref,
        { ...payload, updated_at: serverTimestamp() } as Record<string, unknown>,
        { merge: true },
      );
      setSuccessMsg("Guardado. Los cambios se reflejan en la app en segundos.");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  const exportHint = useMemo(() => {
    const base =
      typeof window !== "undefined"
        ? `${window.location.origin}/api/work-orders/export`
        : "/api/work-orders/export";
    return `${base}?centro=${encodeURIComponent(effectiveCentro)}&from=2026-01-01&to=2026-12-31`;
  }, [effectiveCentro]);

  return (
    <Card className="max-w-2xl border-amber-200/60 dark:border-amber-900/50">
      <CardHeader>
        <CardTitle className="text-base">Centro y módulos (tiempo real)</CardTitle>
        <CardDescription>
          Documento{" "}
          <code className="text-xs">
            {COLLECTIONS.centros}/{'{centroId}'}
          </code>
          . El menú principal y las reglas de cierre leen esta configuración en vivo; el servidor cachea
          lecturas ~60&nbsp;s para acciones.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {superAdmin ? (
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Centro a editar</label>
            <select
              className="flex h-9 w-full max-w-md rounded-md border border-input bg-background px-2 text-sm"
              value={selectedCentro}
              onChange={(e) => setSelectedCentro(e.target.value)}
            >
              {centroOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="text-zinc-600 dark:text-zinc-400">
            Editás la configuración de tu planta: <span className="font-mono">{effectiveCentro}</span>
          </p>
        )}

        {loading ? <p className="text-zinc-500">Sincronizando…</p> : null}

        {listCentrosNote ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
            {listCentrosNote}
          </p>
        ) : null}

        <div className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Módulos</p>
          {(
            [
              ["materiales", "Materiales (navegación / catálogo)"] as const,
              ["activos", "Activos"] as const,
              ["ia", "IA (informe y matching de materiales)"] as const,
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={config.modulos[k]}
                onChange={() => toggleModulo(k)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>

        <div className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Especialidades activas</p>
          <p className="text-xs text-zinc-500">Filtros en órdenes de trabajo y opciones al crear OT.</p>
          <div className="flex flex-wrap gap-3">
            {TODAS_ESPECIALIDADES.map((esp) => (
              <label key={esp} className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={config.especialidades_activas.includes(esp)}
                  onChange={() => toggleEspecialidad(esp)}
                />
                <span>
                  {ESP_LABEL[esp]} ({esp})
                </span>
              </label>
            ))}
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={config.requiere_firma_usuario_cierre}
            onChange={() =>
              setConfig((c) => ({
                ...c,
                requiere_firma_usuario_cierre: !c.requiere_firma_usuario_cierre,
              }))
            }
          />
          <span>Requerir firma del usuario de planta al cerrar OT (modo pad)</span>
        </label>

        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={config.auto_publicar_propuesta}
            onChange={() =>
              setConfig((c) => ({
                ...c,
                auto_publicar_propuesta: !c.auto_publicar_propuesta,
              }))
            }
          />
          <span>
            Publicar automáticamente la propuesta del motor tras 48&nbsp;h sin revisión (piloto). También aplica si no
            hay supervisores/admin en el centro. Requiere <span className="font-mono">CRON_AUTOPUBLISH_ACTOR_UID</span>{" "}
            o un superadmin activo.
          </span>
        </label>

        {errorMsg ? <p className="text-sm text-red-600 dark:text-red-400">{errorMsg}</p> : null}
        {successMsg ? <p className="text-sm text-emerald-700 dark:text-emerald-400">{successMsg}</p> : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void guardar()} disabled={saving || loading}>
            {saving ? "Guardando…" : "Guardar en Firestore"}
          </Button>
        </div>

        <div className="rounded-md bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-900/50 dark:text-zinc-400">
          <p className="font-medium text-foreground">Export CSV masivo (API autenticada)</p>
          <p className="mt-1 break-all font-mono">{exportHint}</p>
          <p className="mt-1">
            Añadí <span className="font-mono">&especialidad=AA</span> si querés filtrar. Usá{" "}
            <span className="font-mono">Authorization: Bearer &lt;idToken&gt;</span> como en el PDF.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
