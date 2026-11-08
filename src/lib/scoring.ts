/**
 * Hands a CaseBundle to the scoring agent (src/scorer/index.ts), validates what
 * it returns, saves it to `scores`, and logs scorer events for the war room.
 * A null result means "no score yet" — nothing is saved and the dashboard keeps
 * showing "Awaiting score". Never throws: failures are logged as scorer errors.
 */
import { db } from "../db";
import { scores } from "../db/schema";
import { scoreCase } from "../scorer";
import { logEvent } from "./event-log";
import { ScoreInputSchema, type CaseBundle, type Score } from "./schemas";

export type ScoringResult = { status: "saved"; score: Score } | { status: "awaiting" } | { status: "error"; message: string };

export async function scoreAndSave(bundle: CaseBundle): Promise<ScoringResult> {
  const applicantId = bundle.applicant.id;
  await logEvent({
    applicantId,
    agentId: "scorer",
    type: "status",
    status: "thinking",
    progress: 30,
    currentAction: "Estimating approval likelihood and RFE risk",
    message: "Scoring the case",
  });

  let message: string;
  try {
    const result = await scoreCase(bundle);
    if (result === null) {
      await logEvent({
        applicantId,
        agentId: "scorer",
        type: "status",
        status: "queued",
        progress: 0,
        currentAction: "Awaiting score",
        message: "Awaiting score — the scoring agent returned no score yet",
      });
      return { status: "awaiting" };
    }

    const parsed = ScoreInputSchema.safeParse(result);
    if (parsed.success) {
      const [row] = await db.insert(scores).values({ caseId: bundle.case.id, ...parsed.data }).returning();
      const headline = `${Math.round(row.approvalLikelihood)}/100 approval likelihood · RFE risk ${Math.round(row.rfeRisk)}/100`;
      await logEvent({
        applicantId,
        agentId: "scorer",
        type: "verdict",
        status: "done",
        progress: 100,
        currentAction: headline,
        found: `${Math.round(row.approvalLikelihood)}/100`,
        message: headline,
      });
      return { status: "saved", score: row };
    }
    message = `scoreCase() returned an invalid score: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`;
  } catch (err) {
    message = `scoreCase() failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  console.error(`[scorer] ${message}`);
  await logEvent({ applicantId, agentId: "scorer", type: "status", status: "error", progress: 100, message }).catch(() => {});
  return { status: "error", message };
}
