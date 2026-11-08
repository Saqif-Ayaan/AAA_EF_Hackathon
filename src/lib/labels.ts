/** Human-readable names for the enum values in schemas.ts. */
import type { CITATION_SOURCES, Criterion, PRESS_FOCUS, Resolution } from "./schemas";

export const RESOLUTION_LABELS: Record<Resolution, string> = {
  open: "Open",
  amended: "Amended",
  substantiated: "Substantiated",
  reframed: "Reframed",
  escalated: "Escalated to an attorney",
};

export const CRITERION_LABELS: Record<Criterion, string> = {
  awards: "Awards",
  membership: "Memberships",
  press: "Press",
  judging: "Judging",
  contributions: "Original contributions",
  scholarly: "Scholarly articles",
  critical_role: "Critical role",
  remuneration: "High remuneration",
};

export const PRESS_FOCUS_LABELS: Record<(typeof PRESS_FOCUS)[number], string> = {
  me: "It's about me",
  my_company: "It's about my company",
  brief_mention: "I'm briefly mentioned",
};

export const CITATION_SOURCE_LABELS: Record<(typeof CITATION_SOURCES)[number], string> = {
  google_scholar: "Google Scholar",
  semantic_scholar: "Semantic Scholar",
  other: "Other",
};
