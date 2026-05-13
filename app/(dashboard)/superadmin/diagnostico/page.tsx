import { redirect } from "next/navigation";

/** Compatibilidad: el panel vive en Configuración → pestaña «Diagnóstico». */
export default function SuperadminDiagnosticoPage() {
  redirect("/superadmin/configuracion?tab=motor");
}
