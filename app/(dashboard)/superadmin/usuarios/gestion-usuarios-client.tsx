"use client";

import {
  actionCreateUser,
  actionListUsers,
  actionSetUserActivo,
  actionUpdateUserCentro,
  actionUpdateUserCentros,
  actionUpdateUserEspecialidades,
  actionUpdateUserRole,
  type UserAdminRow,
} from "@/app/actions/users";
import { RolGuard } from "@/components/auth/RolGuard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DEFAULT_CENTRO, isCentroInKnownList, KNOWN_CENTROS, nombreCentro } from "@/lib/config/app-config";
import { cn } from "@/lib/utils";
import { toPermisoRol } from "@/lib/permisos/index";
import type { Especialidad } from "@/modules/notices/types";
import { getClientIdToken, useAuth } from "@/modules/users/hooks";
import { isSuperAdminRole } from "@/modules/users/roles";
import type { UserRole } from "@/modules/users/types";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type RolAssignable = "tecnico" | "supervisor" | "admin" | "superadmin" | "cliente_arauco";

const ESPECIALIDADES: { id: Especialidad; label: string }[] = [
  { id: "AA", label: "Aire Acondicionado (AA)" },
  { id: "ELECTRICO", label: "Eléctrico" },
  { id: "GG", label: "Grupos Generadores (GG)" },
  { id: "HG", label: "HG" },
];

const selectClass = cn(
  "flex h-10 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm",
  "text-foreground transition-[border-color,box-shadow] duration-150",
  "focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
);

function roleLabel(rol: UserRole): string {
  const r = toPermisoRol(rol);
  switch (r) {
    case "superadmin":
      return "Superadmin";
    case "admin":
      return "Admin";
    case "supervisor":
      return "Supervisor";
    case "cliente_arauco":
      return "Cliente Arauco";
    default:
      return "Técnico";
  }
}

function roleBadgeClass(rol: UserRole): string {
  const r = toPermisoRol(rol);
  if (r === "superadmin") return "bg-violet-600/15 text-violet-800 dark:text-violet-200";
  if (r === "admin") return "bg-amber-600/15 text-amber-900 dark:text-amber-100";
  if (r === "supervisor") return "bg-sky-600/15 text-sky-900 dark:text-sky-100";
  if (r === "cliente_arauco") return "bg-emerald-600/15 text-emerald-900 dark:text-emerald-100";
  return "bg-zinc-500/15 text-zinc-800 dark:text-zinc-200";
}

type GestionUsuariosClientProps = {
  /** Si true, se muestra dentro de Configuración e importación (sin botón Volver ni título principal duplicado). */
  embedded?: boolean;
};

