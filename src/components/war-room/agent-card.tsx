"use client";

import { useEffect, useRef } from "react";
import type { SourceAgentId } from "@/lib/schemas";
import type { AgentView } from "./derive";
import { Corners, Micro } from "./hud";
import { AGENT_STATUS_STYLE, SOURCE_AGENTS, alpha, formatElapsed, formatOffset, splitUrl } from "./meta";
import { StatusPill } from "./status-pill";
import styles from "./styles";

const FRESH_MS = 3000;

export function AgentCard({
  id,
  view,
  now,
  caseStart,
}: {
  id: SourceAgentId;
  view: AgentView;
  now: number;
  caseStart: number | null;
}) {
  const meta = SOURCE_AGENTS[id];
  const status = AGENT_STATUS_STYLE[view.status];
  const done = view.status === "done";
  const elapsed = view.startedAt === null ? null : (view.endedAt ?? now) - view.startedAt;

  // Keep the newest find in view.
  const logRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [view.finds.length]);

  return (
    <article
      aria-label={`${meta.name} agent, ${status.label}, ${view.progress}%`}
      className={`${styles.panel} ${styles.hoverLift} flex h-[clamp(430px,50vh,560px)] min-w-0 flex-col gap-3 p-5`}
      style={{
        borderColor: status.active ? alpha(status.color, 45) : undefined,
        boxShadow: status.active ? `0 0 46px -18px ${alpha(status.color, 80)}` : undefined,
      }}
    >
      <Corners color={status.active ? status.color : done ? alpha("var(--text)", 55) : alpha("var(--dim)", 60)} />

      <div className="flex items-center justify-between gap-2">
        <Micro className="min-w-0 truncate">
          {meta.code} <span className="opacity-60">{"//"}</span> {meta.via}
        </Micro>
        <Micro className="shrink-0 tabular-nums">{elapsed === null ? "--:--" : formatElapsed(elapsed)}</Micro>
      </div>

      <header className="flex items-center gap-3.5">
        <div
          className={`${styles.hex} ${styles.mono} grid h-14 w-16 shrink-0 place-items-center text-xl font-bold`}
          style={{ backgroundColor: meta.bg, color: meta.fg }}
          aria-hidden
        >
          {meta.monogram}
        </div>
        <h3 className={`${styles.display} min-w-0 truncate text-[2.75rem]`}>{meta.name}</h3>
      </header>

      <div className="flex items-end justify-between gap-2">
        <StatusPill status={view.status} />
        <span className={`${styles.display} text-6xl tabular-nums`} style={{ color: status.active ? status.color : undefined }}>
          {view.progress}
          <span className="text-3xl text-[color:var(--muted)]">%</span>
        </span>
      </div>

      <div
        className={`${styles.segTrack} h-3.5`}
        role="progressbar"
        aria-valuenow={view.progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${meta.name} progress`}
      >
        <div
          className={`${styles.segFill} ${status.active ? styles.segActive : ""}`}
          style={{
            width: `${view.progress}%`,
            backgroundColor: done ? "var(--text)" : status.active ? status.color : "var(--dim)",
          }}
        />
      </div>

      <p className="line-clamp-2 min-h-[3.5rem] text-xl leading-snug font-medium">
        {view.currentAction ?? <span className="text-[color:var(--dim)]">Standing by for claims…</span>}
      </p>

      {done ? (
        <div className={`${styles.mono} flex h-12 items-center gap-2 border border-[color:var(--line)] px-3 text-base text-[color:var(--text)]`}>
          <span aria-hidden>✓</span> Done · {view.pagesRead} {view.pagesRead === 1 ? "page" : "pages"} read
        </div>
      ) : (
        <CurrentUrl url={view.url} active={status.active} searching={view.status === "searching"} color={status.color} />
      )}

      <div className="flex min-h-0 flex-1 flex-col border-t border-[color:var(--line)] pt-2.5">
        <Micro className="mb-1.5">Finds · {String(view.finds.length).padStart(2, "0")}</Micro>
        <ol ref={logRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1">
          {view.finds.map((f) => (
            <li key={f.id} className={now - f.at < FRESH_MS ? styles.enter : undefined}>
              <p className="flex gap-2.5 text-lg leading-snug">
                <span className={`${styles.mono} shrink-0 pt-0.5 text-sm tabular-nums`} style={{ color: meta.bg }}>
                  {caseStart === null ? "▸" : formatOffset(f.at - caseStart)}
                </span>
                <span>{f.text}</span>
              </p>
              {f.url && (
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${styles.mono} ml-[3.6rem] block truncate text-sm text-[color:var(--accent)] opacity-85 hover:underline hover:opacity-100`}
                  title={f.url}
                >
                  {shortUrl(f.url)}
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

/** "Lock-on" readout for the page being read. */
function CurrentUrl({
  url,
  active,
  searching,
  color,
}: {
  url: string | null;
  active: boolean;
  searching: boolean;
  color: string;
}) {
  if (!url) {
    return (
      <div className={`${styles.mono} flex h-12 items-center gap-2 border border-dashed border-[color:var(--line)] px-3 text-base text-[color:var(--dim)]`}>
        {searching ? "⌕ Scanning the web — no page locked" : active ? "Processing — no page locked" : "No target"}
      </div>
    );
  }
  const { host, rest } = splitUrl(url);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={url}
      className="group relative flex h-12 min-w-0 items-center gap-3 border px-3 transition-colors"
      style={{ borderColor: active ? alpha(color, 45) : "var(--line)", backgroundColor: active ? alpha(color, 7) : undefined }}
    >
      <span className={`${styles.micro} shrink-0`} style={{ color: active ? color : undefined }}>
        {active ? "◎ Lock" : "Last"}
      </span>
      <span className={`${styles.mono} truncate text-base group-hover:underline`}>
        <span className="text-[color:var(--text)]">{host}</span>
        <span className="text-[color:var(--muted)]">{rest}</span>
      </span>
    </a>
  );
}
