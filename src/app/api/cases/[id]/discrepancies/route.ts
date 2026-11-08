/**
 * GET /api/cases/[id]/discrepancies
 * [id] = applicant ID. Every discrepancy (open and resolved), oldest first, each
 * with the criterion and summary of the claim it is about.
 */
import { getApplicant, listDiscrepancies, type DiscrepancyWithClaim } from "@/lib/case-data";

export type CaseDiscrepanciesResponse = { discrepancies: DiscrepancyWithClaim[] };

export async function GET(_request: Request, ctx: RouteContext<"/api/cases/[id]/discrepancies">) {
  const { id } = await ctx.params;
  if (!(await getApplicant(id))) {
    return Response.json({ error: "Case not found" }, { status: 404 });
  }
  const body: CaseDiscrepanciesResponse = { discrepancies: await listDiscrepancies(id) };
  return Response.json(body);
}
