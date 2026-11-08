/**
 * POST /api/cases/[id]/followup   body: { discrepancyId, reply }
 * [id] = applicant ID. Runs the resolver agent on the applicant's reply (a real,
 * billed Claude call) and updates the discrepancy, claim and finding.
 */
import { z } from "zod";
import { FollowupError, resolveDiscrepancy, type FollowupResult } from "@/lib/followup";

export type FollowupResponse = FollowupResult;

const BodySchema = z.object({
  discrepancyId: z.string().min(1),
  reply: z.string(),
});

export async function POST(request: Request, ctx: RouteContext<"/api/cases/[id]/followup">) {
  const { id } = await ctx.params;
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Send JSON like { discrepancyId, reply }" }, { status: 400 });
  }

  try {
    const result: FollowupResponse = await resolveDiscrepancy({ applicantId: id, ...parsed.data });
    return Response.json(result);
  } catch (error) {
    if (error instanceof FollowupError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Follow-up resolver failed:", error);
    return Response.json(
      { error: "We couldn't process that answer just now. Please try again in a moment." },
      { status: 502 },
    );
  }
}
