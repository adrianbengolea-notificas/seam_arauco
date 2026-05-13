"use client";

import { createWorkOrder } from "@/app/actions/work-orders";
import { TecnicoSelectParaOt } from "@/modules/work-orders/components/TecnicoSelectParaOt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getFirebaseDb } from "@/firebase/firebaseClient";
import { DEFAULT_CENTRO, KNOWN_CENTROS } from "@/lib/config/app-config";
import { useCentroConfigLive } from "@/modules/centros/hooks";
import type { Aviso } from "@/modules/notices/types";
import type { Especialidad } from "@/modules/notices/types";
import { useAssetLive, useAssetsLive } from "@/modules/assets/hooks";
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
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

const ESP_OPTS: { value: Especialidad; label: string }[] = [
  { value: "AA", label: "Aire (AA)" },
  { value: "ELECTRICO", label: "Eléctrico" },
  { value: "GG", label: "GG" },
  { value: "HG", label: "HG" },
];

const SUB_OPTS: { value: WorkOrderSubTipo; label: string }[] = [
  { value: "preventivo", label: "Preventivo" },
  { value: "correctivo", label: "Correctivo" },
  { value: "checklist", label: "Checklist / Service" },
];

export function NuevaOtClient({ initialAvisoParam }: { initialAvisoParam?: string }) {
  const { profile } = useAuth();
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
  const { assets, loading: assetsLoading, error: assetsError } = useAssetsLive(2500, { centro });

  const [avisoId, setAvisoId] = useState("");
  const [avisoNumeroDispl, setAvisoNumeroDispl] = useState("");
  const [especialidad, setEspecialidad] = useState<Especialidad>("AA");

  useEffect(() => {
    if (!espOpts.some((o) => o.value === especialidad) && espOpts[0]) {
      setEspecialidad(espOpts[0].value);
    }
  }, [espOpts, especialidad]);
  const [subTipo, setSubTipo] = useState<WorkOrderSubTipo>("preventivo");
  const [assetId, setAssetId] = useState("");
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
      setAvisoHits([]);
    },
    [esSuperadmin],
  );

  const unlinkAviso = useCallback(() => {
    setAvisoId("");
    setAvisoNumeroDispl("");
    setAvisoQuery("");
    setAvisoHits([]);
    setNotas("");
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
        let filtered: Aviso[] = [];
        if (/^\d+$/.test(trimmed) && trimmed.length >= 5) {
          const qNum = query(collection(db, "avisos"), where("n_aviso", "==", trimmed), limit(8));
          const snap = await getDocs(qNum);
          if (cancelled) return;
          const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Aviso, "id">) }));
          filtered = all.filter((x) => (x.centro ?? "").trim() === centro.trim());
        } else {
          const q = query(collection(db, "avisos"), where("centro", "==", centro), limit(40));
          const snap = await getDocs(q);
          if (cancelled) return;
          const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Aviso, "id">) }));
          const needle = trimmed.toLowerCase();
          filtered = all
            .filter(
              (x) =>
                x.n_aviso.toLowerCase().includes(needle) ||
                (x.texto_corto ?? "").toLowerCase().includes(needle),
            )
            .slice(0, 12);
        }
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
  }, [avisoQuery, centro, applyAviso]);

  const { asset: assetDocPorId, loading: assetDocLoading } = useAssetLive(assetId.trim() || undefined);

  const assetOptions = useMemo(() => {
    const c = centro.trim();
    let rows = assets.filter((a) => (a.centro ?? "").trim() === c);
    const aid = assetId.trim();
    if (aid && assetDocPorId?.id === aid && !rows.some((r) => r.id === aid)) {
      rows = [...rows, assetDocPorId];
    }
    return [...rows].sort((a, b) =>
      (a.codigo_nuevo ?? "").localeCompare(b.codigo_nuevo ?? "", "es", { numeric: true }),
    );
  }, [assets, assetId, assetDocPorId, centro]);

  const selectedAsset = useMemo(
    () => assetOptions.find((a) => a.id === assetId),
    [assetOptions, assetId],
  );

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
      const token = await getClientIdToken();
      if (!token) {
        setMsg("Iniciá sesión.");
        return;
      }
      if (!assetId) {
        setMsg("Seleccioná un equipo / activo.");
        return;
      }
      if (conflictoActivoCentro) {
        setMsg(
          `Este equipo en base pertenece al centro ${conflictoActivoCentro}, no a ${centro.trim()}. Cambiá el centro del formulario (arriba) al del activo o corregí el activo en maestros.`,
        );
        return;
      }
      if (assetDocLoading && avisoId) {
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
      const res = await createWorkOrder(token, {
        centro,
        asset_id: assetId,
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
      });
      if (!res.ok) {
        setMsg(res.error.message);
        return;
      }
      window.location.href = `/tareas/${res.data.id}`;
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 px-1 py-8 pb-24">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nueva orden de servicio</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Alta manual o vinculada a un aviso
          {esSuperadmin ? null : <> · centro <span className="font-mono font-medium">{centro}</span></>}.{" "}
          <strong>Preventivo</strong>: obligatorio vincular un aviso (buscador) o informar número de aviso.{" "}
          <strong>Correctivo</strong> provisional: podés omitir el aviso si SAP aún no generó número; completá equipo y descripción.
        </p>
      </div>

      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        {esSuperadmin ? (
          <div className="space-y-1">
            <label className="text-sm font-medium">Centro</label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={centro}
              onChange={(e) => {
                setCentroSeleccionado(e.target.value);
              }}
            >
              {KNOWN_CENTROS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="space-y-1">
          <label className="text-sm font-medium">Aviso (búsqueda)</label>
          <Input
            value={avisoQuery}
            onChange={(e) => {
              const v = e.target.value;
              setAvisoQuery(v);
              if (avisoId && v.trim() !== avisoNumeroDispl.trim()) {
                setAvisoId("");
                setAvisoNumeroDispl("");
                setAvisoHits([]);
              }
            }}
            placeholder="Nº aviso o texto…"
            autoComplete="off"
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
                    <span className="ml-2 text-muted-foreground">
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
              ? `Vinculado: ${avisoNumeroDispl || avisoId}`
              : "Sin aviso vinculado — tocá un resultado de la lista o ingresá el número SAP completo (se vincula solo al coincidir)."}
          </p>
        </div>

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
            Es el texto que quedará como descripción en la orden de servicio (informe inicial).
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
              onChange={(e) => setSubTipo(e.target.value as WorkOrderSubTipo)}
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
          <label className="text-sm font-medium">Equipo (activo)</label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={assetId}
            disabled={assetsLoading && !assetOptions.length && !assetId}
            onChange={(e) => setAssetId(e.target.value)}
          >
            <option value="">Seleccionar…</option>
            {assetOptions.map((ast) => (
              <option key={ast.id} value={ast.id}>
                {ast.codigo_nuevo} · {ast.denominacion.slice(0, 48)}
              </option>
            ))}
          </select>
          {assetsLoading ? (
            <p className="text-xs text-muted-foreground">Cargando equipos del centro {centro.trim()}…</p>
          ) : null}
          {assetsError ? (
            <p className="text-xs text-red-600">{assetsError.message}</p>
          ) : null}
          {!assetsLoading && !assetsError && !assetOptions.length ? (
            <p className="text-xs text-amber-800 dark:text-amber-200">
              No hay activos con <span className="font-mono">centro = {centro.trim()}</span> en la base (o el límite de
              consulta no alcanza). Revisá el maestro de activos o el centro del formulario.
            </p>
          ) : null}
          {conflictoActivoCentro ? (
            <p className="text-xs text-amber-800 dark:text-amber-200">
              El activo seleccionado pertenece al centro{" "}
              <span className="font-mono">{conflictoActivoCentro}</span> en base de datos, distinto del centro del
              formulario (<span className="font-mono">{centro.trim()}</span>). Cambiá el centro del formulario a{" "}
              <span className="font-mono">{conflictoActivoCentro}</span> (superadmin) o corregí el activo en maestros.
            </p>
          ) : null}
          {selectedAsset ? (
            <p className="text-xs text-muted-foreground">
              Código: <span className="font-mono">{selectedAsset.codigo_nuevo}</span>
            </p>
          ) : null}
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="nueva-ot-tecnico">
            Técnico asignado <span className="text-muted-foreground font-normal">(opcional)</span>
          </label>
          <TecnicoSelectParaOt
            id="nueva-ot-tecnico"
            centro={centro}
            valueUid={tecnicoUid}
            disabled={busy}
            onValueChange={(uid, nombre) => {
              setTecnicoUid(uid);
              setTecnicoNombre(nombre);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Elegí un técnico del centro o dejá en pool para que cualquier técnico con permiso la vea.
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Fecha programada <span className="text-muted-foreground font-normal">(opcional)</span></label>
          <Input type="date" value={fechaProg} onChange={(e) => setFechaProg(e.target.value)} />
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
          <Button type="submit" disabled={busy || !!conflictoActivoCentro || (assetDocLoading && !!assetId.trim())}>
            {busy ? "Guardando…" : "Crear orden de servicio"}
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link href="/tareas">Cancelar</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
