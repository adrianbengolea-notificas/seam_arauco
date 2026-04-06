"use client";

import { SuperadminCentroFlagsPanel } from "@/app/superadmin/superadmin-centro-flags-panel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { hasAdminCapabilities } from "@/modules/users/roles";
import { useAuthUser, useUserProfile } from "@/modules/users/hooks";

export default function SuperAdminPage() {
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
    <div className="space-y-8 py-2">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-amber-900 dark:text-amber-100">
          Superadmin
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {profile!.display_name} · <span className="font-mono">{user.email}</span> · centro{" "}
          <span className="font-mono">{profile!.centro}</span>
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Rol: <span className="font-mono">{profile!.rol}</span>
        </p>
      </div>

      <Card className="max-w-xl border-amber-200/80 dark:border-amber-900/40">
        <CardHeader>
          <CardTitle className="text-base">Planillas digitales</CardTitle>
          <CardDescription>
            Ver definiciones fijas (GG, Elec, AA, Correctivos) cargadas en Firestore.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm">
            <Link href="/superadmin/planillas">Ver plantillas</Link>
          </Button>
        </CardContent>
      </Card>

      <Card className="max-w-xl border-emerald-200/80 dark:border-emerald-900/50">
        <CardHeader>
          <CardTitle className="text-base">Materiales e inventario</CardTitle>
          <CardDescription>Entradas de stock, movimientos y revisión de mapeo IA en consumos de OT.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm">
            <Link href="/superadmin/materiales">Abrir gestión de materiales</Link>
          </Button>
        </CardContent>
      </Card>

      <Card className="max-w-xl border-emerald-200/80 dark:border-emerald-900/50">
        <CardHeader>
          <CardTitle className="text-base">Gestión de usuarios</CardTitle>
          <CardDescription>
            Administradores de planta gestionan su centro; el superadmin tiene alcance global.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm">
            <Link href="/superadmin/usuarios">Abrir usuarios</Link>
          </Button>
        </CardContent>
      </Card>

      <SuperadminCentroFlagsPanel />

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
    </div>
  );
}
