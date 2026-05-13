import { NuevaOtClient } from "@/app/(dashboard)/tareas/nueva/nueva-ot-client";

type Props = { searchParams: Promise<{ avisoId?: string }> };

export default async function NuevaOtPage(props: Props) {
  const sp = await props.searchParams;
  return <NuevaOtClient initialAvisoParam={sp.avisoId} />;
}
