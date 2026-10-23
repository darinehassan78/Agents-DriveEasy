import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

const control =
  "field-control block w-full rounded-lg border border-line bg-surface px-3 text-base sm:text-sm text-fg placeholder:text-muted " +
  "focus:border-brand focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-60 " +
  "aria-[invalid=true]:border-danger";

export function Label({ className, ...rest }: ComponentProps<"label">) {
  return <label className={cn("mb-1.5 block text-sm font-medium", className)} {...rest} />;
}

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={cn(control, "h-11", className)} {...rest} />;
}

export function Select({ className, ...rest }: ComponentProps<"select">) {
  return <select className={cn(control, "h-11 pr-8", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-24 py-2", className)} {...rest} />;
}

export function FieldError({ id, errors }: { id: string; errors?: string[] | string }) {
  const list = typeof errors === "string" ? [errors] : errors;
  if (!list?.length) return null;
  return (
    <p id={id} className="mt-1 text-sm text-danger">
      {list.join(" ")}
    </p>
  );
}

/** Label + control + hint + error. Pair with `describe()` on the control. */
export function Field({
  label,
  htmlFor,
  hint,
  errors,
  children,
  className,
  optional,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  errors?: string[] | string;
  children: ReactNode;
  className?: string;
  optional?: boolean;
}) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor}>
        {label}
        {optional && <span className="ml-1 font-normal text-muted">(optional)</span>}
      </Label>
      {children}
      {hint && (
        <p id={`${htmlFor}-hint`} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      )}
      <FieldError id={`${htmlFor}-error`} errors={errors} />
    </div>
  );
}

/** id/name/aria props for a control inside <Field>. */
export function describe(id: string, errors?: string[] | string, hint?: boolean) {
  const has = typeof errors === "string" ? !!errors : !!errors?.length;
  const ids = [hint && `${id}-hint`, has && `${id}-error`].filter(Boolean).join(" ");
  return {
    id,
    name: id,
    "aria-invalid": has ? (true as const) : undefined,
    "aria-describedby": ids || undefined,
  };
}

export function Checkbox({ label, description, className, ...rest }: ComponentProps<"input"> & { label: ReactNode; description?: ReactNode }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3", className)}>
      <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[var(--brand)]" {...rest} />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-sm text-muted">{description}</span>}
      </span>
    </label>
  );
}
