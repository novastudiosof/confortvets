import * as React from "react";

import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  back?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between no-print">
      <div className="min-w-0">
        {back}
        <h1 className="text-2xl font-semibold text-brand-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-brand-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const noticeStyles = {
  info: "border-brand/30 bg-brand-soft text-brand-ink",
  warning: "border-brand-warning/40 bg-brand-warning/10 text-brand-ink",
  danger: "border-brand-danger/40 bg-brand-danger/10 text-brand-ink",
  success: "border-brand-success/40 bg-brand-success/10 text-brand-ink",
} as const;

export function Notice({
  tone = "info",
  className,
  children,
}: {
  tone?: keyof typeof noticeStyles;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("rounded-[var(--radius-brand-md)] border px-4 py-3 text-sm", noticeStyles[tone], className)}
    >
      {children}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-brand-md)] border border-dashed border-brand-border bg-white px-6 py-10 text-center text-sm text-brand-muted">
      {children}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-brand-md)] border border-brand-border bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-brand-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-brand-ink">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-brand-muted">{hint}</p>}
    </div>
  );
}

export function DataTable({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto rounded-[var(--radius-brand-md)] border border-brand-border bg-white", className)}>
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}

export const thClass = "border-b border-brand-border bg-black/[0.03] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-brand-muted";
export const tdClass = "border-b border-brand-border/60 px-3 py-2.5 align-top text-brand-ink";

export function Section({
  title,
  actions,
  children,
  className,
  style,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <section style={style} className={cn("rounded-[var(--radius-brand-md)] border border-brand-border bg-white shadow-sm", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-brand-border px-5 py-3">
        <h2 className="text-base font-semibold text-brand-ink">{title}</h2>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function DefinitionList({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-xs font-medium uppercase tracking-wide text-brand-muted">{item.label}</dt>
          <dd className="mt-0.5 text-sm text-brand-ink">{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
