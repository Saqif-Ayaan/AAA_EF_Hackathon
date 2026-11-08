import { AGENT_STATUS_STYLE, alpha, type PillStatus } from "./meta";

/** Agent status: coloured dot + word. The dot pulses while the agent is working. */
export function StatusPill({ status }: { status: PillStatus }) {
  const s = AGENT_STATUS_STYLE[status];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1 text-base font-semibold"
      style={{ color: s.color, backgroundColor: alpha(s.color, 12) }}
    >
      <span
        className={`size-2.5 rounded-full ${s.active ? "motion-safe:animate-pulse" : ""}`}
        style={{ backgroundColor: s.color }}
        aria-hidden
      />
      {s.label}
    </span>
  );
}