export function GestionUsuariosClient({ embedded = false }: GestionUsuariosClientProps) {
  const { profile, user, loading: authLoading } = useAuth();
  const viewerIsSuper = isSuperAdminRole(profile?.rol);

  const [rows, setRows] = useState<UserAdminRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [editUid, setEditUid] = useState<string | null>(null);
  const [editRol, setEditRol] = useState<RolAssignable>("tecnico");

  const [centroUid, setCentroUid] = useState<string | null>(null);
  const [centroVal, setCentroVal] = useState("");
  const [centroEsTecnico, setCentroEsTecnico] = useState(false);
  const [centrosMultiVal, setCentrosMultiVal] = useState<string[]>([]);

  const [espUid, setEspUid] = useState<string | null>(null);
  const [espVal, setEspVal] = useState<Especialidad[]>([]);

  const reload = useCallback(async () => {
    setLoadingList(true);
    setLoadError(null);
    const token = await getClientIdToken();
    if (!token) {
      setLoadError("No hay sesión");
      setLoadingList(false);
      return;
    }
    const res = await actionListUsers(token);
    if (!res.ok) {
      setLoadError(res.error.message);
      setRows([]);
    } else {
      setRows(res.data);
    }
    setLoadingList(false);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    queueMicrotask(() => {
      if (!user) {
        setLoadingList(false);
        setLoadError("No hay sesión");
        setRows([]);
        return;
      }
      void reload();
    });
  }, [authLoading, user, reload]);

  const assignableRoles: RolAssignable[] = useMemo(() => {
    return viewerIsSuper
      ? ["tecnico", "supervisor", "admin", "superadmin", "cliente_arauco"]
      : ["tecnico", "supervisor", "admin", "cliente_arauco"];
  }, [viewerIsSuper]);

  async function saveRol() {
    if (!editUid) return;
    const rolToSave = editRol;
    setBusy(true);
    setMsg(null);
    const token = await getClientIdToken();
    if (!token) {
      setBusy(false);
      return;
    }
    const res = await actionUpdateUserRole(token, {
      targetUid: editUid,
      rol: rolToSave,
    });
    setBusy(false);
    if (!res.ok) {
      setMsg(res.error.message);
      return;
    }
    setEditUid(null);
    void reload();
  }

  async function saveCentro() {
    if (!centroUid) return;
    setBusy(true);
    setMsg(null);
    const token = await getClientIdToken();
    if (!token) { setBusy(false); return; }
    const res = centroEsTecnico
      ? await actionUpdateUserCentros(token, { targetUid: centroUid, centros: centrosMultiVal })
      : await actionUpdateUserCentro(token, { targetUid: centroUid, centro: centroVal });
    setBusy(false);
    if (!res.ok) { setMsg(res.error.message); return; }
    setCentroUid(null);
    void reload();
  }

  async function saveEspecialidades() {
    if (!espUid) return;
    setBusy(true);
    setMsg(null);
    const token = await getClientIdToken();
    if (!token) { setBusy(false); return; }
    const res = await actionUpdateUserEspecialidades(token, { targetUid: espUid, especialidades: espVal });
    setBusy(false);
    if (!res.ok) { setMsg(res.error.message); return; }
    setEspUid(null);
    void reload();
  }

  async function toggleActivo(uid: string, activo: boolean) {
    setBusy(true);
    setMsg(null);
    const token = await getClientIdToken();
    if (!token) {
      setBusy(false);
      return;
    }
    const res = await actionSetUserActivo(token, { targetUid: uid, activo });
    setBusy(false);
    if (!res.ok) {
      setMsg(res.error.message);
      return;
    }
    void reload();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {embedded ? (
            <h2 className="text-lg font-semibold tracking-tight">Usuarios</h2>
          ) : (
            <h1 className="text-2xl font-semibold tracking-tight">Usuarios</h1>
          )}
          <p className="text-sm text-muted">
            Administración de cuentas —{" "}
            <RolGuard minimo="superadmin" fallback={<span>visible según tu centro.</span>}>
              <span>vista global.</span>
            </RolGuard>
          </p>
        </div>
        {embedded ? null : (
          <Button asChild variant="outline" size="sm">
            <Link href="/superadmin">Volver</Link>
          </Button>
        )}
      </div>

      {msg ? <p className="text-sm text-red-600">{msg}</p> : null}
      {loadError ? <p className="text-sm text-red-600">{loadError}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Listado</CardTitle>
          <CardDescription>
            {loadingList
              ? "Cargando…"
              : `${rows.length} usuarios · Un usuario archivado no puede operar en la app hasta restaurarlo.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase text-muted">
                <th className="py-2 pr-3">Usuario</th>
                <th className="py-2 pr-3">Email</th>
                <th className="py-2 pr-3">Rol</th>
                <th className="py-2 pr-3">Centro</th>
                <th className="py-2 pr-3">Especialidad</th>
                <th className="py-2 pr-3">Estado</th>
                <th className="py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const lockedSuper = isSuperAdminRole(r.rol) && !viewerIsSuper;
                const pr = toPermisoRol(r.rol);
                const centroTabla =
                  pr === "cliente_arauco" ||
                  pr === "superadmin" ||
                  pr === "admin" ||
                  pr === "supervisor"
                    ? "Todas las plantas"
                    : r.centros_asignados?.length
                      ? r.centros_asignados.map((c) => nombreCentro(c)).join(", ")
                      : nombreCentro(r.centro ?? "");
                return (
                  <tr key={r.uid} className="border-b border-border/70">
                    <td className="py-2 pr-3 font-medium">{r.display_name}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{r.email}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={cn(
                          "inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold",
                          roleBadgeClass(r.rol),
                        )}
                      >
                        {roleLabel(r.rol)}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-sm text-foreground">{centroTabla}</td>
                    <td className="py-2 pr-3 text-xs text-muted">
                      {toPermisoRol(r.rol) === "tecnico"
                        ? (r.especialidades?.length ? r.especialidades.join(", ") : "—")
                        : "—"}
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={cn(
                          "inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium",
                          r.activo
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100"
                            : "border-zinc-400/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
                        )}
                      >
                        {r.activo ? "Activo" : "Archivado"}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy || lockedSuper}
                          onClick={() => {
                            setEditUid(r.uid);
                            setEditRol(
                              (toPermisoRol(r.rol) === "superadmin" ? "superadmin" : r.rol) as RolAssignable,
                            );
                          }}
                        >
                          Rol
                        </Button>
                        {toPermisoRol(r.rol) === "tecnico" ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy || lockedSuper}
                            onClick={() => {
                              setEspUid(r.uid);
                              setEspVal((r.especialidades ?? []) as Especialidad[]);
                            }}
                          >
                            Espec.
                          </Button>
                        ) : null}
                        {viewerIsSuper ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                              const esTecnico = toPermisoRol(r.rol) === "tecnico";
                              setCentroUid(r.uid);
                              setCentroEsTecnico(esTecnico);
                              if (esTecnico) {
                                const actuales = r.centros_asignados?.length
                                  ? r.centros_asignados
                                  : r.centro ? [r.centro] : [DEFAULT_CENTRO];
                                setCentrosMultiVal(actuales);
                              } else {
                                const c = (r.centro ?? "").trim();
                                setCentroVal(isCentroInKnownList(c) ? c : DEFAULT_CENTRO);
                              }
                            }}
                          >
                            Centro
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy || lockedSuper || (r.uid === user?.uid && r.activo)}
                          onClick={() => void toggleActivo(r.uid, !r.activo)}
                          title={
                            r.uid === user?.uid && r.activo
                              ? "No podés archivar tu propia sesión desde acá"
                              : undefined
                          }
                        >
                          {r.activo ? "Archivar" : "Restaurar"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alta rápida</CardTitle>
          <CardDescription>
            Crea la cuenta y obtené el enlace de configuración de contraseña para compartir por un canal seguro.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AltaUsuarioForm onDone={() => void reload()} viewerIsSuper={viewerIsSuper} />
        </CardContent>
      </Card>

      {editUid ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md shadow-xl">
            <CardHeader>
              <CardTitle className="text-base">Cambiar rol</CardTitle>
              <CardDescription>
                El token del usuario se actualizará en el próximo inicio de sesión.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <select
                className={selectClass}
                value={editRol}
                onChange={(e) => setEditRol(e.target.value as RolAssignable)}
              >
                {assignableRoles.map((x) => (
                  <option key={x} value={x}>
                    {roleLabel(x)}
                  </option>
                ))}
              </select>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditUid(null)}>
                  Cancelar
                </Button>
                <Button type="button" onClick={() => void saveRol()} disabled={busy}>
                  Guardar
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {centroUid ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md shadow-xl">
            <CardHeader>
              <CardTitle className="text-base">Cambiar centro</CardTitle>
              <CardDescription>
                {centroEsTecnico
                  ? "Técnico — podés asignar uno o más centros. El primero queda como centro principal."
                  : "Solo superadmin. Queda un solo centro y se quita el acceso multi-planta si lo tenía."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {centroEsTecnico ? (
                <fieldset className="space-y-2 rounded-lg border border-border p-3">
                  <legend className="px-1 text-xs text-muted-foreground">Plantas asignadas</legend>
                  <div className="flex flex-wrap gap-3">
                    {KNOWN_CENTROS.map((id) => (
                      <label key={id} className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-border"
                          checked={centrosMultiVal.includes(id)}
                          onChange={() =>
                            setCentrosMultiVal((prev) => {
                              if (prev.includes(id)) {
                                if (prev.length <= 1) return prev; // al menos uno siempre
                                return prev.filter((c) => c !== id);
                              }
                              return [...prev, id].sort((a, b) => a.localeCompare(b));
                            })
                          }
                          aria-label={`Planta ${nombreCentro(id)}`}
                        />
                        <span>{nombreCentro(id)}</span>
                      </label>
                    ))}
                  </div>
                  {centrosMultiVal.length > 1 ? (
                    <p className="text-xs text-muted-foreground">
                      Centro principal (primero):{" "}
                      <span className="font-semibold">
                        {nombreCentro([...centrosMultiVal].sort((a, b) => a.localeCompare(b))[0]!)}
                      </span>
                    </p>
                  ) : null}
                </fieldset>
              ) : (
                <>
                  <select
                    className={selectClass}
                    value={isCentroInKnownList(centroVal) ? centroVal : DEFAULT_CENTRO}
                    onChange={(e) => setCentroVal(e.target.value)}
                    aria-label="Centro"
                  >
                    {KNOWN_CENTROS.map((id) => (
                      <option key={id} value={id}>
                        {nombreCentro(id)}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Solo valores de <span className="font-mono">NEXT_PUBLIC_KNOWN_CENTROS</span>.
                  </p>
                </>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setCentroUid(null)}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  onClick={() => void saveCentro()}
                  disabled={busy || (centroEsTecnico && centrosMultiVal.length === 0)}
                >
                  Guardar
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {espUid ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md shadow-xl">
            <CardHeader>
              <CardTitle className="text-base">Especialidades del técnico</CardTitle>
              <CardDescription>
                Determinan qué grupo recibe las OTs del motor. Un técnico puede tener más de una
                especialidad.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <fieldset className="space-y-2 rounded-lg border border-border p-3">
                <legend className="px-1 text-xs text-muted-foreground">Grupos de trabajo</legend>
                {ESPECIALIDADES.map(({ id, label }) => (
                  <label key={id} className="flex cursor-pointer items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border"
                      checked={espVal.includes(id)}
                      onChange={() =>
                        setEspVal((prev) =>
                          prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id],
                        )
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
              {espVal.length === 0 ? (
                <p className="text-xs text-amber-600">
                  Sin especialidad: el técnico verá todas las OTs sin asignar del centro pero el motor no
                  le sugerirá trabajo.
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEspUid(null)}>
                  Cancelar
                </Button>
                <Button type="button" onClick={() => void saveEspecialidades()} disabled={busy}>
                  Guardar
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function AltaUsuarioForm({
  onDone,
  viewerIsSuper,
}: {
  onDone: () => void;
  viewerIsSuper: boolean;
}) {
  const defaultCentro = KNOWN_CENTROS[0] ?? DEFAULT_CENTRO;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [rol, setRol] = useState<RolAssignable>("tecnico");
  const [centrosTecnico, setCentrosTecnico] = useState<string[]>(() => [defaultCentro]);
  const [especialidadesTecnico, setEspecialidadesTecnico] = useState<Especialidad[]>([]);
  const [busy, setBusy] = useState(false);
  const [localMsg, setLocalMsg] = useState<string | null>(null);

  const roles: RolAssignable[] = viewerIsSuper
    ? ["tecnico", "supervisor", "admin", "superadmin", "cliente_arauco"]
    : ["tecnico", "supervisor", "admin", "cliente_arauco"];

  function toggleCentroTecnico(id: string) {
    setCentrosTecnico((prev) => {
      if (prev.includes(id)) {
        if (prev.length <= 1) return prev;
        return prev.filter((c) => c !== id);
      }
      return [...prev, id].sort((a, b) => a.localeCompare(b));
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLocalMsg(null);
    const token = await getClientIdToken();
    if (!token) {
      setBusy(false);
      return;
    }
    const res = await actionCreateUser(token, {
      email,
      password: password.trim() || undefined,
      display_name: displayName.trim() || undefined,
      rol,
      centro: rol === "tecnico" ? (centrosTecnico[0] ?? defaultCentro) : defaultCentro,
      centros_tecnico: rol === "tecnico" ? centrosTecnico : undefined,
      especialidades_tecnico: rol === "tecnico" ? especialidadesTecnico : undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setLocalMsg(res.error.message);
      return;
    }
    setLocalMsg(
      res.data.setupLink
        ? `Usuario creado. Enlace (copiar y enviar): ${res.data.setupLink}`
        : `Usuario creado (${res.data.uid}).`,
    );
    setEmail("");
    setPassword("");
    setDisplayName("");
    setRol("tecnico");
    setCentrosTecnico([defaultCentro]);
    setEspecialidadesTecnico([]);
    onDone();
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="max-w-md space-y-3">
      {localMsg ? <p className="text-xs text-muted break-all">{localMsg}</p> : null}
      <Input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <Input
        placeholder="Contraseña (opcional — se genera una temporal)"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Input placeholder="Nombre visible" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      <select
        className={selectClass}
        value={rol}
        onChange={(e) => {
          const next = e.target.value as RolAssignable;
          setRol(next);
          if (next === "tecnico") {
            setCentrosTecnico((c) => (c.length ? c : [defaultCentro]));
          }
        }}
      >
        {roles.map((x) => (
          <option key={x} value={x}>
            {roleLabel(x)}
          </option>
        ))}
      </select>
      {rol === "tecnico" ? (
        <>
          <fieldset className="space-y-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs text-muted-foreground">Centros (uno o varios)</legend>
            <div className="flex flex-wrap gap-3">
              {KNOWN_CENTROS.map((id) => (
                <label key={id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border"
                    checked={centrosTecnico.includes(id)}
                    onChange={() => toggleCentroTecnico(id)}
                    aria-label={`Planta ${nombreCentro(id)}`}
                  />
                  <span>{nombreCentro(id)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs text-muted-foreground">Especialidades del grupo</legend>
            <div className="flex flex-wrap gap-3">
              {ESPECIALIDADES.map(({ id, label }) => (
                <label key={id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border"
                    checked={especialidadesTecnico.includes(id)}
                    onChange={() =>
                      setEspecialidadesTecnico((prev) =>
                        prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id],
                      )
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-xs text-muted-foreground">
            Centros desde <span className="font-mono">NEXT_PUBLIC_KNOWN_CENTROS</span>; podés marcar una o varias plantas.
          </p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Supervisor, admin, superadmin y Cliente Arauco tienen alcance en todas las plantas configuradas; no hace falta
          elegir centro en el alta (el perfil guarda el centro por defecto del sistema solo por requisitos técnicos).
        </p>
      )}
      <Button type="submit" disabled={busy}>
        Crear usuario
      </Button>
    </form>
  );
}
