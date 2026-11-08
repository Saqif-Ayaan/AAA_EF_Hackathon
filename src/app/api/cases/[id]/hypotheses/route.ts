/**
 * GET /api/cases/[id]/hypotheses
 * [id] = applicant ID. PART 3: every sceptic failure mode that was investigated,
 * with its precedent, the measurements (with sources) and the resolver's
 * verdict (cleared / confirmed / still_unknown), oldest first.
 */
import { getApplicant, listHypotheses, type HypothesisRow } from "@/lib/case-data";

export type CaseHypothesesResponse = { hypotheses: HypothesisRow[] };

export async function GET(_request: Request, ctx: RouteContext<"/api/cases/[id]/hypotheses">) {
  const { id } = await ctx.params;
  if (!(await getApplicant(id))) {
    return Response.json({ error: "Case not found" }, { status: 404 });
  }
  const body: CaseHypothesesResponse = { hypotheses: await listHypotheses(id) };
  return Response.json(body);
}
