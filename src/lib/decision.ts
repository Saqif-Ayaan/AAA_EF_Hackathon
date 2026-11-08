/**
 * The final routing decision (PART 3 §1, "buildCase → route"): after
 * verification, the sceptic and the investigation, does the case go to a
 * lawyer or does the applicant need more evidence?
 *
 * LAX BY DESIGN. Wrongly passing a weak case costs a lawyer a few minutes;
 * wrongly dropping a strong one loses a client. So a piece of evidence is
 * DROPPED only when we are highly confident it is invalid:
 *   - verification CONTRADICTED it, with identityConfidence ≥ HIGH_CONFIDENCE
 *     (a cited source shows the claim is false, and it is about this person); or
 *   - the investigation CONFIRMED a sceptic failure mode on it, relying on a
 *     sourced, measured value about this person with identityConfidence ≥
 *     HIGH_CONFIDENCE (e.g. 0 forward citations on Google Patents).
 * Everything else PASSES: a sceptic "applies" the investigation couldn't
 * confirm, a low-confidence contradiction, unverified evidence. Those pass
 * "with caution" and show up as open points for the lawyer.
 *
 * A criterion counts if at least one of its evidence items passes. It is
 * "clear" if one of those has nothing open, "open" otherwise, and "flagged"
 * if every item was dropped. 3+ criteria counted → to_lawyer.
 *
 * Pure (no database), so the pipeline, the scorer, the dashboard and the
 * dossier all compute exactly the same decision. Not legal advice.
 */
import { CRITERIA, type Criterion, type FindingStatus, type HypothesisResult, type QueueStatus } from "./schemas";

export const CRITERIA_NEEDED = 3;
/** How sure we must be that evidence is invalid (and about this applicant) before dropping it. */
export const HIGH_CONFIDENCE = 0.8;

type ClaimLike = { id: string; criterion: Criterion; summary: string };
type FindingLike = { claimId: string; status: FindingStatus; identityConfidence: number };
type MeasurementLike = { value: number | string | null; identityConfidence: number; sources: unknown[] };
type HypothesisLike = {
  hypothesisId: string;
  claimId: string;
  criterion: Criterion;
  failureMode: string;
  result: HypothesisResult;
  queueStatusBefore: "applies" | "unknown";
  queueStatusAfter: QueueStatus;
  measurements: MeasurementLike[];
  reliedOn: number[];
  hypothesis: { precedent: { caseId: string } };
};

export type CriterionDecision = {
  criterion: Criterion;
  status: "clear" | "open" | "flagged";
  counted: boolean;
  /** Plain-English reasons, one per evidence item. */
  reasons: string[];
};

export type FinalDecision = {
  routing: "to_lawyer" | "needs_more_evidence";
  criteriaCounted: number;
  criteriaNeeded: number;
  criteria: CriterionDecision[];
  /** Evidence dropped with high confidence. */
  dropped: number;
  /** Evidence that passed despite a doubt we couldn't confirm (the lax rule at work). */
  passedWithCaution: number;
  /** Failure modes the investigation cleared, though the sceptic had flagged them as `applies`. */
  rescued: number;
  /** High-confidence contradictions (a credibility risk for the whole petition). */
  contradictedClaims: number;
  /** One or two sentences for the dashboard, the scorer and the lawyer. */
  summary: string;
};

/** Confirmed by a sourced, measured value that is confidently about this applicant. */
export function confirmedWithHighConfidence(h: HypothesisLike): boolean {
  return (
    h.result === "confirmed" &&
    h.reliedOn.some((i) => {
      const m = h.measurements[i];
      return m && m.value !== null && m.sources.length > 0 && m.identityConfidence >= HIGH_CONFIDENCE;
    })
  );
}

const plain = (s: string) => s.replace(/\.$/, "");

export function decide(input: { claims: ClaimLike[]; findings: FindingLike[]; hypotheses: HypothesisLike[] }): FinalDecision {
  const findingOf = new Map(input.findings.map((f) => [f.claimId, f]));
  const criteria: CriterionDecision[] = [];
  let dropped = 0;
  let passedWithCaution = 0;
  let contradictedClaims = 0;

  for (const criterion of CRITERIA) {
    const items = input.claims.filter((c) => c.criterion === criterion);
    if (items.length === 0) continue;
    const reasons: string[] = [];
    let passing = 0;
    let clear = 0;
    for (const c of items) {
      const f = findingOf.get(c.id);
      const hyps = input.hypotheses.filter((h) => h.claimId === c.id);

      // Drop only with high confidence.
      if (f?.status === "contradicted" && f.identityConfidence >= HIGH_CONFIDENCE) {
        dropped++;
        contradictedClaims++;
        reasons.push(`"${c.summary}": dropped — a cited source shows it is not accurate.`);
        continue;
      }
      const confirmed = hyps.find(confirmedWithHighConfidence);
      if (confirmed) {
        dropped++;
        reasons.push(`"${c.summary}": dropped — investigation confirmed: ${plain(confirmed.failureMode)} (as in ${confirmed.hypothesis.precedent.caseId}).`);
        continue;
      }

      // Otherwise it passes; note anything still open.
      passing++;
      const open: string[] = [];
      const cautions: string[] = [];
      if (f?.status === "contradicted") cautions.push("a source may contradict it, but we couldn't tie that source to the applicant with confidence");
      for (const h of hyps) {
        if (h.queueStatusAfter === "does_not_apply") continue;
        if (h.result === "confirmed" || h.queueStatusBefore === "applies") cautions.push(`possible weakness not confirmed: ${plain(h.failureMode)}`);
        else open.push(`open question: ${plain(h.failureMode)}`);
      }
      if (f?.status === "unverified") open.push("not verified online yet");
      if (f?.status === "partial") open.push("only partly verified");
      if (cautions.length) passedWithCaution++;
      if (open.length === 0 && cautions.length === 0) clear++;
      const cleared = hyps.filter((h) => h.queueStatusAfter === "does_not_apply").length;
      const notes = [...cautions, ...open];
      reasons.push(
        `"${c.summary}": counts${notes.length ? ` (${notes.join("; ")})` : ""}${cleared ? `; ${cleared} failure mode(s) cleared by investigation` : ""}.`,
      );
    }
    const status = passing === 0 ? "flagged" : clear > 0 ? "clear" : "open";
    criteria.push({ criterion, status, counted: status !== "flagged", reasons });
  }

  const counted = criteria.filter((c) => c.counted).length;
  const rescued = input.hypotheses.filter((h) => h.queueStatusBefore === "applies" && h.queueStatusAfter === "does_not_apply").length;
  const routing = counted >= CRITERIA_NEEDED ? "to_lawyer" : "needs_more_evidence";
  const open = criteria.filter((c) => c.status === "open").length;
  const flagged = criteria.filter((c) => c.status === "flagged").length;
  const summary =
    routing === "to_lawyer"
      ? `${counted} criteria still count (${CRITERIA_NEEDED} needed)${open ? `, ${open} with open points` : ""}: ready for a lawyer's review.`
      : `Only ${counted} criteria still count; ${CRITERIA_NEEDED} are needed${flagged ? ` (${flagged} dropped on high-confidence evidence)` : ""}. The applicant needs more evidence first.`;
  return { routing, criteriaCounted: counted, criteriaNeeded: CRITERIA_NEEDED, criteria, dropped, passedWithCaution, rescued, contradictedClaims, summary };
}
