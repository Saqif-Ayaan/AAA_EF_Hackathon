/**
 * POST /api/cases/[id]/build — STUB.
 *
 * Responds 202 immediately, then (via after()) plays out a ~9s case-builder
 * and scorer run: logs events for the war room, writes a dossier to `cases`
 * and a score to `scores`. The dossier and score come from
 * src/lib/mock-case-builder.ts (templates, no LLM).
 *
 * To make it real: replace runStubBuild() with the Mastra workflow's
 * buildCase step; the scorer will POST /api/cases/[id]/score on its own.
 */
import { asc, eq, inArray, sql } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/db";
import { applicants, cases, claims, discrepancies, events, findings, scores } from "@/db/schema";
import { buildMockCase, scoreMockCase, type CaseInput } from "@/lib/mock-case-builder";
import { NewAgentEventSchema, type NewAgentEvent } from "@/lib/schemas";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function log(applicantId: string, e: Omit<NewAgentEvent, "applicantId">) {
  await db.insert(events).values(NewAgentEventSchema.parse({ applicantId, ...e }));
}

export async function POST(_req: Request, ctx: RouteContext<"/api/cases/[id]/build">) {
  const { id } = await ctx.params;

  const [applicant] = await db
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
    .limit(1);
  if (!applicant) return Response.json({ error: `No case "${id}"` }, { status: 404 });

  const claimRows = await db
    .select({ id: claims.id, criterion: claims.criterion, summary: claims.summary })
    .from(claims)
    .where(eq(claims.applicantId, id))
    .orderBy(sql`rowid`);
  const claimIds = claimRows.map((c) => c.id);
  if (!claimIds.length) return Response.json({ error: "This case has no claims yet" }, { status: 409 });

  const [findingRows, discrepancyRows] = await Promise.all([
    db.select().from(findings).where(inArray(findings.claimId, claimIds)).orderBy(asc(findings.createdAt), sql`rowid`),
    db.select().from(discrepancies).where(inArray(discrepancies.claimId, claimIds)),
  ]);
  if (!findingRows.length) {
    return Response.json({ error: "Nothing has been verified yet — run vetting first" }, { status: 409 });
  }

  await log(id, { agentId: "pipeline", type: "handoff", message: "Build case requested → case builder" });
  await log(id, {
    agentId: "caseBuilder",
    type: "status",
    message: "Case builder started",
    status: "thinking",
    currentAction: "Selecting the strongest criteria from verified evidence",
    progress: 8,
  });

  const input: CaseInput = { applicant, claims: claimRows, findings: findingRows, discrepancies: discrepancyRows };
  after(() => runStubBuild(id, input));

  return Response.json({ status: "building", stub: true }, { status: 202 });
}

async function runStubBuild(id: string, input: CaseInput) {
  try {
    const { caseJson, markdown } = buildMockCase(input);
    const argued = caseJson.criteriaArgued;
    const exhibitCount = argued.reduce((n, c) => n + c.exhibits.length, 0);

    await sleep(1500);
    await log(id, {
      agentId: "caseBuilder",
      type: "status",
      message: `Arguing ${argued.length} criteria`,
      status: "thinking",
      currentAction: `Drafting arguments for ${argued.length} criteria`,
      progress: 38,
    });
    await sleep(1500);
    await log(id, {
      agentId: "caseBuilder",
      type: "status",
      message: `Citing ${exhibitCount} exhibits`,
      status: "thinking",
      currentAction: `Citing ${exhibitCount} exhibits and flagging weaknesses`,
      progress: 72,
    });
    await sleep(1300);

    const [row] = await db.insert(cases).values({ applicantId: id, caseJson, markdown }).returning({ id: cases.id });
    await log(id, {
      agentId: "caseBuilder",
      type: "status",
      message: `Dossier ready — ${argued.length} criteria argued, ${exhibitCount} exhibits`,
      status: "done",
      currentAction: `Dossier ready — ${argued.length} criteria argued`,
      progress: 100,
    });
    await log(id, { agentId: "caseBuilder", type: "handoff", message: "case builder → scoring agent: case bundle ready" });

    await sleep(900);
    await log(id, {
      agentId: "scorer",
      type: "status",
      message: "Scoring the case",
      status: "thinking",
      currentAction: "Estimating approval likelihood and RFE risk",
      progress: 30,
    });
    await sleep(2300);

    const score = scoreMockCase(caseJson, input.discrepancies);
    await db.insert(scores).values({ caseId: row.id, ...score });
    await log(id, {
      agentId: "scorer",
      type: "verdict",
      message: `Readiness ${score.approvalLikelihood}/100 · RFE risk ${score.rfeRisk}/100`,
      status: "done",
      currentAction: `Readiness ${score.approvalLikelihood}/100`,
      progress: 100,
    });
    await log(id, {
      agentId: "pipeline",
      type: "status",
      message: `Case ready — readiness ${score.approvalLikelihood}/100, RFE risk ${score.rfeRisk}/100`,
      status: "done",
    });
  } catch (err) {
    console.error("[build] stub build failed", err);
    await log(id, {
      agentId: "caseBuilder",
      type: "status",
      message: "Case build failed",
      status: "error",
      currentAction: "Build failed — see server log",
    }).catch(() => {});
  }
}
