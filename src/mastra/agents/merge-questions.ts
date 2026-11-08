/**
 * PART 3 §6: one follow-up list from two sources —
 *   1. Part 2 discrepancies (the questioner's ranked issues), and
 *   2. sceptic hypotheses still unknown after investigation (their sharpened question).
 *
 * Deduplicated by claim (one question per piece of evidence), ranked:
 *   sceptic questions on criteria the case still needs to reach 3
 *   → numerical discrepancies → the rest by the questioner's impact,
 * and capped (4) on the MERGED list. Pure, so it is easy to test.
 */
import { z } from "zod";
import { QuestionerOutputSchema, type Criterion } from "../../lib/schemas";
import type { RankedIssue } from "./output-schemas";

export const MergedQuestionSchema = QuestionerOutputSchema.extend({ hypothesisId: z.string().nullable() });
export type MergedQuestion = z.infer<typeof MergedQuestionSchema>;

export type ScepticQuestion = {
  hypothesisId: string;
  claimId: string;
  criterion: Criterion;
  failureMode: string;
  precedentCaseId: string;
  reasoning: string;
  question: string;
};

const CRITERIA_NEEDED = 3;

export function mergeQuestions(input: {
  issues: RankedIssue[]; // Part 2, already ordered by impact
  sceptic: ScepticQuestion[];
  /** Criteria that already count with nothing open (the queue summary's "clear"). */
  clearCriteria: Set<Criterion>;
  max: number;
}): { questions: MergedQuestion[]; notAskedIssues: RankedIssue[]; notAskedHypothesisIds: string[] } {
  const needMore = input.clearCriteria.size < CRITERIA_NEEDED;
  const IMPACT_TIER = { high: 2, medium: 4, low: 5 } as const;

  type Candidate = { tier: number; order: number; claimId: string; q: MergedQuestion; issue?: RankedIssue; hypothesisId?: string };
  const candidates: Candidate[] = [
    ...input.sceptic.map((s, order) => ({
      tier: needMore && !input.clearCriteria.has(s.criterion) ? 0 : 3,
      order,
      claimId: s.claimId,
      hypothesisId: s.hypothesisId,
      q: {
        claimId: s.claimId,
        type: "failure_mode" as const,
        description: `${s.failureMode} (as in AAO decision ${s.precedentCaseId}). ${s.reasoning}`,
        question: s.question,
        requestedDocument: null,
        hypothesisId: s.hypothesisId,
      },
    })),
    ...input.issues.map((d, order) => ({
      tier: d.type === "numerical" ? 1 : IMPACT_TIER[d.impact],
      order,
      claimId: d.claimId,
      issue: d,
      q: {
        claimId: d.claimId,
        type: d.type,
        description: d.description,
        question: d.question,
        requestedDocument: d.requestedDocument?.trim() || null,
        hypothesisId: null,
      },
    })),
  ].sort((a, b) => a.tier - b.tier || a.order - b.order);

  const asked: Candidate[] = [];
  const notAsked: Candidate[] = [];
  const claimsAsked = new Set<string>();
  for (const c of candidates) {
    if (asked.length < input.max && !claimsAsked.has(c.claimId)) {
      asked.push(c);
      claimsAsked.add(c.claimId);
    } else notAsked.push(c);
  }
  return {
    questions: asked.map((c) => MergedQuestionSchema.parse(c.q)),
    notAskedIssues: notAsked.flatMap((c) => (c.issue ? [c.issue] : [])),
    notAskedHypothesisIds: notAsked.flatMap((c) => (c.hypothesisId ? [c.hypothesisId] : [])),
  };
}
