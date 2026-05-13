import { WorkOrderDetailClient } from "@/app/(dashboard)/tareas/[id]/work-order-detail-client";

type Props = { params: Promise<{ id: string }> };

export default async function TareaDetailDashboardPage(props: Props) {
  const { id } = await props.params;
  return <WorkOrderDetailClient workOrderId={id} />;
}
