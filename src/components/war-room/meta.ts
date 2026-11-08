/** Display metadata for the war room: names, colours, labels. No logic beyond formatting. */
import type {
  AgentStatus,
  Criterion,
  DiscrepancyType,
  FindingStatus,
  Resolution,
  SourceAgentId,
} from "@/lib/schemas";

/** Each source keeps its own identity colour regardless of the accent palette. */
export const SOURCE_AGENTS: Record<
  SourceAgentId,
  { code: string; name: string; via: string; monogram: string; bg: string; fg: string }
> = {
  devpost: { code: "AGT-01", name: "Devpost", via: "Profile + project pages", monogram: "DP", bg: "#1fd0e6", fg: "#03181c" },
  linkedin: { code: "AGT-02", name: "LinkedIn", via: "Apify profile scraper", monogram: "in", bg: "#3d8bff", fg: "#020c1d" },
  github: { code: "AGT-03", name: "GitHub", via: "GitHub REST API", monogram: "GH", bg: "#eef3f1", fg: "#0b100e" },
  scholar: { code: "AGT-04", name: "Scholar", via: "OpenAlex", monogram: "OA", bg: "#b69cff", fg: "#150a33" },
  press: { code: "AGT-05", name: "Press", via: "Exa web search", monogram: "PR", bg: "#ff7ac6", fg: "#2c0618" },
};

export type PillStatus = AgentStatus | "idle";

/** Colours may be CSS variables, so alpha is applied with color-mix (see `alpha`). */
export const AGENT_STATUS_STYLE: Record<PillStatus, { label: string; color: string; active: boolean }> = {
  idle: { label: "Standby", color: "var(--dim)", active: false },
  queued: { label: "Queued", color: "var(--muted)", active: false },
  searching: { label: "Searching", color: "var(--accent)", active: true },
  reading: { label: "Reading", color: "var(--accent-2)", active: true },
  thinking: { label: "Thinking", color: "var(--accent-2)", active: true },
  done: { label: "Complete", color: "var(--text)", active: false },
  error: { label: "Error", color: "#ff4d5e", active: false },
};

export const CRITERION_LABEL: Record<Criterion, string> = {
  awards: "Awards",
  membership: "Membership",
  press: "Press",
  judging: "Judging",
  contributions: "Original contributions",
  scholarly: "Scholarly articles",
  critical_role: "Critical role",
  remuneration: "High remuneration",
};

export type LedgerStatus = FindingStatus | "pending" | "queued";

/** Verdict colours stay semantic (green/amber/grey/red) whatever the accent palette is. */
export const LEDGER_STYLE: Record<LedgerStatus, { label: string; color: string; text: string }> = {
  corroborated: { label: "Corroborated", color: "#2ee68a", text: "#6af2ad" },
  partial: { label: "Partial", color: "#ffb224", text: "#ffc95c" },
  unverified: { label: "Unverified", color: "#8a9a93", text: "#c8d3ce" },
  contradicted: { label: "Contradicted", color: "#ff4d5e", text: "#ff8590" },
  pending: { label: "Checking…", color: "var(--accent)", text: "var(--accent)" },
  queued: { label: "Queued", color: "#3d4a45", text: "#a3b3ac" },
};

export const DISCREPANCY_LABEL: Record<DiscrepancyType, string> = {
  numerical: "Numbers differ",
  identity: "Identity",
  evidence: "Contradicting evidence",
  insufficient_proof: "Needs documents",
  criterion_fit: "Criterion fit",
};

export const RESOLUTION_STYLE: Record<Resolution, { label: string; color: string }> = {
  open: { label: "Open", color: "#ffb224" },
  amended: { label: "Amended", color: "var(--accent)" },
  substantiated: { label: "Substantiated", color: "#2ee68a" },
  reframed: { label: "Reframed", color: "var(--accent-2)" },
  escalated: { label: "Escalated", color: "#ff4d5e" },
};

/** `color` at `pct`% opacity. Works for hex values and CSS variables alike. */
export const alpha = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

/** "https://www.example.com/a/b?c" → { host: "example.com", rest: "/a/b?c" }. */
export function splitUrl(url: string): { host: string; rest: string } {
  try {
    const u = new URL(url);
    const rest = `${u.pathname === "/" ? "" : u.pathname}${u.search}${u.hash}`;
    return { host: u.hostname.replace(/^www\./, ""), rest: decodeURIComponent(rest) };
  } catch {
    return { host: url, rest: "" };
  }
}

/** Milliseconds → "m:ss". */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Milliseconds since case start → "T+09.5". */
export function formatOffset(ms: number): string {
  const s = Math.max(0, ms / 1000);
  return `T+${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}
