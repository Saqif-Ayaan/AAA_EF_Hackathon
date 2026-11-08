import type { ReactNode } from "react";
import styles from "./styles";

/** Small uppercase label. */
export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`${styles.label} ${className}`}>{children}</span>;
}

/** Section heading with an optional one-line subtitle and something on the right (e.g. a status pill). */
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
    <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h2 id={id} className={`${styles.display} text-5xl`}>
          {title}
        </h2>
        {sub && <p className="mt-2 text-lg text-[color:var(--muted)]">{sub}</p>}
      </div>
      {right}
    </header>
  );
}
