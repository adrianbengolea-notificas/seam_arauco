import dynamic from "next/dynamic";
import { Suspense } from "react";
import { ProgramaPageSkeleton } from "./programa-skeleton";

const ProgramaClient = dynamic(
  () => import("./programa-client").then((m) => ({ default: m.ProgramaClient })),
  { loading: () => <ProgramaPageSkeleton /> },
);

export default function ProgramaPage() {
  return (
    <Suspense fallback={<ProgramaPageSkeleton />}>
      <ProgramaClient />
    </Suspense>
  );
}
