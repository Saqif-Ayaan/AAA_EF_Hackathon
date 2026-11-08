/** Display metadata for the war room: names, colours, labels. No logic beyond formatting. */
import type {
  AgentStatus,
  Criterion,
  DiscrepancyType,
  FindingStatus,
  Resolution,
  SourceAgentId,
} from "@/lib/schemas";

/** Each source gets a small identity dot. */
export const SOURCE_AGENTS: Record<SourceAgentId, { name: string; via: string; color: string }> = {
  devpost: { name: "Devpost", via: "Profile + project pages", color: "#1fd0e6" },
  linkedin: { name: "LinkedIn", via: "Apify profile scraper", color: "#3d8bff" },
  github: { name: "GitHub", via: "GitHub REST API", color: "#e6edf3" },
  scholar: { name: "Scholar", via: "OpenAlex", color: "#b69cff" },
  press: { name: "Press", via: "Exa web search", color: "#ff7ac6" },
};

export type PillStatus = AgentStatus | "idle";

/** Colours may be CSS variables, so alpha is applied with color-mix (see `alpha`). */
export const AGENT_STATUS_STYLE: Record<PillStatus, { label: string; color: string; active: boolean }> = {
  idle: { label: "Waiting", color: "var(--dim)", active: false },
  queued: { label: "Queued", color: "var(--muted)", active: false },
  searching: { label: "Searching", color: "var(--accent)", active: true },
  reading: { label: "Reading", color: "var(--accent)", active: true },
  thinking: { label: "Thinking", color: "var(--accent)", active: true },
  done: { label: "Done", color: "#2ee68a", active: false },
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

/** Verdict colours stay semantic: green / amber / grey / red. */
export const LEDGER_STYLE: Record<LedgerStatus, { label: string; color: string; text: string }> = {
  corroborated: { label: "Corroborated", color: "#2ee68a", text: "#6af2ad" },
  partial: { label: "Partial", color: "#ffb224", text: "#ffc95c" },
  unverified: { label: "Unverified", color: "#8a9a93", text: "#c8d3ce" },
  contradicted: { label: "Contradicted", color: "#ff4d5e", text: "#ff8590" },
  pending: { label: "Checking", color: "var(--accent)", text: "var(--accent)" },
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
  reframed: { label: "Reframed", color: "#b69cff" },
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
