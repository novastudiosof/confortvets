import * as React from "react";

import { cn } from "@/lib/utils";

const controlClass =
  "flex w-full rounded-[var(--radius-brand-sm)] border border-brand-border bg-white px-3 py-2 text-sm text-brand-ink placeholder:text-brand-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50";

export function Field({
  label,
  htmlFor,
  hint,
  required,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-brand-ink">
        {label}
        {required && <span className="text-brand-danger"> *</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-brand-muted">{hint}</p>}
    </div>
  );
}

type InputProps = React.ComponentProps<"input">;

export function TextField({
  label,
  hint,
  className,
  ...props
}: InputProps & { label: string; hint?: string }) {
  const id = props.id ?? props.name;
  return (
    <Field label={label} htmlFor={id} hint={hint} required={props.required} className={className}>
      <input id={id} {...props} className={cn(controlClass, "h-10")} />
    </Field>
  );
}

export function TextAreaField({
  label,
  hint,
  className,
  rows = 3,
  ...props
}: React.ComponentProps<"textarea"> & { label: string; hint?: string }) {
  const id = props.id ?? props.name;
  return (
    <Field label={label} htmlFor={id} hint={hint} required={props.required} className={className}>
      <textarea id={id} rows={rows} {...props} className={cn(controlClass, "min-h-20")} />
    </Field>
  );
}

export interface Option {
  value: string;
  label: string;
}

export function SelectField({
  label,
  hint,
  className,
  options,
  placeholder,
  ...props
}: React.ComponentProps<"select"> & {
  label: string;
  hint?: string;
  options: Option[];
  placeholder?: string;
}) {
  const id = props.id ?? props.name;
  return (
    <Field label={label} htmlFor={id} hint={hint} required={props.required} className={className}>
      <select id={id} {...props} className={cn(controlClass, "h-10")}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function CheckboxField({
  label,
  hint,
  className,
  ...props
}: Omit<InputProps, "type"> & { label: string; hint?: string }) {
  const id = props.id ?? props.name;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="flex items-center gap-2 text-sm text-brand-ink">
        <input id={id} type="checkbox" {...props} className="h-4 w-4 rounded border-brand-border accent-[var(--color-primary)]" />
        {label}
      </label>
      {hint && <p className="ml-6 text-xs text-brand-muted">{hint}</p>}
    </div>
  );
}

/** Aplica el mismo estilo de los campos a un control propio. */
export const fieldControlClass = controlClass;
