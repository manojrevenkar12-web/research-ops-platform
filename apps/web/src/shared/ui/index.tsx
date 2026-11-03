// Shared building blocks. Every screen renders its data through <QueryView>, which owns the three states
// a screen must handle besides success: loading (a skeleton shaped like the content), error (what went wrong
// and a retry) and empty (what to do next).
import type { UseQueryResult } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { type ButtonHTMLAttributes, type ReactNode, useId } from "react";
import { describeError } from "../lib/api";
import { DURATION, EASE, RISE } from "../theme/motion";

export function Page({
  title,
  lead,
  actions,
  children,
}: {
  title: string;
  lead: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section className="page" aria-labelledby={titleId}>
      <header className="page__head">
        <div>
          <h1 id={titleId} className="page__title">
            {title}
          </h1>
          <p className="page__lead">{lead}</p>
        </div>
        {actions ? <div className="page__actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function Skeleton({ rows = 4, label }: { rows?: number; label: string }) {
  return (
    <output className="skeleton" aria-live="polite" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
        <div key={i} className="skeleton__row" style={{ inlineSize: `${100 - ((i * 13) % 35)}%` }} />
      ))}
    </output>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="state state--error" role="alert">
      <p className="state__title">This could not be loaded.</p>
      <p className="state__body">{describeError(error)}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="state state--empty">
      <p className="state__title">{title}</p>
      <p className="state__body">{body}</p>
      {action}
    </div>
  );
}

export function QueryView<T>({
  query,
  loading,
  empty,
  isEmpty,
  children,
}: {
  query: UseQueryResult<T>;
  loading: string;
  empty?: { title: string; body: string; action?: ReactNode };
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <Skeleton label={loading} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const data = query.data as T;
  const blank = isEmpty ? isEmpty(data) : Array.isArray(data) && data.length === 0;
  if (blank && empty) return <EmptyState {...empty} />;
  return <>{children(data)}</>;
}

type Variant = "primary" | "secondary" | "quiet" | "danger";
export function Button({
  variant = "primary",
  busy,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={`btn btn--${variant} ${rest.className ?? ""}`}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
    >
      {children}
    </button>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "ok" | "warn" | "danger" | "restricted";
  children: ReactNode;
}) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function Restricted({ classification }: { classification: string }) {
  if (classification !== "restricted") return null;
  return <Badge tone="restricted">Restricted</Badge>;
}

export function Field({
  label,
  hint,
  children,
  error,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is the child
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint ? <span className="field__hint">{hint}</span> : null}
      {error ? <span className="field__error">{error}</span> : null}
    </label>
  );
}

/** A message that appears where the change happened and says what happened. */
export function Notice({ message, tone = "ok" }: { message: string | null; tone?: "ok" | "danger" }) {
  return (
    <AnimatePresence>
      {message ? (
        <motion.p
          key={message}
          className={`notice notice--${tone}`}
          role={tone === "danger" ? "alert" : "status"}
          initial={{ opacity: 0, y: -RISE }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DURATION.base, ease: EASE.out }}
        >
          {message}
        </motion.p>
      ) : null}
    </AnimatePresence>
  );
}

export function Panel({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="panel" aria-label={title}>
      <header className="panel__head">
        <h2 className="panel__title">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}
