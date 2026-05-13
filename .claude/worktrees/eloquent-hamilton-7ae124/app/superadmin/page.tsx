"use client";

import { GestionUsuariosClient } from "@/app/(dashboard)/superadmin/usuarios/gestion-usuarios-client";
import { SuperadminMaterialesClient } from "@/app/superadmin/materiales/superadmin-materiales-client";
import { SuperadminPlanillasClient } from "@/app/superadmin/planillas/superadmin-planillas-client";
import { PermisoGuard } from "@/components/auth/PermisoGuard";
import { SuperadminCentroFlagsPanel } from "@/app/superadmin/superadmin-centro-flags-panel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { hasAdminCapabilities } from "@/modules/users/roles";
import { useAuthUser, useUserProfile } from "@/modules/users/hooks";
import { Suspense, useState } from "react";

const CONFIG_TABS = [
  { id: "planillas", label: "Planillas digitales" },
  { id: "materiales", label: "Materiales e inventario" },
  { id: "usuarios", label: "Gestión de usuarios" },
  { id: "centro", label: "Centro y módulos" },
  { id: "sesion", label: "Sesión" },
] as const;

type ConfigTabId = (typeof CONFIG_TABS)[number]["id"];

export default function SuperAdminPage() {
  const [configTab, setConfigTab] = useState<ConfigTabId>("planillas");
  const { user, loading: authLoading } = useAuthUser();
  const { profile, loading: profileLoading, error } = useUserProfile(user?.uid);

  const loading = authLoading || profileLoading;

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-zinc-600 dark:text-zinc-400">
        Cargando perfil…
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-red-600">
        No se pudo leer el perfil: {error.message}
      </p>
    );
  }

  if (!user) {
    return null;
  }

  if (!hasAdminCapabilities(profile?.rol)) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-8">
        <Card className="border-amber-200 dark:border-amber-900">
          <CardHeader>
            <CardTitle>Acceso restringido</CardTitle>
            <CardDescription>
              Esta área es para perfiles con rol <span className="font-mono">admin</span> o{" "}
              <span className="font-mono">super_admin</span> en Firestore (
              <code className="text-xs">users/{'{uid}'}</code>).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
            <p>
              Tu rol actual:{" "}
              <span className="font-mono">{profile?.rol ?? "sin documento users"}</span>
            </p>
            <p>
              El súper administrador se define con <span className="font-mono">SUPERADMIN_EMAIL</span> en{" "}
              <span className="font-mono">.env.local</span>; al iniciar sesión ese correo recibe{" "}
              <span className="font-mono">super_admin</span> y puede crear admins y técnicos.
            </p>
            <Button asChild variant="outline">
              <Link href="/dashboard">Volver al panel</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 py-2">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-amber-900 dark:text-amber-100">
          Configuración general
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {profile!.display_name} · <span className="font-mono">{user.email}</span> · centro{" "}
          <span className="font-mono">{profile!.centro}</span>
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Rol: <span className="font-mono">{profile!.rol}</span>
        </p>
      </div>

      <div className="space-y-4">
        <div
          className="-mx-1 overflow-x-auto px-1 pb-0.5 scrollbar-thin"
          role="tablist"
          aria-label="Secciones de configuración"
        >
          <div className="flex min-w-min flex-nowrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
            {CONFIG_TABS.map((t) => {
              const active = configTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  id={`config-tab-${t.id}`}
                  onClick={() => setConfigTab(t.id)}
                  className={cn(
                    "shrink-0 whitespace-nowrap rounded-t-md border-b-2 px-3 py-2.5 text-left text-xs font-semibold transition-colors sm:px-4 sm:text-sm",
                    active
                      ? "border-amber-600 bg-amber-50 text-amber-950 dark:border-amber-400 dark:bg-amber-950/40 dark:text-amber-50"
                      : "border-transparent text-zinc-600 hover:bg-zinc-50 hover:text-foreground dark:text-zinc-400 dark:hover:bg-zinc-900/60",
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        <div role="tabpanel" aria-labelledby={`config-tab-${configTab}`}>
          {configTab === "planillas" ? (
            <div className="space-y-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Definiciones en <span className="font-mono text-xs">planilla_templates</span> (GG, Elec, AA,
                Correctivos). Editá y guardá; los cambios aplican en tiempo real para nuevas planillas.
              </p>
              <SuperadminPlanillasClient embedded />
            </div>
          ) : null}

          {configTab === "materiales" ? (
            <div className="space-y-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Entradas de stock, movimientos de inventario y, según permisos, revisión de mapeo IA en consumos de
                OT.
              </p>
              <Suspense
                fallback={
                  <div className="py-8 text-center text-sm text-zinc-600 dark:text-zinc-400">
                    Cargando inventario…
                  </div>
                }
              >
                <SuperadminMaterialesClient embedded />
              </Suspense>
            </div>
          ) : null}

          {configTab === "usuarios" ? (
            <PermisoGuard
              permiso="admin:gestionar_usuarios"
              fallback={
                <p className="text-sm text-muted">No tenés permiso para gestionar usuarios.</p>
              }
            >
              <div className="space-y-4">
                <p className="text-sm text-muted">
                  Administradores de planta gestionan su centro; el superadmin tiene alcance global.
                </p>
                <GestionUsuariosClient embedded />
              </div>
            </PermisoGuard>
          ) : null}

          {configTab === "centro" ? <SuperadminCentroFlagsPanel /> : null}

          {configTab === "sesion" ? (
            <Card className="max-w-xl">
              <CardHeader>
                <CardTitle>Sesión</CardTitle>
                <CardDescription>Datos de la cuenta conectada</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
                <p>
                  UID: <span className="font-mono text-xs">{user.uid}</span>
                </p>
                <p className="text-xs">
                  Las contraseñas no se guardan en la app; viven en Firebase Authentication.
                </p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
