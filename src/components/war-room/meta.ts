/** Display metadata for the war room: names, colours, labels. No logic beyond formatting. */
import type {
  AgentMode,
  AgentStatus,
  Criterion,
  DiscrepancyType,
  FindingStatus,
  HypothesisResult,
  InvestigatorId,
  Resolution,
} from "@/lib/schemas";

/** Each source gets a small identity dot. `patents` and `wages` only work in investigate mode (PART 3). */
export const SOURCE_AGENTS: Record<InvestigatorId, { name: string; via: string; color: string }> = {
  devpost: { name: "Devpost", via: "Profile + project pages", color: "#0e8aa0" },
  linkedin: { name: "LinkedIn", via: "Apify profile scraper", color: "#3b6fd4" },
  github: { name: "GitHub", via: "GitHub REST API + npm / PyPI downloads", color: "var(--muted)" },
  scholar: { name: "Scholar", via: "OpenAlex", color: "var(--violet)" },
  press: { name: "Press", via: "Exa web search", color: "#c4488f" },
  patents: { name: "Patents", via: "Google Patents forward citations", color: "#b8860b" },
  wages: { name: "Wages", via: "DOL OFLC prevailing wages (code only)", color: "var(--ok)" },
};

/** The phase label on an agent card. */
export const MODE_LABEL: Record<AgentMode, string> = {
  verify: "Verifying claims",
  investigate: "Investigating",
};

/** Status chip for a sceptic failure mode after investigation. */
export const HYPOTHESIS_STYLE: Record<HypothesisResult, { label: string; color: string; text: string }> = {
  confirmed: { label: "Confirmed", color: "var(--bad)", text: "var(--bad-text)" },
  cleared: { label: "Cleared", color: "var(--ok)", text: "var(--ok-text)" },
  still_unknown: { label: "Open", color: "var(--warn)", text: "var(--warn-text)" },
};

export type PillStatus = AgentStatus | "idle";

/** Colours may be CSS variables, so alpha is applied with color-mix (see `alpha`). */
export const AGENT_STATUS_STYLE: Record<PillStatus, { label: string; color: string; active: boolean }> = {
  idle: { label: "Waiting", color: "var(--dim)", active: false },
  queued: { label: "Queued", color: "var(--muted)", active: false },
  searching: { label: "Searching", color: "var(--accent)", active: true },
  reading: { label: "Reading", color: "var(--accent)", active: true },
  thinking: { label: "Thinking", color: "var(--accent)", active: true },
  done: { label: "Done", color: "var(--ok)", active: false },
  error: { label: "Error", color: "var(--bad)", active: false },
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
  corroborated: { label: "Corroborated", color: "var(--ok)", text: "var(--ok-text)" },
  partial: { label: "Partial", color: "var(--warn)", text: "var(--warn-text)" },
  unverified: { label: "Unverified", color: "var(--dim)", text: "var(--muted)" },
  contradicted: { label: "Contradicted", color: "var(--bad)", text: "var(--bad-text)" },
  pending: { label: "Checking", color: "var(--accent)", text: "var(--accent)" },
  queued: { label: "Queued", color: "var(--dim)", text: "var(--dim)" },
};

export const DISCREPANCY_LABEL: Record<DiscrepancyType, string> = {
  numerical: "Numbers differ",
  identity: "Identity",
  evidence: "Contradicting evidence",
  insufficient_proof: "Needs documents",
  criterion_fit: "Criterion fit",
  failure_mode: "Failure mode",
};

export const RESOLUTION_STYLE: Record<Resolution, { label: string; color: string }> = {
  open: { label: "Open", color: "var(--warn)" },
  amended: { label: "Amended", color: "var(--accent)" },
  substantiated: { label: "Substantiated", color: "var(--ok)" },
  reframed: { label: "Reframed", color: "var(--violet)" },
  escalated: { label: "Escalated", color: "var(--bad)" },
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
