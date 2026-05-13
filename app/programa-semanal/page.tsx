import { redirect } from "next/navigation";

/** Ruta histórica; el flujo unificado vive en `/programa`. */
export default function ProgramaSemanalPage() {
  redirect("/programa");
}
