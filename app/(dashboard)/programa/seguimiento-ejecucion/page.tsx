import { redirect } from "next/navigation";

/** Ruta histórica: la vista unificada está en `/programa/preventivos`. */
export default function SeguimientoEjecucionPage() {
  redirect("/programa/preventivos?pestana=vencimientos");
}
