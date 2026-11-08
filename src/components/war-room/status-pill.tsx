import { AGENT_STATUS_STYLE, type PillStatus } from "./meta";

/** Agent status: a small dot and a word. The dot pulses while the agent is working. */
export function StatusPill({ status }: { status: PillStatus }) {
  const s = AGENT_STATUS_STYLE[status];
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-sm text-[color:var(--muted)]">
      <span
        className={`size-2 rounded-full ${s.active ? "motion-safe:animate-pulse" : ""}`}
        style={{ backgroundColor: s.color }}
        aria-hidden
      />
      {s.label}
    </span>
  );
}
