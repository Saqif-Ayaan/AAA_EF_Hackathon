import { and, asc, desc, eq, gt, inArray, min, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { applicants, cases, claims, discrepancies, events, findings, scores } from "@/db/schema";
import type { CaseEventsResponse } from "@/lib/war-room";

const PAGE_SIZE = 1000;

/**
 * Polled by the war room every 500ms. `?after=<eventId>` returns only newer
 * events; claims, findings and discrepancies are always a full snapshot.
 * Unknown ids return 200 with `applicant: null` so the page can sit and wait
 * for a run to start.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/cases/[id]/events">) {
  const { id } = await ctx.params;
  const after = Math.max(0, Number(req.nextUrl.searchParams.get("after")) || 0);

  try {
    const [applicantRows, eventRows, firstRows, claimRows, caseRows] = await Promise.all([
      db
        .select({
          id: applicants.id,
          name: applicants.name,
          alternateNames: applicants.alternateNames,
          field: applicants.field,
          currentRole: applicants.currentRole,
          currentOrganization: applicants.currentOrganization,
          createdAt: applicants.createdAt,
        })
        .from(applicants)
        .where(eq(applicants.id, id))
        .limit(1),
      db
        .select()
        .from(events)
        .where(and(eq(events.applicantId, id), gt(events.id, after)))
        .orderBy(asc(events.id))
        .limit(PAGE_SIZE + 1),
      db
        .select({ firstEventId: min(events.id) })
        .from(events)
        .where(eq(events.applicantId, id)),
      db
        .select({ id: claims.id, criterion: claims.criterion, summary: claims.summary })
        .from(claims)
        .where(eq(claims.applicantId, id))
        .orderBy(sql`rowid`),
      db
        .select()
        .from(cases)
        .where(eq(cases.applicantId, id))
        .orderBy(desc(cases.createdAt), desc(sql`rowid`))
        .limit(1),
    ]);

    const latestCase = caseRows[0] ?? null;
    const scoreRows = latestCase
      ? await db
          .select()
          .from(scores)
          .where(eq(scores.caseId, latestCase.id))
          .orderBy(desc(scores.createdAt), desc(sql`rowid`))
          .limit(1)
      : [];

    const claimIds = claimRows.map((c) => c.id);
    const [findingRows, discrepancyRows] = claimIds.length
      ? await Promise.all([
          db
            .select()
            .from(findings)
            .where(inArray(findings.claimId, claimIds))
            .orderBy(asc(findings.createdAt), sql`rowid`),
          db
            .select()
            .from(discrepancies)
            .where(inArray(discrepancies.claimId, claimIds))
            .orderBy(asc(discrepancies.createdAt), sql`rowid`),
        ])
      : [[], []];

    // A claim can be re-verified (e.g. after follow-up); the ledger shows the newest finding.
    const latestFinding = new Map(findingRows.map((f) => [f.claimId, f]));

    const body: CaseEventsResponse = {
      applicant: applicantRows[0] ?? null,
      firstEventId: firstRows[0]?.firstEventId ?? null,
      events: eventRows.slice(0, PAGE_SIZE),
      hasMore: eventRows.length > PAGE_SIZE,
      claims: claimRows,
      findings: [...latestFinding.values()],
      discrepancies: discrepancyRows,
      case: latestCase,
      score: scoreRows[0] ?? null,
    };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    // Usually a transient "database is locked" while a writer holds the file; the client retries.
    console.error("[events] query failed", err);
    return Response.json({ error: "events query failed" }, { status: 503 });
  }
}
