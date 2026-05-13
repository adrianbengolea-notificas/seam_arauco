"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { usePermisos } from "@/lib/permisos/usePermisos";
import { useAuthUser, useUserProfile } from "@/modules/users/hooks";

export default function PerfilPage() {
  const { rol } = usePermisos();
  const { user, loading: authLoading } = useAuthUser();
  const { profile, loading: profileLoading, error } = useUserProfile(user?.uid);
  const homeHref = rol === "cliente_arauco" ? "/cliente" : "/dashboard";
  const homeLabel = rol === "cliente_arauco" ? "Volver al inicio" : "Volver al panel";

  const loading = authLoading || profileLoading;

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        Cargando perfil…
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-destructive">
        No se pudo leer el perfil: {error.message}
      </p>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 py-2">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Perfil</h1>
        <p className="text-sm text-muted-foreground">
          Datos de tu cuenta en la plataforma.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identidad</CardTitle>
          <CardDescription>Nombre, correo y centro asignado.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Nombre</p>
            <p className="mt-0.5 font-medium text-foreground">
              {profile?.display_name?.trim() || "—"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Correo</p>
            <p className="mt-0.5 break-all font-mono text-foreground">{user.email ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Centro</p>
            <p className="mt-0.5 font-mono text-foreground">{profile?.centro?.trim() || "—"}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rol</p>
            <p className="mt-0.5 font-mono text-foreground">{profile?.rol ?? "—"}</p>
          </div>
        </CardContent>
      </Card>

      <Button asChild variant="outline" size="sm">
        <Link href={homeHref}>{homeLabel}</Link>
      </Button>
    </div>
  );
}
