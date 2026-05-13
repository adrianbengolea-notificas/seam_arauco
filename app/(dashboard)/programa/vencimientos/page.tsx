import { redirect } from "next/navigation";

/** Ruta histórica: vista unificada en `/programa/preventivos`. */
export default function VencimientosRedirectPage() {
  redirect("/programa/preventivos?pestana=vencimientos");
}
