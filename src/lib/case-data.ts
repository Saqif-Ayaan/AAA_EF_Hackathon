/**
 * Read-only queries for one case. A "case" is identified by its applicant ID —
 * the same ID used in /case/[id] and /api/cases/[id]/...
 */
import { and, asc, eq, getTableColumns, gt } from "drizzle-orm";
import { db } from "@/db";
import { applicants, claims, discrepancies, events, findings } from "@/db/schema";
import type { Criterion } from "@/lib/schemas";

export type ApplicantRow = typeof applicants.$inferSelect;
export type ClaimRow = typeof claims.$inferSelect;
export type FindingRow = typeof findings.$inferSelect;
export type DiscrepancyRow = typeof discrepancies.$inferSelect;
export type EventRow = typeof events.$inferSelect;

/** A discrepancy plus the claim it is about (so UIs can show context). */
export type DiscrepancyWithClaim = DiscrepancyRow & {
  claim: { criterion: Criterion; summary: string };
};

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

/** All claims for the case and every finding about them (claims with no finding yet are still listed). */
export async function listClaimsAndFindings(applicantId: string): Promise<{ claims: ClaimRow[]; findings: FindingRow[] }> {
  const claimRows = await db
    .select()
    .from(claims)
    .where(eq(claims.applicantId, applicantId))
    .orderBy(asc(claims.createdAt));
  const findingRows = await db
    .select({ finding: findings })
    .from(findings)
    .innerJoin(claims, eq(findings.claimId, claims.id))
    .where(eq(claims.applicantId, applicantId))
    .orderBy(asc(findings.createdAt));
  return { claims: claimRows, findings: findingRows.map((r) => r.finding) };
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
    .orderBy(asc(discrepancies.createdAt), asc(discrepancies.id));
  return rows.map(({ claimCriterion, claimSummary, ...d }) => ({
    ...d,
    claim: { criterion: claimCriterion, summary: claimSummary },
  }));
}
