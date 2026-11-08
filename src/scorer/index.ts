/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  SCORING AGENT — the one file the scorer owner edits.  See SCORER.md.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Called after "Build case" (and by `npm run score <applicantId>`) with the
 * full CaseBundle: applicant, claims, findings, discrepancies with their
 * resolutions, and the built case (dossier). Return a score, or null if there
 * is no score yet.
 *
 * The app validates what you return (ScoreInputSchema: both numbers 0–100),
 * adds the id, caseId and createdAt, saves it, and shows it on the dashboard.
 */
import type { CaseBundle, ScoreInput } from "../lib/schemas";

export async function scoreCase(bundle: CaseBundle): Promise<ScoreInput | null> {
  // ┌───────────────────────────────────────────────────────────────────────┐
  // │ PLACEHOLDER — replace this with the real scoring agent.               │
  // │ Returning null makes the dashboard show "Awaiting score".             │
  // │ Return { approvalLikelihood, rfeRisk, reasoning } when it's ready.    │
  // └───────────────────────────────────────────────────────────────────────┘
  void bundle;
  return null;
}
