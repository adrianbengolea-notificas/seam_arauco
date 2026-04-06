import { redirect } from "next/navigation";

/** Compat: el flujo real está en /programa?vista=operativo */
export default function CargarProgramaPage() {
  redirect("/programa?vista=operativo");
}
