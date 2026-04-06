"use client";

import { createWorkOrder } from "@/app/actions/work-orders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getFirebaseDb } from "@/firebase/firebaseClient";
import { DEFAULT_CENTRO } from "@/lib/config/app-config";
import { useCentroConfigLive } from "@/modules/centros/hooks";
import type { Aviso } from "@/modules/notices/types";
import type { Especialidad } from "@/modules/notices/types";
import { useAssetsLive } from "@/modules/assets/hooks";
import { getClientIdToken, useAuth } from "@/modules/users/hooks";
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
import { useCallback, useEffect, useMemo, useState } from "react";

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
  const centro = profile?.centro ?? DEFAULT_CENTRO;
  const { config: centroCfg } = useCentroConfigLive(centro);
  const espOpts = useMemo(
    () => ESP_OPTS.filter((o) => centroCfg.especialidades_activas.includes(o.value)),
    [centroCfg.especialidades_activas],
  );
  const { assets } = useAssetsLive(400);

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

  const applyAviso = useCallback((a: Aviso) => {
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
    const t = setTimeout(() => {
      if (avisoQuery.trim().length < 2) {
        setAvisoHits([]);
        return;
      }
      void (async () => {
        const db = getFirebaseDb();
        const q = query(collection(db, "avisos"), where("centro", "==", centro), limit(40));
        const snap = await getDocs(q);
        const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Aviso, "id">) }));
        const needle = avisoQuery.toLowerCase();
        setAvisoHits(
          all.filter(
            (x) =>
              x.n_aviso.toLowerCase().includes(needle) ||
              x.texto_corto.toLowerCase().includes(needle),
          ).slice(0, 12),
        );
      })();
    }, 280);
    return () => clearTimeout(t);
  }, [avisoQuery, centro]);

  const assetOptions = useMemo(() => {
    if (!assets.length) return [];
    return assets;
  }, [assets]);

  const selectedAsset = useMemo(
    () => assetOptions.find((a) => a.id === assetId),
    [assetOptions, assetId],
  );

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
        <h1 className="text-2xl font-semibold tracking-tight">Nueva orden de trabajo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Alta manual o vinculada a un aviso · centro {centro}
        </p>
      </div>

      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        <div className="space-y-1">
          <label className="text-sm font-medium">Aviso (búsqueda)</label>
          <Input
            value={avisoQuery}
            onChange={(e) => setAvisoQuery(e.target.value)}
            placeholder="Nº aviso o texto…"
            autoComplete="off"
          />
          {avisoHits.length ? (
            <ul className="max-h-40 overflow-auto rounded-md border border-border bg-background text-sm shadow-sm">
              {avisoHits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
          onClick={() => applyAviso(hit)}
                  >
                    <span className="font-mono font-semibold">{hit.n_aviso}</span>
                    <span className="ml-2 text-muted-foreground">{hit.texto_corto.slice(0, 60)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Vinculado: {avisoId ? `${avisoNumeroDispl || avisoId}` : "ninguno (solo número de referencia)"}
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Nº aviso (referencia)</label>
          <Input value={avisoNumeroDispl} onChange={(e) => setAvisoNumeroDispl(e.target.value)} />
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

        <div className="space-y-1">
          <label className="text-sm font-medium">Equipo (activo)</label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={assetId}
            onChange={(e) => setAssetId(e.target.value)}
          >
            <option value="">Seleccionar…</option>
            {assetOptions.map((ast) => (
              <option key={ast.id} value={ast.id}>
                {ast.codigo_nuevo} · {ast.denominacion.slice(0, 48)}
              </option>
            ))}
          </select>
          {selectedAsset ? (
            <p className="text-xs text-muted-foreground">
              Código: <span className="font-mono">{selectedAsset.codigo_nuevo}</span>
            </p>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm font-medium">Técnico (nombre)</label>
            <Input value={tecnicoNombre} onChange={(e) => setTecnicoNombre(e.target.value)} placeholder="Opcional" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Técnico UID</label>
            <Input value={tecnicoUid} onChange={(e) => setTecnicoUid(e.target.value)} placeholder="Opcional" />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Fecha programada</label>
          <Input type="date" value={fechaProg} onChange={(e) => setFechaProg(e.target.value)} />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Frecuencia badge (preventivo)</label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={frecBadge}
            onChange={(e) => setFrecBadge(e.target.value as "M" | "T" | "S" | "A" | "")}
          >
            <option value="">—</option>
            <option value="M">Mensual (M)</option>
            <option value="T">Trimestral (T)</option>
            <option value="S">Semestral (S)</option>
            <option value="A">Anual (A)</option>
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Ubicación técnica</label>
          <Input value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Denominación ubicación</label>
          <Input value={denomUbic} onChange={(e) => setDenomUbic(e.target.value)} />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Notas / trabajo</label>
          <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={4} />
        </div>

        {msg ? <p className="text-sm text-red-600">{msg}</p> : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Guardando…" : "Crear OT"}
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link href="/tareas">Cancelar</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
