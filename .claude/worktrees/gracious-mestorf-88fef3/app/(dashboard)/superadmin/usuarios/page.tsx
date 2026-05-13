import { PermisoGuard } from "@/components/auth/PermisoGuard";
import { GestionUsuariosClient } from "@/app/(dashboard)/superadmin/usuarios/gestion-usuarios-client";

export default function SuperadminUsuariosPage() {
  return (
    <PermisoGuard
      permiso="admin:gestionar_usuarios"
      fallback={
        <p className="py-8 text-sm text-muted">No tenés permiso para gestionar usuarios.</p>
      }
    >
      <GestionUsuariosClient />
    </PermisoGuard>
  );
}
