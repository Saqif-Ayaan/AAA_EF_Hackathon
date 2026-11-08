/**
 * GET /api/cases/[id]/events?after=<eventId>
 * [id] = applicant ID. Returns events in order; pass the last id you received as
 * `after` to get only newer ones (the war room polls this every 500ms).
 */
import { getApplicant, listEvents, type EventRow } from "@/lib/case-data";

export type CaseEventsResponse = { events: EventRow[] };

export async function GET(request: Request, ctx: RouteContext<"/api/cases/[id]/events">) {
  const { id } = await ctx.params;
  const afterParam = new URL(request.url).searchParams.get("after");
  const after = afterParam === null ? 0 : Number(afterParam);
  if (!Number.isInteger(after) || after < 0) {
    return Response.json({ error: "`after` must be a non-negative whole number (an event id)" }, { status: 400 });
  }
  if (!(await getApplicant(id))) {
    return Response.json({ error: "Case not found" }, { status: 404 });
  }
  const body: CaseEventsResponse = { events: await listEvents(id, after) };
  return Response.json(body);
}
