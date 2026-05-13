export function ProgramaPageSkeleton() {
  return (
    <div className="space-y-6 px-1 animate-pulse" aria-hidden="true">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-8 w-48 rounded-md bg-foreground/10" />
          <div className="h-4 w-72 max-w-full rounded-md bg-foreground/8" />
        </div>
        <div className="h-10 w-full max-w-xs rounded-lg bg-foreground/10" />
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="h-10 flex-1 min-w-[8rem] max-w-[11rem] rounded-lg bg-foreground/10" />
        <div className="h-10 flex-1 min-w-[8rem] max-w-[11rem] rounded-lg bg-foreground/10" />
        <div className="h-10 flex-1 min-w-[8rem] max-w-[11rem] rounded-lg bg-foreground/10" />
      </div>
      <div className="h-[min(28rem,55vh)] w-full rounded-xl border border-border bg-foreground/[0.03]" />
    </div>
  );
}
