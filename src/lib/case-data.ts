/**
 * Read-only queries for one case. A "case" is identified by its applicant ID —
 * the same ID used in /case/[id] and /api/cases/[id]/...
 *
 * Rows written in the same millisecond keep their insertion order (rowid).
 */
import { and, asc, desc, eq, getTableColumns, gt, min, sql } from "drizzle-orm";
import { db } from "@/db";
import { applicants, cases, claims, discrepancies, events, findings, scores } from "@/db/schema";
import type { Criterion } from "@/lib/schemas";

export type ApplicantRow = typeof applicants.$inferSelect;
export type ClaimRow = typeof claims.$inferSelect;
export type FindingRow = typeof findings.$inferSelect;
export type DiscrepancyRow = typeof discrepancies.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type CaseRow = typeof cases.$inferSelect;
export type ScoreRow = typeof scores.$inferSelect;

/** A discrepancy plus the claim it is about (so UIs can show context). */
export type DiscrepancyWithClaim = DiscrepancyRow & {
  claim: { criterion: Criterion; summary: string };
};

const rowid = sql`rowid`;

export async function getApplicant(applicantId: string): Promise<ApplicantRow | null> {
  const [row] = await db.select().from(applicants).where(eq(applicants.id, applicantId));
  return row ?? null;
}

/** Events in insertion order. Pass the last id you have to get only newer ones. */
export async function listEvents(applicantId: string, afterId = 0, limit = 1000): Promise<EventRow[]> {
  return db
    .select()
    .from(events)
    .where(and(eq(events.applicantId, applicantId), gt(events.id, afterId)))
    .orderBy(asc(events.id))
    .limit(limit);
}

/** The id of the case's first event — changes when its events are reset. */
export async function getFirstEventId(applicantId: string): Promise<number | null> {
  const [row] = await db.select({ first: min(events.id) }).from(events).where(eq(events.applicantId, applicantId));
  return row?.first ?? null;
}

/** All claims for the case and every finding about them (claims with no finding yet are still listed). */
export async function listClaimsAndFindings(applicantId: string): Promise<{ claims: ClaimRow[]; findings: FindingRow[] }> {
  const claimRows = await db
    .select()
    .from(claims)
    .where(eq(claims.applicantId, applicantId))
    .orderBy(asc(claims.createdAt), rowid);
  const findingRows = await db
    .select({ finding: findings })
    .from(findings)
    .innerJoin(claims, eq(findings.claimId, claims.id))
    .where(eq(claims.applicantId, applicantId))
    .orderBy(asc(findings.createdAt), sql`${findings}.rowid`);
  return { claims: claimRows, findings: findingRows.map((r) => r.finding) };
}

/** The newest finding per claim (a claim can be re-verified). */
export function latestFindings(findingRows: FindingRow[]): FindingRow[] {
  return [...new Map(findingRows.map((f) => [f.claimId, f])).values()];
}

export async function listDiscrepancies(applicantId: string): Promise<DiscrepancyWithClaim[]> {
  const rows = await db
    .select({
      ...getTableColumns(discrepancies),
      claimCriterion: claims.criterion,
      claimSummary: claims.summary,
    })
    .from(discrepancies)
    .innerJoin(claims, eq(discrepancies.claimId, claims.id))
    .where(eq(claims.applicantId, applicantId))
    .orderBy(asc(discrepancies.createdAt), sql`${discrepancies}.rowid`);
  return rows.map(({ claimCriterion, claimSummary, ...d }) => ({
    ...d,
    claim: { criterion: claimCriterion, summary: claimSummary },
  }));
}

/** Discrepancies for the case without the claim context (the CaseBundle shape). */
export async function listDiscrepancyRows(applicantId: string): Promise<DiscrepancyRow[]> {
  const rows = await db
    .select({ discrepancy: discrepancies })
    .from(discrepancies)
    .innerJoin(claims, eq(discrepancies.claimId, claims.id))
    .where(eq(claims.applicantId, applicantId))
    .orderBy(asc(discrepancies.createdAt), sql`${discrepancies}.rowid`);
  return rows.map((r) => r.discrepancy);
}

/** The most recently built case (dossier) and its most recent score, if any. */
export async function getLatestCaseAndScore(applicantId: string): Promise<{ case: CaseRow | null; score: ScoreRow | null }> {
  const [latestCase] = await db
    .select()
    .from(cases)
    .where(eq(cases.applicantId, applicantId))
    .orderBy(desc(cases.createdAt), desc(rowid))
    .limit(1);
  if (!latestCase) return { case: null, score: null };
  const [latestScore] = await db
    .select()
    .from(scores)
    .where(eq(scores.caseId, latestCase.id))
    .orderBy(desc(scores.createdAt), desc(rowid))
    .limit(1);
  return { case: latestCase, score: latestScore ?? null };
}
