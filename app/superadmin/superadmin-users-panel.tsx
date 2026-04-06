"use client";

import {
  actionCreateUser,
  actionListUsers,
  actionSetUserActivo,
  actionUpdateUserRole,
  type UserAdminRow,
} from "@/app/actions/users";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DEFAULT_CENTRO } from "@/lib/config/app-config";
import { cn } from "@/lib/utils";
import { getClientIdToken } from "@/modules/users/hooks";
import type { UserRole } from "@/modules/users/types";
import { useCallback, useEffect, useState } from "react";

const selectClass = cn(
  "flex h-10 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm",
  "text-foreground transition-[border-color,box-shadow] duration-150",
  "focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
  "disabled:cursor-not-allowed disabled:opacity-60",
);

const ROLE_LABEL: Record<UserRole, string> = {
  tecnico: "Técnico (operario)",
  supervisor: "Supervisor",
  admin: "Admin de planta",
  superadmin: "Superadmin",
  super_admin: "Superadmin (legado)",
};

export function SuperadminUsersPanel() {
  const [rows, setRows] = useState<UserAdminRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formMsg, setFormMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [rol, setRol] = useState<UserRole>("tecnico");
  const [centro, setCentro] = useState(DEFAULT_CENTRO);

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
    void reload();
  }, [reload]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormMsg(null);
    setBusy(true);
    const token = await getClientIdToken();
    if (!token) {
      setFormMsg({ type: "err", text: "No hay sesión" });
      setBusy(false);
      return;
    }
    const res = await actionCreateUser(token, {
      email,
      password,
      display_name: displayName.trim() || undefined,
      rol: rol as "tecnico" | "supervisor" | "admin",
      centro,
    });
    setBusy(false);
    if (!res.ok) {
      setFormMsg({ type: "err", text: res.error.message });
      return;
    }
    setFormMsg({
      type: "ok",
      text: `Usuario creado (${res.data.uid}). Compartí la contraseña por un canal seguro.`,
    });
    setEmail("");
    setPassword("");
    setDisplayName("");
    setRol("tecnico");
    setCentro(DEFAULT_CENTRO);
    void reload();
  }

  async function changeRole(uid: string, next: "tecnico" | "supervisor" | "admin") {
    const token = await getClientIdToken();
    if (!token) return;
    setBusy(true);
    const res = await actionUpdateUserRole(token, { targetUid: uid, rol: next });
    setBusy(false);
    if (!res.ok) {
      setFormMsg({ type: "err", text: res.error.message });
      return;
    }
    setFormMsg(null);
    void reload();
  }

  async function toggleActivo(uid: string, activo: boolean) {
    const token = await getClientIdToken();
    if (!token) return;
    setBusy(true);
    const res = await actionSetUserActivo(token, { targetUid: uid, activo });
    setBusy(false);
    if (!res.ok) {
      setFormMsg({ type: "err", text: res.error.message });
      return;
    }
    setFormMsg(null);
    void reload();
  }

  return (
    <div className="space-y-6">
      {formMsg ? (
        <p
          className={cn(
            "text-sm",
            formMsg.type === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-red-600",
          )}
        >
          {formMsg.text}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Crear usuario</CardTitle>
          <CardDescription>
            Alta en Firebase Auth y perfil en <span className="font-mono">users/{"{uid}"}</span>.
            Rol <span className="font-mono">super_admin</span> solo con{" "}
            <span className="font-mono">SUPERADMIN_EMAIL</span>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onCreate} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Correo</label>
              <Input
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Contraseña inicial
              </label>
              <Input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Nombre visible (opcional)
              </label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Centro</label>
              <Input value={centro} onChange={(e) => setCentro(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Rol</label>
              <select
                className={selectClass}
                value={rol}
                onChange={(e) => setRol(e.target.value as UserRole)}
              >
                <option value="tecnico">{ROLE_LABEL.tecnico}</option>
                <option value="supervisor">{ROLE_LABEL.supervisor}</option>
                <option value="admin">{ROLE_LABEL.admin}</option>
              </select>
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={busy} className="w-full sm:w-auto">
                Crear usuario
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Usuarios</CardTitle>
            <CardDescription>Hasta 500 perfiles. Ordenados por correo.</CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void reload()} disabled={busy}>
            Actualizar lista
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {loadingList ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Cargando…</p>
          ) : loadError ? (
            <p className="text-sm text-red-600">{loadError}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <thead className="bg-surface text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="border-b border-border px-3 py-2 font-medium">Correo</th>
                    <th className="border-b border-border px-3 py-2 font-medium">Centro</th>
                    <th className="border-b border-border px-3 py-2 font-medium">Rol</th>
                    <th className="border-b border-border px-3 py-2 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const locked = r.rol === "super_admin";
                    return (
                      <tr key={r.uid} className="border-b border-border/80 last:border-0">
                        <td className="px-3 py-2 align-middle">
                          <div className="font-medium text-foreground">{r.email}</div>
                          <div className="text-xs text-muted">{r.display_name}</div>
                          <div className="font-mono text-[10px] text-zinc-500">{r.uid}</div>
                        </td>
                        <td className="px-3 py-2 align-middle font-mono text-xs">{r.centro}</td>
                        <td className="px-3 py-2 align-middle">
                          {locked ? (
                            <span className="text-xs text-muted">{ROLE_LABEL.super_admin}</span>
                          ) : (
                            <select
                              className={cn(selectClass, "h-9 py-1 text-xs")}
                              value={r.rol}
                              disabled={busy}
                              onChange={(e) =>
                                void changeRole(
                                  r.uid,
                                  e.target.value as "tecnico" | "supervisor" | "admin",
                                )
                              }
                            >
                              <option value="tecnico">{ROLE_LABEL.tecnico}</option>
                              <option value="supervisor">{ROLE_LABEL.supervisor}</option>
                              <option value="admin">{ROLE_LABEL.admin}</option>
                            </select>
                          )}
                        </td>
                        <td className="px-3 py-2 align-middle">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={cn(
                                "rounded-md px-2 py-0.5 text-xs font-medium",
                                r.activo
                                  ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
                                  : "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
                              )}
                            >
                              {r.activo ? "Activo" : "Inactivo"}
                            </span>
                            {!locked ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 text-xs"
                                disabled={busy}
                                onClick={() => void toggleActivo(r.uid, !r.activo)}
                              >
                                {r.activo ? "Desactivar" : "Reactivar"}
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
