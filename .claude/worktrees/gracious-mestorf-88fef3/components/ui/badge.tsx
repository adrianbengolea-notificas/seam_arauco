import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

const badgeVariants = cva(
  "inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium tabular-nums transition-colors",
  {
    variants: {
      variant: {
        default: "border-border bg-surface text-foreground",
        preventivo: "border-sky-600/30 bg-sky-600/15 text-sky-900 dark:text-sky-100",
        correctivo: "border-amber-600/35 bg-amber-600/15 text-amber-950 dark:text-amber-100",
        urgente: "border-red-600/40 bg-red-600/15 text-red-950 dark:text-red-100",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
