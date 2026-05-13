import { redirect } from "next/navigation";

/** La importación vive en Administración → Configuración e importación. */
export default function SuperadminImportacionPage() {
  redirect("/superadmin/configuracion");
}
