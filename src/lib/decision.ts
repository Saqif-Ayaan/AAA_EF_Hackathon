/**
 * The final routing decision (PART 3 §1, "buildCase → route"): after
 * verification, the sceptic and the investigation, does the case go to a
 * lawyer or does the applicant need more evidence?
 *
 * Same lax rule as the sceptic's queue summary (rag/src/run.py summarise()),
 * with what verification and investigation learned folded in:
 *   - A piece of evidence (claim) still counts unless verification contradicted
 *     it, or a sceptic failure mode on it is `applies` after investigation
 *     (confirmed, or flagged by the sceptic and not rescued).
 *   - A criterion counts if at least one of its evidence items still counts.
 *     It is "clear" if one of those has nothing open, "open" if every one still
 *     has an open question (an unknown failure mode, or unverified/partial
 *     evidence), and "flagged" if none still counts.
 *   - 3 or more criteria counted → to_lawyer; fewer → needs_more_evidence.
 *
 * Pure (no database), so the pipeline, the CLI and the dashboard all compute
 * exactly the same decision. Not legal advice: a lawyer makes the real call.
 */
import { CRITERIA, type Criterion, type FindingStatus, type HypothesisResult, type QueueStatus } from "./schemas";

export const CRITERIA_NEEDED = 3;

type ClaimLike = { id: string; criterion: Criterion; summary: string };
type FindingLike = { claimId: string; status: FindingStatus };
type HypothesisLike = {
  hypothesisId: string;
  claimId: string;
  criterion: Criterion;
  failureMode: string;
  result: HypothesisResult;
  queueStatusBefore: "applies" | "unknown";
  queueStatusAfter: QueueStatus;
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
  /** Failure modes the investigation cleared, though the sceptic had flagged them as `applies`. */
  rescued: number;
  contradictedClaims: number;
  /** One or two sentences for the dashboard and the lawyer. */
  summary: string;
};

export function decide(input: { claims: ClaimLike[]; findings: FindingLike[]; hypotheses: HypothesisLike[] }): FinalDecision {
  const findingOf = new Map(input.findings.map((f) => [f.claimId, f.status]));
  const criteria: CriterionDecision[] = [];

  for (const criterion of CRITERIA) {
    const items = input.claims.filter((c) => c.criterion === criterion);
    if (items.length === 0) continue;
    const reasons: string[] = [];
    let surviving = 0;
    let clear = 0;
    for (const c of items) {
      const status = findingOf.get(c.id);
      const hyps = input.hypotheses.filter((h) => h.claimId === c.id);
      const applies = hyps.filter((h) => h.queueStatusAfter === "applies");
      const unknown = hyps.filter((h) => h.queueStatusAfter === "unknown");
      if (status === "contradicted") {
        reasons.push(`"${c.summary}": a source contradicts it.`);
        continue;
      }
      if (applies.length) {
        const h = applies[0];
        reasons.push(`"${c.summary}": ${h.failureMode.replace(/\.$/, "")} (${h.result === "confirmed" ? "confirmed by investigation" : "flagged by the sceptic"}, as in ${h.hypothesis.precedent.caseId}).`);
        continue;
      }
      surviving++;
      const open = [
        ...unknown.map((h) => `open question: ${h.failureMode.replace(/\.$/, "")}`),
        ...(status === "unverified" ? ["not verified online yet"] : status === "partial" ? ["only partly verified"] : []),
      ];
      if (open.length === 0) clear++;
      const cleared = hyps.filter((h) => h.queueStatusAfter === "does_not_apply").length;
      reasons.push(
        `"${c.summary}": counts${open.length ? ` (${open.join("; ")})` : ""}${cleared ? `; ${cleared} failure mode(s) cleared by investigation` : ""}.`,
      );
    }
    const status = surviving === 0 ? "flagged" : clear > 0 ? "clear" : "open";
    criteria.push({ criterion, status, counted: status !== "flagged", reasons });
  }

  const counted = criteria.filter((c) => c.counted).length;
  const rescued = input.hypotheses.filter((h) => h.queueStatusBefore === "applies" && h.queueStatusAfter === "does_not_apply").length;
  const contradictedClaims = input.claims.filter((c) => findingOf.get(c.id) === "contradicted").length;
  const routing = counted >= CRITERIA_NEEDED ? "to_lawyer" : "needs_more_evidence";
  const open = criteria.filter((c) => c.status === "open").length;
  const flagged = criteria.filter((c) => c.status === "flagged").length;
  const summary =
    routing === "to_lawyer"
      ? `${counted} of ${CRITERIA_NEEDED} needed criteria still count${open ? ` (${open} with open questions)` : ""}: ready for a lawyer's review.`
      : `Only ${counted} criteria still count; ${CRITERIA_NEEDED} are needed${flagged ? ` (${flagged} flagged by past AAO denials or contradicted)` : ""}. The applicant needs more evidence first.`;
  return { routing, criteriaCounted: counted, criteriaNeeded: CRITERIA_NEEDED, criteria, rescued, contradictedClaims, summary };
}
