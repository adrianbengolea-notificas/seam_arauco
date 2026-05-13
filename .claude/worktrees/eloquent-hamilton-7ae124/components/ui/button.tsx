import { cn } from "@/lib/utils";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-[color,background-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 dark:focus-visible:ring-offset-background",
  {
    variants: {
      variant: {
        default:
          "bg-brand text-brand-foreground shadow-sm hover:bg-brand-hover active:scale-[0.98]",
        secondary:
          "bg-foreground/8 text-foreground shadow-sm hover:bg-foreground/12 dark:bg-white/10 dark:hover:bg-white/14",
        ghost: "text-muted hover:bg-foreground/6 hover:text-foreground dark:hover:bg-white/8",
        outline:
          "border border-border bg-surface shadow-sm hover:bg-foreground/[0.04] dark:hover:bg-white/[0.06]",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3 text-xs",
        lg: "h-11 rounded-lg px-8 text-base",
        icon: "h-9 w-9 shrink-0 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
  },
);
Button.displayName = "Button";
