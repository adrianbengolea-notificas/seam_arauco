import { redirect } from "next/navigation";

/** Ruta histórica: vista unificada en `/programa/preventivos`. */
export default function ProgramaAnualRedirectPage() {
  redirect("/programa/preventivos");
}
