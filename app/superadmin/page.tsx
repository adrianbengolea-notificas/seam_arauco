"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { mensajeErrorFirebaseParaUsuario } from "@/lib/firebase/mensaje-error-usuario";
import { hasAdminCapabilities } from "@/modules/users/roles";
import { useAuthUser, useUserProfile } from "@/modules/users/hooks";
import Link from "next/link";
import { nombreCentro } from "@/lib/config/app-config";

const ENLACES = [
  {
    href: "/superadmin/configuracion",
    title: "Configuración e importación",
    description: "Importación (Excel/SAP), propuestas semanales (motor y estado por planta) y flags por centro.",
  },
  {
    href: "/superadmin/usuarios",
    title: "Usuarios",
    description: "Alta y permisos por centro.",
  },
  {
    href: "/superadmin/materiales",
    title: "Materiales",
    description: "Stock, movimientos y mapeo de consumos.",
  },
  {
    href: "/superadmin/planillas",
    title: "Planillas digitales",
    description: "Plantillas y respuestas de planillas.",
  },
] as const;

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
        No se pudo leer el perfil: {mensajeErrorFirebaseParaUsuario(error)}
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
    <div className="mx-auto max-w-4xl space-y-8 py-2">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-amber-900 dark:text-amber-100">
          Administración
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {profile!.display_name} · <span className="font-mono">{user.email}</span> · planta{" "}
          <span className="font-medium text-foreground">{nombreCentro(profile!.centro)}</span>
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Rol: <span className="font-mono">{profile!.rol}</span>
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {ENLACES.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-label={`Abrir ${item.title}`}
            className="rounded-[var(--radius-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:focus-visible:ring-offset-background"
          >
            <Card className="h-full cursor-pointer transition-colors hover:border-amber-300/60 dark:hover:border-amber-700/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{item.title}</CardTitle>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <span className={buttonVariants({ variant: "secondary", size: "sm" })}>Abrir</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
