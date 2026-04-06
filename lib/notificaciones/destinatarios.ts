import type { Rol } from "@/lib/permisos/index";
import { toPermisoRol } from "@/lib/permisos/index";
import { getUserProfileByUid, listUserProfilesFiltered } from "@/modules/users/repository";

export type DestinatarioNotif = {
  uid: string;
  rol: Rol;
  centro: string;
};

export async function destinatariosClienteArauco(centro: string): Promise<DestinatarioNotif[]> {
  const rows = await listUserProfilesFiltered({ centro: centro.trim(), activo: true, limit: 800 });
  return rows
    .filter((u) => toPermisoRol(u.rol) === "cliente_arauco")
    .map((u) => ({ uid: u.uid, rol: "cliente_arauco" as const, centro: u.centro }));
}

export async function destinatariosSupervisoresAdmin(centro: string): Promise<DestinatarioNotif[]> {
  const rows = await listUserProfilesFiltered({ centro: centro.trim(), activo: true, limit: 800 });
  const ok: Rol[] = ["supervisor", "admin", "superadmin"];
  return rows
    .filter((u) => ok.includes(toPermisoRol(u.rol)))
    .map((u) => ({ uid: u.uid, rol: toPermisoRol(u.rol), centro: u.centro }));
}

export async function destinatariosAdminsCentro(centro: string): Promise<DestinatarioNotif[]> {
  const rows = await listUserProfilesFiltered({ centro: centro.trim(), activo: true, limit: 800 });
  return rows
    .filter((u) => {
      const r = toPermisoRol(u.rol);
      return r === "admin" || r === "superadmin";
    })
    .map((u) => ({ uid: u.uid, rol: toPermisoRol(u.rol), centro: u.centro }));
}

export async function destinatariosTecnico(tecnicoId: string): Promise<DestinatarioNotif[]> {
  const p = await getUserProfileByUid(tecnicoId);
  if (!p || p.activo === false) return [];
  return [{ uid: tecnicoId, rol: toPermisoRol(p.rol), centro: p.centro }];
}
