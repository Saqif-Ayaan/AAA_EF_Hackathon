/**
 * GET /api/cases/[id]
 * [id] = applicant ID. The case header for the war room: who the applicant is,
 * the latest built case (dossier) and its latest score (null until scored).
 */
import { getApplicant, getLatestCaseAndScore, type CaseRow, type ScoreRow } from "@/lib/case-data";
import type { WarRoomApplicant } from "@/lib/war-room";

export type CaseSummaryResponse = {
  applicant: WarRoomApplicant;
  case: CaseRow | null;
  score: ScoreRow | null;
};

export async function GET(_request: Request, ctx: RouteContext<"/api/cases/[id]">) {
  const { id } = await ctx.params;
  try {
    const applicant = await getApplicant(id);
    if (!applicant) return Response.json({ error: "Case not found" }, { status: 404 });
    const { name, alternateNames, field, currentRole, currentOrganization, createdAt } = applicant;
    const body: CaseSummaryResponse = {
      applicant: { id, name, alternateNames, field, currentRole, currentOrganization, createdAt },
      ...(await getLatestCaseAndScore(id)),
    };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[case] query failed", err);
    return Response.json({ error: "case query failed" }, { status: 503 });
  }
}
