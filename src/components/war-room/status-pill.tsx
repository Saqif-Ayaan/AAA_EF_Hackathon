import { AGENT_STATUS_STYLE, alpha, type PillStatus } from "./meta";
import styles from "./styles";

/** Agent status pill. The dot pings while the agent is actively working. */
export function StatusPill({ status, size = "lg" }: { status: PillStatus; size?: "lg" | "md" }) {
  const s = AGENT_STATUS_STYLE[status];
  return (
    <span
      className={`${styles.mono} inline-flex items-center gap-2.5 rounded-full border font-semibold tracking-[0.14em] uppercase ${
        size === "lg" ? "px-4 py-1.5 text-base" : "px-3 py-1 text-sm"
      }`}
      style={{
        color: s.color,
        borderColor: alpha(s.color, 45),
        backgroundColor: alpha(s.color, 10),
        boxShadow: s.active ? `0 0 18px -4px ${alpha(s.color, 70)}` : undefined,
      }}
    >
      <span className="relative flex size-2.5">
        {s.active && (
          <span
            className="absolute inline-flex size-full rounded-full opacity-75 motion-safe:animate-ping"
            style={{ backgroundColor: s.color }}
          />
        )}
        <span className="relative inline-flex size-2.5 rounded-full" style={{ backgroundColor: s.color }} />
      </span>
      {s.label}
    </span>
  );
}
