import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-transparent bg-brand-soft text-brand-dark",
        success: "border-transparent bg-brand-success/15 text-brand-success",
        warning: "border-transparent bg-brand-warning/15 text-brand-warning",
        danger: "border-transparent bg-brand-danger/15 text-brand-danger",
        outline: "border-brand-border text-brand-ink",
        muted: "border-transparent bg-black/5 text-brand-muted",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
