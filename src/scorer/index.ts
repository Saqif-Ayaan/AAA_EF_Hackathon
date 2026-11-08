/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  SCORING AGENT — the one file the scorer owner edits.  See SCORER.md.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Called after "Build case" (and by `npm run score <applicantId>`) with the
 * full CaseBundle: applicant, claims, findings, discrepancies with their
 * resolutions, the sceptic's investigated failure modes (hypotheses) and the
 * built case (dossier). Return a score, or null if there is no score yet.
 *
 * The app validates what you return (ScoreInputSchema: both numbers 0–100),
 * adds the id, caseId and createdAt, saves it, and shows it on the dashboard
 * and in the lawyer's dossier (the PDF, the last step).
 *
 * Default scorer: deterministic, built on the final decision (src/lib/decision.ts)
 * from verification + the sceptic RAG + the investigation. No API calls, so
 * the same bundle always gets the same score, and every point is explained in
 * `reasoning`. It inherits the decision's LAX rule: evidence is dropped only on
 * high-confidence proof it is invalid; everything else passes, and doubts only
 * raise the RFE risk. Replace or tune freely; the weights are in WEIGHTS.
 */
import { decide } from "../lib/decision";
import { CRITERION_LABELS } from "../lib/labels";
import type { CaseBundle, ScoreInput } from "../lib/schemas";

const WEIGHTS = {
  /** Approval likelihood with exactly 3 criteria counted. */
  baseAtThreshold: 50,
  /** + per criterion counted beyond 3 (capped at 3 extra). */
  perExtraCriterion: 7,
  /** + per criterion with nothing open (capped at 5). */
  perClearCriterion: 4,
  /** − per high-confidence contradiction (a credibility problem for the whole petition). */
  perContradiction: 8,
  /** − per piece of evidence that passed despite an unconfirmed doubt. */
  perCaution: 3,
  /** − per follow-up question still open or escalated to an attorney. */
  perOpenQuestion: 2,
  /** Below 3 criteria: likelihood = belowBase + belowPerCriterion × counted. */
  belowBase: 10,
  belowPerCriterion: 8,

  rfeBase: 20,
  rfePerOpenCriterion: 9,
  rfePerCaution: 6,
  rfePerOpenQuestion: 5,
  rfePerContradiction: 10,
  /** + when the case rests on exactly 3 criteria (no margin if one falls). */
  rfeAtThreshold: 15,
  /** − per clear criterion beyond 3. */
  rfePerSpareClear: 3,
  /** RFE risk floor when fewer than 3 criteria count. */
  rfeFloorBelow: 70,
} as const;

const clamp = (n: number, lo = 5, hi = 95) => Math.round(Math.min(hi, Math.max(lo, n)));

export async function scoreCase(bundle: CaseBundle): Promise<ScoreInput | null> {
  if (bundle.claims.length === 0) return null;
  const W = WEIGHTS;
  const d = decide({ claims: bundle.claims, findings: bundle.findings, hypotheses: bundle.hypotheses });

  const counted = d.criteriaCounted;
  const clear = d.criteria.filter((c) => c.status === "clear").length;
  const open = d.criteria.filter((c) => c.status === "open").length;
  const openQuestions = bundle.discrepancies.filter((q) => q.resolution === "open" || q.resolution === "escalated").length;

  let approval: number;
  let rfe =
    W.rfeBase +
    W.rfePerOpenCriterion * open +
    W.rfePerCaution * d.passedWithCaution +
    W.rfePerOpenQuestion * openQuestions +
    W.rfePerContradiction * d.contradictedClaims;
  if (counted >= d.criteriaNeeded) {
    approval =
      W.baseAtThreshold +
      W.perExtraCriterion * Math.min(3, counted - d.criteriaNeeded) +
      W.perClearCriterion * Math.min(5, clear) -
      W.perContradiction * d.contradictedClaims -
      W.perCaution * d.passedWithCaution -
      W.perOpenQuestion * openQuestions;
    if (counted === d.criteriaNeeded) rfe += W.rfeAtThreshold;
    rfe -= W.rfePerSpareClear * Math.max(0, clear - d.criteriaNeeded);
  } else {
    approval = W.belowBase + W.belowPerCriterion * counted;
    rfe = Math.max(rfe, W.rfeFloorBelow);
  }

  const label = (c: (typeof d.criteria)[number]) => CRITERION_LABELS[c.criterion];
  const byStatus = (s: "clear" | "open" | "flagged") => d.criteria.filter((c) => c.status === s).map(label);
  const lines = [
    `${d.routing === "to_lawyer" ? "Route: to a lawyer." : "Route: needs more evidence."} ${d.summary}`,
    byStatus("clear").length ? `Counting with nothing open: ${byStatus("clear").join(", ")}.` : "",
    byStatus("open").length ? `Counting, with open points: ${byStatus("open").join(", ")}.` : "",
    byStatus("flagged").length ? `Not counting (dropped on high-confidence evidence): ${byStatus("flagged").join(", ")}.` : "",
    d.passedWithCaution
      ? `${d.passedWithCaution} item(s) passed despite a doubt we couldn't confirm (we only drop evidence when highly confident it is invalid); they raise the RFE risk.`
      : "",
    d.rescued ? `${d.rescued} failure mode(s) flagged from past AAO denials were cleared by the investigation.` : "",
    d.contradictedClaims ? `${d.contradictedClaims} claim(s) contradicted by a cited source: a credibility risk to address before filing.` : "",
    openQuestions ? `${openQuestions} follow-up question(s) still open or escalated.` : "",
    "Readiness estimate from verified evidence and past AAO reasoning, not legal advice or a prediction of the outcome.",
  ];
  return {
    approvalLikelihood: clamp(approval),
    rfeRisk: clamp(rfe),
    reasoning: lines.filter(Boolean).join(" "),
  };
}
