"use client";

import { useEffect, useRef } from "react";
import type { SourceAgentId } from "@/lib/schemas";
import type { AgentView } from "./derive";
import { AGENT_STATUS_STYLE, SOURCE_AGENTS, splitUrl } from "./meta";
import { StatusPill } from "./status-pill";
import styles from "./styles";
import { Label } from "./ui";

const FRESH_MS = 3000;

export function AgentCard({ id, view, now }: { id: SourceAgentId; view: AgentView; now: number }) {
  const meta = SOURCE_AGENTS[id];
  const status = AGENT_STATUS_STYLE[view.status];
  const done = view.status === "done";

  // Bring the newest find into view, from its first line (not its last).
  const logRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = logRef.current;
    const newest = el?.lastElementChild as HTMLElement | null | undefined;
    if (el && newest) el.scrollTo({ top: newest.offsetTop, behavior: "smooth" });
  }, [view.finds.length]);

  return (
    <article
      aria-label={`${meta.name} agent, ${status.label}, ${view.progress}%`}
      className={`${styles.panel} flex max-h-[28rem] min-w-0 flex-col gap-3 p-4 xl:h-[26rem] xl:max-h-none`}
    >
      <header className="flex items-center justify-between gap-3">
        <h3 className="flex min-w-0 items-center gap-2 text-base font-semibold" title={meta.via}>
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} aria-hidden />
          <span className="truncate">{meta.name}</span>
        </h3>
        <StatusPill status={view.status} />
      </header>

      <div
        className={`${styles.bar} h-1`}
        role="progressbar"
        aria-valuenow={view.progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${meta.name} progress`}
      >
        <div
          className={styles.barFill}
          style={{ width: `${view.progress}%`, backgroundColor: done ? "#15803d" : "var(--ink)" }}
        />
      </div>

      <p className="line-clamp-2 min-h-[2.5rem] text-sm leading-snug text-[color:var(--muted)]">
        {view.currentAction ?? <span className="text-[color:var(--dim)]">Waiting for claims…</span>}
      </p>

      <div className="h-5 min-w-0">
        {view.url && !done ? (
          <a
            href={view.url}
            target="_blank"
            rel="noopener noreferrer"
            title={view.url}
            className={`${styles.mono} block truncate text-xs text-[color:var(--accent)] hover:underline`}
          >
            {shortUrl(view.url)}
          </a>
        ) : (
          <p className="text-xs text-[color:var(--dim)]">
            {done ? `${view.pagesRead} ${view.pagesRead === 1 ? "page" : "pages"} read` : ""}
          </p>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col border-t border-[color:var(--line)] pt-3">
        <Label className="mb-2">Findings · {view.finds.length}</Label>
        <ol ref={logRef} className="relative min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {view.finds.map((f) => (
            <li key={f.id} className={now - f.at < FRESH_MS ? styles.enter : undefined}>
              <p className={`text-sm leading-snug ${f.detail ? "font-medium" : ""}`}>{f.text}</p>
              {f.detail && <p className="mt-1 text-sm leading-snug text-[color:var(--muted)]">{f.detail}</p>}
              {f.url && (
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={f.url}
                  className={`${styles.mono} mt-1 inline-block text-xs text-[color:var(--dim)] hover:text-[color:var(--accent)] hover:underline`}
                >
                  {splitUrl(f.url).host}
                </a>
              )}
            </li>
          ))}
        </ol>
      </div>
    </article>
  );
}

function shortUrl(url: string) {
  const { host, rest } = splitUrl(url);
  return host + rest;
}
