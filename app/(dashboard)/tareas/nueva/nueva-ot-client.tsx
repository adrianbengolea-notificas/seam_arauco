"use client";

import { createWorkOrder } from "@/app/actions/work-orders";
import { TecnicoSelectParaOt } from "@/modules/work-orders/components/TecnicoSelectParaOt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getFirebaseDb } from "@/firebase/firebaseClient";
import { DEFAULT_CENTRO, KNOWN_CENTROS, nombreCentro } from "@/lib/config/app-config";
import { useCentroConfigLive } from "@/modules/centros/hooks";
import type { Aviso, Especialidad, FrecuenciaMantenimiento } from "@/modules/notices/types";
import { ETIQUETA_ESPECIALIDAD_DOMINIO } from "@/modules/scheduling/especialidad-programa";
import { useAssetLive, useAssetsLive } from "@/modules/assets/hooks";
import type { Asset } from "@/modules/assets/types";
import { getClientIdToken, useAuth } from "@/modules/users/hooks";
import { toPermisoRol } from "@/lib/permisos/index";
import type { WorkOrderSubTipo } from "@/modules/work-orders/types";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { getIsoWeekId } from "@/modules/scheduling/iso-week";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Badge M/T/S/A para el formulario: solo si el aviso lo trae o la frecuencia lo permite (evita “M” por defecto en UNICA, etc.). */
function frecuenciaPlanMtsaDesdeAviso(a: Aviso): "M" | "T" | "S" | "A" | "" {
  if (a.frecuencia_plan_mtsa) return a.frecuencia_plan_mtsa;
  const map: Partial<Record<FrecuenciaMantenimiento, "M" | "T" | "S" | "A">> = {
    MENSUAL: "M",
    TRIMESTRAL: "T",
    SEMESTRAL: "S",
    ANUAL: "A",
  };
  return map[a.frecuencia] ?? "";
}

async function fetchAvisoByIdOrNumero(db: ReturnType<typeof getFirebaseDb>, param: string): Promise<Aviso | null> {
  const trimmed = param.trim();
  if (!trimmed) return null;
  const byId = await getDoc(doc(db, "avisos", trimmed));
  if (byId.exists()) {
    return { id: byId.id, ...(byId.data() as Omit<Aviso, "id">) };
  }
  const q = query(collection(db, "avisos"), where("n_aviso", "==", trimmed), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0]!;
  return { id: d.id, ...(d.data() as Omit<Aviso, "id">) };
}

/** Búsqueda de avisos: por número SAP (global) o por texto (por planta si el usuario no es superadmin). */
async function searchAvisosParaOt(
  db: ReturnType<typeof getFirebaseDb>,
  trimmed: string,
  opts: { esSuperadmin: boolean; centroPerfil: string },
): Promise<Aviso[]> {
  const centroFiltro = opts.esSuperadmin ? "" : opts.centroPerfil.trim();

  if (/^\d+$/.test(trimmed)) {
    if (trimmed.length < 2) return [];
    let rows: Aviso[] = [];
    if (trimmed.length >= 5) {
      const snap = await getDocs(
        query(collection(db, "avisos"), where("n_aviso", "==", trimmed), limit(12)),
      );
      rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Aviso, "id">) }));
    } else {
      const snap = await getDocs(
        query(
          collection(db, "avisos"),
          where("n_aviso", ">=", trimmed),
          where("n_aviso", "<=", trimmed + "\uf8ff"),
          limit(15),
        ),
      );
      rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Aviso, "id">) }));
    }
    if (centroFiltro) {
      rows = rows.filter((x) => (x.centro ?? "").trim() === centroFiltro);
    }
    return rows.slice(0, 12);
  }

  const needle = trimmed.toLowerCase();
  const centrosToSearch = centroFiltro ? [centroFiltro] : [...KNOWN_CENTROS];
  const batches = await Promise.all(
    centrosToSearch.map((c) =>
      getDocs(query(collection(db, "avisos"), where("centro", "==", c), limit(40))),
    ),
  );
  const merged: Aviso[] = [];
  for (const snap of batches) {
    for (const d of snap.docs) {
      merged.push({ id: d.id, ...(d.data() as Omit<Aviso, "id">) });
    }
  }
  return merged
    .filter(
      (x) =>
        x.n_aviso.toLowerCase().includes(needle) ||
        (x.texto_corto ?? "").toLowerCase().includes(needle),
    )
    .slice(0, 12);
}

