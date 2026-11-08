/**
 * "Build case": writes the dossier (template builder for now), saves the case,
 * assembles the CaseBundle and hands it to the scoring agent.
 */
import { db } from "../db";
import { cases } from "../db/schema";
import { getApplicant, latestFindings, listClaimsAndFindings, listDiscrepancyRows } from "./case-data";
import { loadCaseBundle } from "./case-bundle";
import { buildTemplateCase } from "./case-template";
import { logEvent } from "./event-log";
import { scoreAndSave, type ScoringResult } from "./scoring";

export class BuildCaseError extends Error {
  constructor(
    message: string,
    public status: 404 | 409,
  ) {
    super(message);
  }
}

/** Checks the case can be built; throws BuildCaseError with an HTTP status if not. */
export async function assertBuildable(applicantId: string) {
  const applicant = await getApplicant(applicantId);
  if (!applicant) throw new BuildCaseError(`No case "${applicantId}"`, 404);
  const { claims, findings } = await listClaimsAndFindings(applicantId);
  if (claims.length === 0) throw new BuildCaseError("This case has no claims yet", 409);
  if (findings.length === 0) throw new BuildCaseError("Nothing has been verified yet — run vetting first", 409);
}

export async function buildCase(applicantId: string): Promise<{ caseId: string; scoring: ScoringResult }> {
  const log = (e: Omit<Parameters<typeof logEvent>[0], "applicantId">) => logEvent({ applicantId, ...e });
  try {
    const applicant = await getApplicant(applicantId);
    if (!applicant) throw new BuildCaseError(`No case "${applicantId}"`, 404);
    const { claims, findings } = await listClaimsAndFindings(applicantId);
    const discrepancies = await listDiscrepancyRows(applicantId);

    await log({ agentId: "pipeline", type: "handoff", message: "Build case requested → case builder" });
    await log({
      agentId: "caseBuilder",
      type: "status",
      status: "thinking",
      progress: 10,
      currentAction: "Selecting the strongest criteria from verified evidence",
      message: "Case builder started",
    });

    const { caseJson, markdown } = buildTemplateCase({ applicant, claims, findings: latestFindings(findings), discrepancies });
    const [row] = await db.insert(cases).values({ applicantId, caseJson, markdown }).returning({ id: cases.id });

    const argued = caseJson.criteriaArgued;
    const exhibits = argued.reduce((n, c) => n + c.exhibits.length, 0);
    await log({
      agentId: "caseBuilder",
      type: "status",
      status: "done",
      progress: 100,
      currentAction: `Dossier ready — ${argued.length} criteria argued`,
      found: `${argued.length} criteria · ${exhibits} exhibits`,
      message: `Dossier ready — ${argued.length} criteria argued, ${exhibits} exhibits`,
    });

    const bundle = await loadCaseBundle(applicantId);
    await log({ agentId: "caseBuilder", type: "handoff", message: "Case builder → scoring agent: case bundle ready" });
    const scoring = await scoreAndSave(bundle);
    return { caseId: row.id, scoring };
  } catch (err) {
    console.error(`[build] ${applicantId} failed`, err);
    await log({
      agentId: "caseBuilder",
      type: "status",
      status: "error",
      currentAction: "Build failed — see server log",
      message: `Case build failed: ${err instanceof Error ? err.message : String(err)}`,
    }).catch(() => {});
    throw err;
  }
}
