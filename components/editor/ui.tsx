"use client";

import type { ReactNode } from "react";

/** Shared primitives, so every panel looks and behaves consistently. */

export function Card({
  title,
  children,
  action,
}: {
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-card border border-line bg-surface p-4">
      {title && (
        <header className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Button({
  children,
  variant = "secondary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  const styles = {
    primary: "bg-accent text-white hover:bg-accent-hover disabled:bg-line disabled:text-muted",
    secondary: "border border-line bg-surface hover:bg-canvas disabled:text-muted",
    ghost: "hover:bg-canvas disabled:text-muted",
    danger: "border border-line text-red-600 hover:bg-red-50",
  }[variant];

  return (
    <button
      {...props}
      className={`inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...props}
      aria-label={label}
      title={label}
      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-surface text-ink transition-colors hover:bg-canvas disabled:cursor-not-allowed disabled:text-muted"
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Alert({
  tone = "warning",
  children,
}: {
  tone?: "warning" | "error" | "info";
  children: ReactNode;
}) {
  const styles = {
    warning: "border-amber-300 bg-amber-50 text-amber-900",
    error: "border-red-300 bg-red-50 text-red-900",
    info: "border-line bg-canvas text-ink",
  }[tone];

  return (
    <p role="status" className={`rounded-lg border px-3 py-2 text-xs ${styles}`}>
      {children}
    </p>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted">
      <span
        aria-hidden="true"
        className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-accent"
      />
      {label}
    </span>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