function filterAssetsLocal(assets: Asset[], needle: string, max = 15): Asset[] {
  const n = needle.trim().toLowerCase();
  if (!n.length) return assets.slice(0, max);
  return assets
    .filter(
      (a) =>
        (a.codigo_nuevo ?? "").toLowerCase().includes(n) ||
        (a.codigo_legacy ?? "").toLowerCase().includes(n) ||
        (a.denominacion ?? "").toLowerCase().includes(n),
    )
    .slice(0, max);
}

async function fetchAssetByCodigoExact(
  db: ReturnType<typeof getFirebaseDb>,
  codigo: string,
  centro: string,
): Promise<Asset | null> {
  const trimmed = codigo.trim();
  if (!trimmed) return null;
  const c = centro.trim();
  const q = c.length
    ? query(collection(db, "assets"), where("centro", "==", c), where("codigo_nuevo", "==", trimmed), limit(1))
    : query(collection(db, "assets"), where("codigo_nuevo", "==", trimmed), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0]!;
  return { id: d.id, ...(d.data() as Omit<Asset, "id">) };
}

const ESP_OPTS: { value: Especialidad; label: string }[] = (
  ["AA", "ELECTRICO", "GG", "HG"] as const
).map((value) => ({ value, label: ETIQUETA_ESPECIALIDAD_DOMINIO[value] }));

const SUB_OPTS: { value: WorkOrderSubTipo; label: string }[] = [
  { value: "preventivo", label: "Preventivo" },
  { value: "correctivo", label: "Correctivo" },
  { value: "checklist", label: "Checklist / Service" },
];

/** Valor interno del selector cuando el equipo no está en catálogo (solo correctivos). No se persiste como `asset_id`. */
const ASSET_OTRO_FUERA_CATALOGO = "__otro_fuera_catalogo__";

