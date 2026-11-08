/**
 * The scorer handoff: everything about one case in a single validated object
 * (CaseBundleSchema in src/lib/schemas.ts) — applicant, claims, the latest
 * finding per claim, every discrepancy with its resolution, and the latest
 * built case (dossier).
 */
import { CaseBundleSchema, type CaseBundle } from "./schemas";
import { getApplicant, getLatestCaseAndScore, latestFindings, listClaimsAndFindings, listDiscrepancyRows } from "./case-data";

export class CaseBundleError extends Error {
  constructor(
    message: string,
    public status: 404 | 409,
  ) {
    super(message);
  }
}

export async function loadCaseBundle(applicantId: string): Promise<CaseBundle> {
  const applicant = await getApplicant(applicantId);
  if (!applicant) throw new CaseBundleError(`No case with id "${applicantId}"`, 404);

  const { case: caseRow } = await getLatestCaseAndScore(applicantId);
  if (!caseRow) throw new CaseBundleError("No case built yet — click “Build case” on the dashboard first.", 409);

  const { claims, findings } = await listClaimsAndFindings(applicantId);
  const discrepancies = await listDiscrepancyRows(applicantId);

  return CaseBundleSchema.parse({
    applicant,
    claims,
    findings: latestFindings(findings),
    discrepancies,
    case: caseRow,
  });
}
