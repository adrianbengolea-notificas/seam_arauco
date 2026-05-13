"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { DEFAULT_CENTRO, KNOWN_CENTROS, nombreCentro } from "@/lib/config/app-config";
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
import { HelpIconTooltip } from "@/components/ui/help-icon-tooltip";
import { useCallback, useEffect, useState } from "react";

/** Nombre corto; el código (`esp`) se muestra aparte para evitar "AA (AA)". */
const ESP_LABEL: Partial<Record<Especialidad, string>> = {
  AA: "Aire acondicionado",
  ELECTRICO: "Eléctrico",
  GG: "Disciplina GG",
  HG: "Disciplina HG",
};

const MODULO_DEFS: {
  key: "materiales" | "activos" | "ia";
  titulo: string;
  descripcion: string;
}[] = [
  {
    key: "materiales",
    titulo: "Materiales",
    descripcion: "Catálogo, navegación y flujo de repuestos vinculado a este centro.",
  },
  {
    key: "activos",
    titulo: "Activos",
    descripcion: "Listado, fichas y QR de equipos e instalaciones en planta.",
  },
  {
    key: "ia",
    titulo: "Asistencia (informes y materiales)",
    descripcion:
      "Informes y sugerencia o matching de materiales (a veces referido como IA o TA en documentación interna). Si está apagado, esa parte del menú no se ofrece en este centro.",
  },
];

const KNOWN_CENTROS_SET = new Set(KNOWN_CENTROS.map((c) => c.trim()));

