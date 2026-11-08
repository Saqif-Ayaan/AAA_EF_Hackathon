/**
 * GET /api/cases/[id]/findings
 * [id] = applicant ID. Returns every claim (so the ledger can show rows that are
 * still pending) and every finding about those claims.
 */
import { getApplicant, listClaimsAndFindings, type ClaimRow, type FindingRow } from "@/lib/case-data";

export type CaseFindingsResponse = { claims: ClaimRow[]; findings: FindingRow[] };

export async function GET(_request: Request, ctx: RouteContext<"/api/cases/[id]/findings">) {
  const { id } = await ctx.params;
  if (!(await getApplicant(id))) {
    return Response.json({ error: "Case not found" }, { status: 404 });
  }
  const body: CaseFindingsResponse = await listClaimsAndFindings(id);
  return Response.json(body);
}
