import type { ReactNode } from "react";
import styles from "./styles";

/** Small muted caption. */
export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`${styles.label} ${className}`}>{children}</span>;
}

/** Section heading with an optional one-line subtitle and something on the right (e.g. a status). */
export function SectionTitle({
  id,
  title,
  sub,
  right,
}: {
  id: string;
  title: string;
  sub?: string;
  right?: ReactNode;
}) {
  return (
    <header className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
      <div className="min-w-0">
        <h2 id={id} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {sub && <p className="mt-0.5 text-sm text-[color:var(--muted)]">{sub}</p>}
      </div>
      {right}
    </header>
  );
}