/** Texto del <option>: código + nombre si existe; avisa si el ID solo viene de un doc en Firestore. */
function etiquetaCentroEnSelector(codigo: string): string {
  const c = codigo.trim();
  const nombre = nombreCentro(c);
  const base = nombre !== c ? `${c} — ${nombre}` : c;
  if (!KNOWN_CENTROS_SET.has(c)) {
    return `${base} (solo documento en base)`;
  }
  return base;
}

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
      };
      await setDoc(
        ref,
        { ...payload, updated_at: serverTimestamp() } as Record<string, unknown>,
        { merge: true },
      );
      setSuccessMsg("Cambios guardados. Deberían verse en la app en pocos segundos.");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="max-w-2xl border-amber-200/60 dark:border-amber-900/50">
      <CardHeader>
        <CardTitle className="text-base flex items-start gap-2">
          <span className="min-w-0 flex-1 leading-snug">Configuración por planta (centro)</span>
          <HelpIconTooltip ariaLabel="Ayuda: cómo funciona esta pantalla" panelClassName="left-0 right-auto max-w-sm sm:max-w-md">
            <span className="block font-medium">Cómo funciona</span>
            <span className="mt-1.5 block text-zinc-600 dark:text-zinc-400">
              Los datos de cada planta viven en un documento de base de datos:{" "}
              <code className="rounded bg-zinc-100 px-0.5 dark:bg-zinc-800">
                {COLLECTIONS.centros}/{'{códigoCentro}'}
              </code>
              . La pantalla se actualiza sola cuando otro usuario cambia algo; tus propios cambios recién quedan
              fijos cuando tocás <span className="font-medium text-foreground">Guardar cambios</span>.
            </span>
            <ul className="mt-2 list-disc space-y-1.5 pl-4 text-zinc-600 dark:text-zinc-400">
              <li>
                <strong className="font-medium text-zinc-800 dark:text-zinc-200">Módulos</strong>: qué partes del menú
                ve esta planta.
              </li>
              <li>
                <strong className="font-medium text-zinc-800 dark:text-zinc-200">Especialidades</strong>: qué rubros
                podés elegir al crear órdenes. Si quitás todas, la app vuelve a dejar las cuatro.
              </li>
              <li>
                <strong className="font-medium text-zinc-800 dark:text-zinc-200">Firma al cerrar</strong>: en tablet, si
                hace falta que alguien de planta firme además del técnico.
              </li>
            </ul>
            <span className="mt-2 block text-xs text-zinc-500 dark:text-zinc-500">
              Las <strong className="font-medium text-zinc-700 dark:text-zinc-300">propuestas semanales</strong> se
              configuran en la otra pestaña, no acá.
            </span>
            <span className="mt-2 block text-xs text-zinc-500 dark:text-zinc-500">
              El desplegable de planta mezcla los códigos de{" "}
              <span className="font-mono">NEXT_PUBLIC_KNOWN_CENTROS</span> con cada ID que exista como documento en{" "}
              <span className="font-mono">{COLLECTIONS.centros}</span>. Si ves dos filas distintas (p. ej.{" "}
              <span className="font-mono">CENTRO-01</span> y <span className="font-mono">PC01</span>), no es la app
              “repetida”: son dos identificadores distintos; conviene usar uno solo por planta real y borrar o dejar de
              usar el sobrante en la base.
            </span>
          </HelpIconTooltip>
        </CardTitle>
        <CardDescription>
          Comportamiento de la app para <strong className="font-medium text-foreground">una</strong> planta a la vez.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {superAdmin ? (
          <div className="space-y-1.5">
            <div>
              <label htmlFor="centro-editar" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Centro a editar
              </label>
              <p className="text-xs text-zinc-500 dark:text-zinc-500">
                Los cambios de abajo aplican solo a este ID. La lista suma la configuración de la app y los documentos en
                la colección <span className="font-mono">{COLLECTIONS.centros}</span>; códigos distintos son plantas o
                documentos distintos, no un error de duplicado.
              </p>
            </div>
            <select
              id="centro-editar"
              className="flex h-9 w-full max-w-md rounded-md border border-input bg-background px-2 text-sm"
              value={selectedCentro}
              onChange={(e) => setSelectedCentro(e.target.value)}
            >
              {centroOptions.map((c) => (
                <option key={c} value={c}>
                  {etiquetaCentroEnSelector(c)}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="text-zinc-600 dark:text-zinc-400">
            Estás ajustando la planta <span className="font-mono font-medium text-foreground">{effectiveCentro}</span>.
            No afecta a otros centros.
          </p>
        )}

        {loading ? <p className="text-sm text-zinc-500">Cargando configuración desde la base…</p> : null}

        {listCentrosNote ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
            {listCentrosNote}
          </p>
        ) : null}

        <div className="space-y-4 rounded-lg border-2 border-amber-300/70 bg-amber-50/30 p-4 dark:border-amber-800/50 dark:bg-amber-950/20">
          <div className="space-y-1 border-b border-amber-200/80 pb-3 dark:border-amber-900/40">
            <p className="text-sm font-semibold text-amber-950 dark:text-amber-100">Opciones que se guardan con el botón</p>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Marcá lo que quieras y al final pulsá <span className="font-medium text-foreground">Guardar cambios</span>.
              Hasta entonces los cambios son solo en esta pantalla.
            </p>
          </div>

        <div className="space-y-3 rounded-lg border border-zinc-200 bg-background p-3 dark:border-zinc-800">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Funcionalidades visibles</p>
            <p className="mt-0.5 text-xs text-zinc-500">
              Desactivar una casilla oculta esa área en el menú y flujos de este centro; no borra datos ya cargados.
            </p>
          </div>
          {MODULO_DEFS.map(({ key, titulo, descripcion }) => (
            <label
              key={key}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-transparent p-1 hover:border-zinc-200/80 dark:hover:border-zinc-700/80"
            >
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0"
                checked={config.modulos[key]}
                onChange={() => toggleModulo(key)}
              />
              <span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{titulo}</span>
                <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">{descripcion}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Especialidades en OTs</p>
          <p className="text-xs text-zinc-500">
            Controla en qué columnas o filtros aparece cada disciplina y qué podés elegir al crear una OT. Código en{" "}
            <span className="font-mono">mayúsculas</span> es el valor técnico guardado en datos.
          </p>
          <p className="text-xs text-amber-800/90 dark:text-amber-200/90">
            Si desmarcás todas, la app reactiva las cuatro: no se permite dejar al centro sin especialidades.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
            {TODAS_ESPECIALIDADES.map((esp) => (
              <label key={esp} className="flex min-w-[12rem] cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0"
                  checked={config.especialidades_activas.includes(esp)}
                  onChange={() => toggleEspecialidad(esp)}
                />
                <span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">{ESP_LABEL[esp]}</span>
                  <span className="block font-mono text-xs text-zinc-500">{esp}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-zinc-50/80 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/40">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Firma al cerrar la orden (en tablet)
          </p>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            Pad = pantalla táctil (tablet) donde el técnico y, si aplica, planta firman con el dedo o el lápiz.
          </p>
          <label className="mt-2 flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 shrink-0"
              checked={config.requiere_firma_usuario_cierre}
              onChange={() =>
                setConfig((c) => ({ ...c, requiere_firma_usuario_cierre: !c.requiere_firma_usuario_cierre }))
              }
            />
            <span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                Pedir también la firma de alguien de planta (no solo del técnico)
              </span>
              <span className="mt-1 block text-xs text-zinc-600 dark:text-zinc-400">
                <strong className="font-medium text-foreground">Activado</strong>: para cerrar la orden hace falta firma
                del técnico y de un usuario de planta. <strong className="font-medium text-foreground">Desactivado</strong>:
                alcanza con la firma del técnico. Si esta planta todavía no tenía datos guardados, por defecto queda
                activado (pide planta).
              </span>
            </span>
          </label>
        </div>

        {errorMsg ? <p className="text-sm text-red-600 dark:text-red-400">{errorMsg}</p> : null}
        {successMsg ? <p className="text-sm text-emerald-700 dark:text-emerald-400">{successMsg}</p> : null}

        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <Button type="button" onClick={() => void guardar()} disabled={saving || loading}>
              {saving ? "Guardando…" : "Guardar cambios"}
            </Button>
            <p className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-400">
              Esto graba en la base las opciones de arriba para{" "}
              <span className="font-medium text-foreground">{nombreCentro(effectiveCentro)}</span> (módulos,
              especialidades y firma).
            </p>
            <p
              className="mt-0.5 text-[0.7rem] text-zinc-500"
              title={`${COLLECTIONS.centros}/${effectiveCentro}`}
            >
              Documento en Firestore: colección «centros» (identificador técnico en tooltip).
            </p>
          </div>
        </div>
        </div>
      </CardContent>
    </Card>
  );
}
