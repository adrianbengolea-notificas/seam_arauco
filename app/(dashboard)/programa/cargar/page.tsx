import { PROGRAMA_AGENDA_OT_SEMANAL_HABILITADA } from "@/lib/config/app-config";
import { redirect } from "next/navigation";

/** Compat: el flujo unificado está en /programa (vista operativa solo si está habilitada). */
export default function CargarProgramaPage() {
  redirect(PROGRAMA_AGENDA_OT_SEMANAL_HABILITADA ? "/programa?vista=operativo" : "/programa");
}