export function NuevaOtClient({ initialAvisoParam }: { initialAvisoParam?: string }) {
  const { profile } = useAuth();
  const router = useRouter();
  const esClienteArauco = toPermisoRol(profile?.rol) === "cliente_arauco";
  const esSuperadmin = toPermisoRol(profile?.rol) === "superadmin";
  const profileCentro = (profile?.centro ?? DEFAULT_CENTRO).trim() || DEFAULT_CENTRO;
  // Superadmin puede elegir el centro; el resto usa siempre su centro asignado
  const [centroSeleccionado, setCentroSeleccionado] = useState<string>("");
  // Una vez que el perfil carga, inicializar con el centro del perfil (solo la primera vez)
  const centro = centroSeleccionado || profileCentro;
  const { config: centroCfg } = useCentroConfigLive(centro);
  const espOpts = useMemo(
    () => ESP_OPTS.filter((o) => centroCfg.especialidades_activas.includes(o.value)),
    [centroCfg.especialidades_activas],
  );
  const [especialidad, setEspecialidad] = useState<Especialidad>("AA");

  useEffect(() => {
    if (!espOpts.some((o) => o.value === especialidad) && espOpts[0]) {
      setEspecialidad(espOpts[0].value);
    }
  }, [espOpts, especialidad]);

  const { assets, loading: assetsLoading, error: assetsError } = useAssetsLive(2500, {
    centro,
    especialidad,
  });

  const [avisoId, setAvisoId] = useState("");
  const [avisoNumeroDispl, setAvisoNumeroDispl] = useState("");
  const [subTipo, setSubTipo] = useState<WorkOrderSubTipo>("preventivo");
  const [assetId, setAssetId] = useState("");
  /** Descripción cuando el equipo no existe en Activos (solo correctivos). */
  const [activoManualDescripcion, setActivoManualDescripcion] = useState("");

  useEffect(() => {
    if (subTipo !== "correctivo") {
      if (assetId === ASSET_OTRO_FUERA_CATALOGO) setAssetId("");
      setActivoManualDescripcion("");
    }
  }, [subTipo, assetId]);

  const [tecnicoNombre, setTecnicoNombre] = useState("");
  const [tecnicoUid, setTecnicoUid] = useState("");
  const [fechaProg, setFechaProg] = useState("");
  const [notas, setNotas] = useState("");
  const [ubicacion, setUbicacion] = useState("");
  const [denomUbic, setDenomUbic] = useState("");
  const [frecBadge, setFrecBadge] = useState<"M" | "T" | "S" | "A" | "">("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [avisoQuery, setAvisoQuery] = useState("");
  const [avisoHits, setAvisoHits] = useState<Aviso[]>([]);
  const avisoIdRef = useRef("");
  useEffect(() => {
    avisoIdRef.current = avisoId;
  }, [avisoId]);

  const [assetQuery, setAssetQuery] = useState("");
  const [assetHits, setAssetHits] = useState<Asset[]>([]);
  const assetIdRef = useRef("");
  useEffect(() => {
    assetIdRef.current = assetId;
  }, [assetId]);

  const applyAviso = useCallback(
    (a: Aviso) => {
      if (esSuperadmin) {
        const ac = (a.centro ?? "").trim();
        if (ac) setCentroSeleccionado(ac);
      }
      setAvisoId(a.id);
      setAvisoNumeroDispl(a.n_aviso);
      setAvisoQuery(a.n_aviso);
      setNotas(a.texto_corto ?? "");
      setUbicacion(a.ubicacion_tecnica ?? "");
      setEspecialidad(a.especialidad);
      if (a.tipo === "CORRECTIVO" || a.tipo === "EMERGENCIA") setSubTipo("correctivo");
      else if (a.especialidad === "GG") setSubTipo("checklist");
      else setSubTipo("preventivo");
      setAssetId(a.asset_id);
      setActivoManualDescripcion("");
      setFrecBadge(frecuenciaPlanMtsaDesdeAviso(a));
      setAvisoHits([]);
      const fp = a.fecha_programada;
      if (fp != null && typeof (fp as { toDate?: () => Date }).toDate === "function") {
        const d = (fp as { toDate: () => Date }).toDate();
        if (!Number.isNaN(d.getTime())) {
          setFechaProg(format(d, "yyyy-MM-dd"));
        }
      }
    },
    [esSuperadmin],
  );

  const unlinkAviso = useCallback(() => {
    setAvisoId("");
    setAvisoNumeroDispl("");
    setAvisoQuery("");
    setAvisoHits([]);
    setNotas("");
    setFrecBadge("");
  }, []);

  const applyAsset = useCallback((a: Asset) => {
    setAssetId(a.id);
    setAssetQuery(a.codigo_nuevo ?? "");
    setActivoManualDescripcion("");
    setAssetHits([]);
  }, []);

  const selectOtroFueraCatalogo = useCallback(() => {
    setAssetId(ASSET_OTRO_FUERA_CATALOGO);
    setAssetQuery("");
    setAssetHits([]);
  }, []);

  const unlinkAsset = useCallback(() => {
    setAssetId("");
    setAssetQuery("");
    setAssetHits([]);
    setActivoManualDescripcion("");
  }, []);

  useEffect(() => {
    if (!initialAvisoParam) return;
    let cancelled = false;
    void (async () => {
      const db = getFirebaseDb();
      const av = await fetchAvisoByIdOrNumero(db, initialAvisoParam);
      if (!cancelled && av) applyAviso(av);
      else if (!cancelled) {
        setAvisoQuery(initialAvisoParam);
        setAvisoNumeroDispl(initialAvisoParam);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialAvisoParam, applyAviso]);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      const trimmed = avisoQuery.trim();
      if (trimmed.length < 2) {
        setAvisoHits([]);
        return;
      }
      void (async () => {
        const db = getFirebaseDb();
        const filtered = await searchAvisosParaOt(db, trimmed, {
          esSuperadmin,
          centroPerfil: profileCentro,
        });
        if (cancelled) return;
        setAvisoHits(filtered);
        const exact = filtered.find((h) => h.n_aviso === trimmed);
        if (exact && exact.n_aviso === trimmed && !avisoIdRef.current) {
          applyAviso(exact);
        }
      })();
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [avisoQuery, esSuperadmin, profileCentro, applyAviso]);

  const { asset: assetDocPorId, loading: assetDocLoading } = useAssetLive(
    assetId.trim() && assetId !== ASSET_OTRO_FUERA_CATALOGO ? assetId.trim() : undefined,
  );

  const assetOptions = useMemo(() => {
    const c = centro.trim();
    let rows = assets.filter((a) => (a.centro ?? "").trim() === c);
    const aid = assetId.trim();
    if (aid && assetDocPorId?.id === aid && !rows.some((r) => r.id === aid)) {
      const pred = assetDocPorId.especialidad_predeterminada;
      const encajaEsp = !pred || pred === especialidad;
      if (encajaEsp) rows = [...rows, assetDocPorId];
    }
    return [...rows].sort((a, b) =>
      (a.codigo_nuevo ?? "").localeCompare(b.codigo_nuevo ?? "", "es", { numeric: true }),
    );
  }, [assets, assetId, assetDocPorId, centro, especialidad]);

  const selectedAsset = useMemo(
    () => assetOptions.find((a) => a.id === assetId),
    [assetOptions, assetId],
  );

  useEffect(() => {
    if (!assetId || assetId === ASSET_OTRO_FUERA_CATALOGO) return;
    const codigo = selectedAsset?.codigo_nuevo ?? assetDocPorId?.codigo_nuevo;
    if (codigo) setAssetQuery(codigo);
  }, [assetId, selectedAsset?.codigo_nuevo, assetDocPorId?.codigo_nuevo]);

  useEffect(() => {
    if (assetId && assetId !== ASSET_OTRO_FUERA_CATALOGO) {
      setAssetHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      const trimmed = assetQuery.trim();
      if (trimmed.length < 1) {
        setAssetHits([]);
        return;
      }
      void (async () => {
        let hits = filterAssetsLocal(assetOptions, trimmed);
        const exactLocal = hits.find((a) => (a.codigo_nuevo ?? "").toLowerCase() === trimmed.toLowerCase());
        if (!exactLocal && trimmed.length >= 2) {
          const db = getFirebaseDb();
          const remote = await fetchAssetByCodigoExact(db, trimmed, centro);
          if (remote && !hits.some((h) => h.id === remote.id)) {
            hits = [remote, ...hits].slice(0, 15);
          }
          if (remote && !cancelled && !assetIdRef.current) {
            applyAsset(remote);
            return;
          }
        }
        if (cancelled) return;
        setAssetHits(hits);
        const exact = hits.find((a) => (a.codigo_nuevo ?? "").toLowerCase() === trimmed.toLowerCase());
        if (exact && !assetIdRef.current) {
          applyAsset(exact);
        }
      })();
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [assetQuery, assetOptions, centro, assetId, applyAsset]);

  const conflictoActivoCentro = useMemo(() => {
    if (!assetId.trim() || !assetDocPorId || assetDocPorId.id !== assetId) return null;
    const ac = (assetDocPorId.centro ?? "").trim();
    if (!ac || ac === centro.trim()) return null;
    return ac;
  }, [assetId, assetDocPorId, centro]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      if (subTipo === "correctivo" && assetId === ASSET_OTRO_FUERA_CATALOGO) {
        const desc = activoManualDescripcion.trim();
        if (desc.length < 3) {
          setMsg("Describí el equipo o lugar donde trabajás (al menos 3 caracteres).");
          return;
        }
      }
      const token = await getClientIdToken();
      if (!token) {
        setMsg("Iniciá sesión.");
        return;
      }
      const esOtroCorrectivo = subTipo === "correctivo" && assetId === ASSET_OTRO_FUERA_CATALOGO;
      if (
        !esOtroCorrectivo &&
        !assetId &&
        especialidad !== "ELECTRICO" &&
        especialidad !== "HG"
      ) {
        setMsg("Seleccioná un equipo / activo.");
        return;
      }
      if (conflictoActivoCentro) {
        setMsg(
          esSuperadmin
            ? `Este equipo en base pertenece al centro ${conflictoActivoCentro}, no a ${centro.trim()}. Usá el selector Centro (arriba) para alinearlo con el activo o corregí el maestro del equipo.`
            : `Este equipo en base pertenece al centro ${conflictoActivoCentro}, no a ${centro.trim()}. Corregí el activo o el aviso en maestros; con tu perfil no podés cambiar de planta en este formulario.`,
        );
        return;
      }
      if (assetDocLoading && avisoId && assetId.trim() && assetId !== ASSET_OTRO_FUERA_CATALOGO) {
        setMsg("Esperá a que cargue el dato del equipo vinculado al aviso…");
        return;
      }
      if (
        subTipo === "preventivo" &&
        !avisoId.trim() &&
        !avisoNumeroDispl.trim()
      ) {
        setMsg("Preventivo: vinculá un aviso desde el buscador o ingresá el número de aviso.");
        return;
      }
      if (subTipo === "correctivo" && !fechaProg.trim()) {
        setMsg("Indicá la fecha de realización para ubicar el correctivo en el programa semanal.");
        return;
      }
      if (!tecnicoUid.trim()) {
        setMsg("Seleccioná un técnico de la planta antes de crear la orden.");
        return;
      }
      const res = await createWorkOrder(token, {
        centro,
        asset_id: esOtroCorrectivo ? "" : assetId.trim(),
        especialidad,
        sub_tipo: subTipo,
        texto_trabajo: notas.trim() || "—",
        aviso_id: avisoId || undefined,
        aviso_numero: avisoNumeroDispl || undefined,
        fecha_inicio_programada: fechaProg.trim() ? fechaProg : null,
        tecnico_asignado_nombre: tecnicoNombre.trim() || undefined,
        tecnico_asignado_uid: tecnicoUid.trim() || undefined,
        frecuencia_plan_mtsa: frecBadge || undefined,
        ubicacion_tecnica: ubicacion.trim() || undefined,
        denom_ubic_tecnica: denomUbic.trim() || undefined,
        activo_fuera_catalogo: esOtroCorrectivo ? true : undefined,
        activo_manual_descripcion: esOtroCorrectivo ? activoManualDescripcion.trim() : undefined,
      });
      if (!res.ok) {
        setMsg(res.error.message);
        return;
      }
      if (subTipo === "correctivo" && fechaProg.trim()) {
        const d = new Date(`${fechaProg.trim()}T12:00:00`);
        const p = new URLSearchParams();
        p.set("centro", centro.trim());
        p.set("semana", getIsoWeekId(d));
        window.location.href = `/programa?${p.toString()}`;
        return;
      }
      window.location.href = `/tareas/${res.data.id}`;
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (esClienteArauco) router.replace("/cliente");
  }, [esClienteArauco, router]);

  if (esClienteArauco) {
    return <p className="mx-auto max-w-lg px-1 py-8 text-sm text-muted-foreground">Redirigiendo al panel…</p>;
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 px-1 py-8 pb-24">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nueva orden de trabajo (OT)</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Alta manual o vinculada a un aviso
          {esSuperadmin ? null : (
            <> · planta <span className="font-medium">{nombreCentro(centro)}</span></>
          )}
          .{" "}
          <strong>Preventivo</strong>: empezá por el número de aviso; al vincularlo se completa la planta y el resto.{" "}
          Elegí <strong className="text-foreground">un activo del listado</strong> (buscá por código o nombre).{" "}
          <strong>Correctivo</strong>: si el equipo no está cargado como activo, elegí «Otro (fuera del listado)» y describilo;
          provisional: podés omitir aviso SAP si corresponde; completá equipo y descripción.
        </p>
      </div>

      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        <div className="space-y-1">
          <label className="text-sm font-medium">Nº de aviso</label>
          <Input
            value={avisoQuery}
            onChange={(e) => {
              const v = e.target.value;
              setAvisoQuery(v);
              if (avisoId && v.trim() !== avisoNumeroDispl.trim()) {
                setAvisoId("");
                setAvisoNumeroDispl("");
                setAvisoHits([]);
                setFrecBadge("");
              }
            }}
            placeholder="Ej: 100123456 — filtra mientras escribís"
            autoComplete="off"
            autoFocus
          />
          {avisoId ? (
            <div className="rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-sm shadow-sm">
              <p className="leading-snug">
                <span className="font-mono font-semibold">{avisoNumeroDispl || avisoId}</span>
                {notas.trim() ? <span className="text-foreground"> {notas}</span> : null}
              </p>
              <button
                type="button"
                className="mt-2 cursor-pointer text-left text-xs font-medium text-brand underline underline-offset-2 hover:opacity-90"
                onClick={unlinkAviso}
              >
                Cambiar aviso
              </button>
            </div>
          ) : avisoHits.length ? (
            <ul
              className="max-h-48 overflow-auto rounded-lg border border-border bg-muted/40 text-sm shadow-sm"
              role="listbox"
              aria-label="Resultados de aviso"
            >
              {avisoHits.map((hit) => (
                <li key={hit.id} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    className="min-h-11 w-full cursor-pointer touch-manipulation px-3 py-2.5 text-left hover:bg-zinc-100/90 active:bg-zinc-200/80 dark:hover:bg-zinc-800/90 dark:active:bg-zinc-700/80"
                    onClick={() => applyAviso(hit)}
                  >
                    <span className="font-mono font-semibold">{hit.n_aviso}</span>
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                      {nombreCentro(hit.centro ?? "")}
                    </span>
                    <span className="mt-0.5 block text-muted-foreground sm:mt-0 sm:ml-2 sm:inline">
                      {(hit.texto_corto ?? "").slice(0, 72)}
                      {(hit.texto_corto ?? "").length > 72 ? "…" : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {avisoId
              ? `Vinculado: ${avisoNumeroDispl || avisoId} · planta ${nombreCentro(centro)}`
              : "Escribí el número SAP (mín. 2 dígitos) o texto del aviso; al coincidir exacto se vincula solo. La planta se define al elegir el aviso."}
          </p>
        </div>

        {esSuperadmin ? (
          <div className="space-y-1">
            <label className="text-sm font-medium">Centro (planta)</label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={centro}
              onChange={(e) => {
                setCentroSeleccionado(e.target.value);
              }}
            >
              {KNOWN_CENTROS.map((c) => (
                <option key={c} value={c}>
                  {nombreCentro(c)}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              {avisoId
                ? "Completado desde el aviso vinculado; podés cambiarlo si hace falta."
                : "Si aún no hay aviso, elegí la planta manualmente; al vincular un aviso se actualiza sola."}
            </p>
          </div>
        ) : null}

        {/* Número de aviso: se llena automáticamente al elegir un aviso del buscador.
            Solo mostrar como campo editable si no hay aviso vinculado (referencia manual). */}
        {!avisoId ? (
          <div className="space-y-1">
            <label className="text-sm font-medium">Nº aviso <span className="text-muted-foreground font-normal">(referencia manual, opcional)</span></label>
            <Input value={avisoNumeroDispl} onChange={(e) => setAvisoNumeroDispl(e.target.value)} placeholder="Ej: 100123456" />
          </div>
        ) : null}

        <div className="space-y-1">
          <label className="text-sm font-medium">Nombre del servicio / descripción</label>
          <Textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            rows={4}
            placeholder="Al vincular un aviso se copia el texto del aviso; podés editarlo antes de crear la orden."
            className="resize-y"
          />
          <p className="text-xs text-muted-foreground">
            Es el texto que quedará como descripción en la OT (informe inicial).
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm font-medium">Especialidad</label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={especialidad}
              onChange={(e) => setEspecialidad(e.target.value as Especialidad)}
            >
              {espOpts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Tipo</label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={subTipo}
              onChange={(e) => {
                const v = e.target.value as WorkOrderSubTipo;
                setSubTipo(v);
              }}
            >
              {SUB_OPTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {subTipo === "preventivo" && !avisoId.trim() && !avisoNumeroDispl.trim() ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100">
            Para <strong>preventivo</strong> necesitás un aviso vinculado o el número de aviso (referencia SAP / plan).
          </p>
        ) : null}

        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="nueva-ot-equipo">
            Equipo (activo)
          </label>
          {assetId && assetId !== ASSET_OTRO_FUERA_CATALOGO && (selectedAsset || assetDocPorId) ? (
            <div className="rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-sm shadow-sm">
              <p className="leading-snug">
                <span className="font-mono font-semibold">
                  {(selectedAsset ?? assetDocPorId)?.codigo_nuevo ?? assetId}
                </span>
                {(selectedAsset ?? assetDocPorId)?.denominacion?.trim() ? (
                  <span className="text-foreground">
                    {" "}
                    {(selectedAsset ?? assetDocPorId)!.denominacion.slice(0, 72)}
                    {(selectedAsset ?? assetDocPorId)!.denominacion.length > 72 ? "…" : ""}
                  </span>
                ) : null}
              </p>
              <button
                type="button"
                className="mt-2 cursor-pointer text-left text-xs font-medium text-brand underline underline-offset-2 hover:opacity-90"
                onClick={unlinkAsset}
              >
                Cambiar equipo
              </button>
            </div>
          ) : assetId === ASSET_OTRO_FUERA_CATALOGO ? (
            <div className="rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-sm shadow-sm">
              <p className="leading-snug text-muted-foreground">Otro — fuera del listado (descripción manual)</p>
              <button
                type="button"
                className="mt-2 cursor-pointer text-left text-xs font-medium text-brand underline underline-offset-2 hover:opacity-90"
                onClick={unlinkAsset}
              >
                Buscar en el listado de equipos
              </button>
            </div>
          ) : (
            <>
              <Input
                id="nueva-ot-equipo"
                value={assetQuery}
                onChange={(e) => {
                  const v = e.target.value;
                  setAssetQuery(v);
                  if (assetId && v.trim() !== (selectedAsset?.codigo_nuevo ?? "").trim()) {
                    setAssetId("");
                    setAssetHits([]);
                  }
                }}
                placeholder="Código del equipo o nombre — ej. EE-001"
                autoComplete="off"
                disabled={assetsLoading && !assetOptions.length}
              />
              {assetHits.length ? (
                <ul
                  className="max-h-48 overflow-auto rounded-lg border border-border bg-muted/40 text-sm shadow-sm"
                  role="listbox"
                  aria-label="Resultados de equipo"
                >
                  {assetHits.map((hit) => (
                    <li key={hit.id} className="border-b border-border last:border-b-0">
                      <button
                        type="button"
                        className="min-h-11 w-full cursor-pointer touch-manipulation px-3 py-2.5 text-left hover:bg-zinc-100/90 active:bg-zinc-200/80 dark:hover:bg-zinc-800/90 dark:active:bg-zinc-700/80"
                        onClick={() => applyAsset(hit)}
                      >
                        <span className="font-mono font-semibold">{hit.codigo_nuevo}</span>
                        <span className="mt-0.5 block text-muted-foreground sm:mt-0 sm:ml-2 sm:inline">
                          {(hit.denominacion ?? "").slice(0, 72)}
                          {(hit.denominacion ?? "").length > 72 ? "…" : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
          {assetsLoading ? (
            <p className="text-xs text-muted-foreground">Cargando equipos de {nombreCentro(centro)}…</p>
          ) : null}
          {assetsError ? (
            <p className="text-xs text-red-600">{assetsError.message}</p>
          ) : null}
          {!assetsLoading && !assetsError && !assetOptions.length && !assetId ? (
            <p className="text-xs text-amber-800 dark:text-amber-200">
              No hay activos en la base para la planta{" "}
              <span className="font-medium">{nombreCentro(centro)}</span>
              {" "}con{" "}
              <span className="font-mono">especialidad predeterminada = {especialidad}</span> (o el límite de consulta no
              alcanza). Revisá el maestro de activos: cada equipo debe tener la especialidad correcta.
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {assetId && assetId !== ASSET_OTRO_FUERA_CATALOGO
              ? `Equipo seleccionado · planta ${nombreCentro(centro)}`
              : assetId === ASSET_OTRO_FUERA_CATALOGO
                ? "Correctivo sin activo en maestro: completá la descripción abajo."
                : "Escribí el código SAP del equipo; al coincidir exacto se selecciona solo. También podés buscar por nombre."}
          </p>
          {conflictoActivoCentro ? (
            <p className="text-xs text-amber-800 dark:text-amber-200">
              El activo seleccionado pertenece a la planta{" "}
              <span className="font-medium">{nombreCentro(conflictoActivoCentro)}</span> en base de datos, distinta de la
              planta del formulario (<span className="font-medium">{nombreCentro(centro)}</span>).
              {esSuperadmin ? (
                <>
                  {" "}
                  Cambiá el selector <strong className="font-medium">Centro</strong> arriba a{" "}
                  <span className="font-medium">{nombreCentro(conflictoActivoCentro)}</span>, o corregí el activo en maestros.
                </>
              ) : (
                <>
                  {" "}
                  Corregí el activo o el vínculo del aviso en maestros; con tu perfil no podés elegir otra planta acá.
                </>
              )}
            </p>
          ) : null}
          {subTipo === "correctivo" && assetId !== ASSET_OTRO_FUERA_CATALOGO ? (
            <button
              type="button"
              className="cursor-pointer text-left text-xs font-medium text-brand underline underline-offset-2 hover:opacity-90"
              onClick={selectOtroFueraCatalogo}
            >
              El equipo no está en el listado — describir manualmente
            </button>
          ) : null}
          {subTipo === "correctivo" && assetId === ASSET_OTRO_FUERA_CATALOGO ? (
            <div className="space-y-1 pt-2">
              <label className="text-sm font-medium" htmlFor="nueva-ot-activo-manual">
                Equipo / lugar (texto libre)
              </label>
              <Textarea
                id="nueva-ot-activo-manual"
                value={activoManualDescripcion}
                onChange={(e) => setActivoManualDescripcion(e.target.value)}
                rows={3}
                placeholder='Ej.: bomba línea norte (aún sin alta en Activos)'
                className="resize-y"
              />
              <p className="text-xs text-muted-foreground">
                Solo para correctivos cuando el equipo no está en maestro. Preventivos y checklist requieren un activo cargado en el sistema.
              </p>
            </div>
          ) : null}
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="nueva-ot-tecnico">
            Técnico asignado <span className="text-destructive font-normal">*</span>
          </label>
          <TecnicoSelectParaOt
            id="nueva-ot-tecnico"
            centro={centro}
            valueUid={tecnicoUid}
            disabled={busy}
            required
            onValueChange={(uid, nombre) => {
              setTecnicoUid(uid);
              setTecnicoNombre(nombre);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Obligatorio: elegí quién ejecuta la tarea para que la orden aparezca en su panel. Puede ser cualquier técnico
            activo de la planta <span className="font-medium text-foreground">{nombreCentro(centro)}</span>.
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">
            Fecha de realización{" "}
            {subTipo === "correctivo" ? (
              <span className="text-destructive font-normal">*</span>
            ) : (
              <span className="text-muted-foreground font-normal">(opcional)</span>
            )}
          </label>
          <Input
            type="date"
            required={subTipo === "correctivo"}
            value={fechaProg}
            onChange={(e) => setFechaProg(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {subTipo === "correctivo"
              ? "Obligatoria: define el día y la semana ISO donde aparece en el programa publicado."
              : "Si la indicás, se usa para ubicar la OT en el calendario semanal."}
          </p>
        </div>

        {subTipo === "preventivo" ? (
          <div className="space-y-1">
            <label className="text-sm font-medium">Frecuencia del plan</label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={frecBadge}
              onChange={(e) => setFrecBadge(e.target.value as "M" | "T" | "S" | "A" | "")}
            >
              <option value="">Sin especificar</option>
              <option value="M">Mensual</option>
              <option value="T">Trimestral</option>
              <option value="S">Semestral</option>
              <option value="A">Anual</option>
            </select>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm font-medium">Ubicación técnica <span className="text-muted-foreground font-normal">(opcional)</span></label>
            <Input value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} placeholder="Ej: TK-100" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Nombre del área / equipo <span className="text-muted-foreground font-normal">(opcional)</span></label>
            <Input value={denomUbic} onChange={(e) => setDenomUbic(e.target.value)} placeholder="Ej: Tanque de almacenamiento norte" />
          </div>
        </div>

        {msg ? <p className="text-sm text-red-600">{msg}</p> : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || !tecnicoUid.trim() || !!conflictoActivoCentro || (assetDocLoading && !!assetId.trim() && assetId !== ASSET_OTRO_FUERA_CATALOGO)}>
            {busy ? "Guardando…" : "Crear orden de trabajo (OT)"}
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link href="/tareas">Cancelar</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
