/**
 * GET /api/cases/[id]/events?after=<eventId>
 * [id] = applicant ID. Events in insertion order; pass the last id you received
 * as `after` to get only newer ones. The war room polls this every 500ms.
 *
 * - firstEventId: if it changes between polls, the case's events were reset
 *   (e.g. `npm run mock` re-ran) — drop what you have and refetch from 0.
 * - hasMore: more events are waiting than one response returns; poll again now.
 */
import { getApplicant, getFirstEventId, listEvents, type EventRow } from "@/lib/case-data";

const PAGE_SIZE = 1000;

export type CaseEventsResponse = { events: EventRow[]; firstEventId: number | null; hasMore: boolean };

export async function GET(request: Request, ctx: RouteContext<"/api/cases/[id]/events">) {
  const { id } = await ctx.params;
  const afterParam = new URL(request.url).searchParams.get("after");
  const after = afterParam === null ? 0 : Number(afterParam);
  if (!Number.isInteger(after) || after < 0) {
    return Response.json({ error: "`after` must be a non-negative whole number (an event id)" }, { status: 400 });
  }

  try {
    if (!(await getApplicant(id))) {
      return Response.json({ error: "Case not found" }, { status: 404 });
    }
    const [rows, firstEventId] = await Promise.all([listEvents(id, after, PAGE_SIZE + 1), getFirstEventId(id)]);
    const body: CaseEventsResponse = {
      events: rows.slice(0, PAGE_SIZE),
      firstEventId,
      hasMore: rows.length > PAGE_SIZE,
    };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    // Usually a transient "database is locked" while the pipeline writes; the client retries.
    console.error("[events] query failed", err);
    return Response.json({ error: "events query failed" }, { status: 503 });
  }
}
