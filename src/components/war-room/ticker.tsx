"use client";

import { useMemo, useState } from "react";
import { SOURCE_AGENT_IDS, type AgentEvent, type SourceAgentId } from "@/lib/schemas";
import { SOURCE_AGENTS } from "./meta";
import styles from "./styles";

const MAX_ITEMS = 14;
const IDLE_ITEMS = [
  "Awaiting signal",
  "5 source agents standing by",
  "Devpost · LinkedIn · GitHub · Scholar · Press",
  "Every finding carries a source link",
];

const isSource = (id: string): id is SourceAgentId => (SOURCE_AGENT_IDS as readonly string[]).includes(id);

/**
 * Scrolling feed of the newest finds across all agents. Pauses on hover and
 * via its own button (WCAG 2.2.2); under reduced motion it stops and becomes
 * a horizontally scrollable strip.
 */
export function Ticker({ events }: { events: AgentEvent[] }) {
  const [paused, setPaused] = useState(false);

  const items = useMemo(() => {
    const out: { id: string; agent: string | null; text: string; color: string }[] = [];
    for (let i = events.length - 1; i >= 0 && out.length < MAX_ITEMS; i--) {
      const e = events[i];
      if (e.found && isSource(e.agentId)) {
        const meta = SOURCE_AGENTS[e.agentId];
        out.push({ id: String(e.id), agent: meta.name, text: e.found, color: meta.bg });
      }
    }
    if (out.length) return out;
    return IDLE_ITEMS.map((text, i) => ({ id: `idle-${i}`, agent: null, text, color: "" }));
  }, [events]);

  const duration = `${Math.max(36, items.length * 7)}s`;
  const row = (hidden: boolean) => (
    <ul className="flex shrink-0 items-center" aria-hidden={hidden || undefined}>
      {items.map((it) => (
        <li key={it.id} className="flex items-center gap-3 pr-10 whitespace-nowrap">
          <span className="text-[color:var(--accent)]" aria-hidden>
            ◆
          </span>
          {it.agent && (
            <span className={`${styles.mono} text-sm font-semibold tracking-[0.14em] uppercase`} style={{ color: it.color }}>
              {it.agent}
            </span>
          )}
          <span className="text-lg text-[color:var(--text)]">{it.text}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <section
      aria-label="Live feed of agent finds"
      className={`relative z-10 flex items-center gap-4 border-y border-[color:var(--line)] bg-[color:var(--panel)] py-3 ${paused ? styles.tickerPaused : ""}`}
    >
      <span className="flex shrink-0 items-center gap-2 pl-6 2xl:pl-10">
        <span className="size-2 rounded-full bg-[color:var(--accent)] shadow-[0_0_10px_var(--accent)]" aria-hidden />
        <span className={`${styles.micro} !text-[color:var(--accent)]`}>Live feed</span>
      </span>
      <div className={`${styles.tickerViewport} min-w-0 flex-1`}>
        <div className={styles.tickerTrack} style={{ animationDuration: duration }}>
          {row(false)}
          {row(true)}
        </div>
      </div>
      <button
        type="button"
        onClick={() => setPaused((p) => !p)}
        aria-pressed={paused}
        className={`${styles.micro} mr-6 shrink-0 rounded-full border border-[color:var(--line)] px-3 py-1 hover:text-[color:var(--text)] 2xl:mr-10`}
      >
        {paused ? "Play" : "Pause"}
      </button>
    </section>
  );
}
