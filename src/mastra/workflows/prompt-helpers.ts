/** Prompt pieces shared by verify mode (o1-pipeline.ts) and investigate mode (investigation.ts). */
import type { Applicant, Claim } from "../../lib/schemas";

const CV_EXCERPT_CHARS = 4_000;

export function identityOf(applicant: Applicant) {
  return {
    name: applicant.name,
    alternateNames: applicant.alternateNames,
    field: applicant.field,
    currentRole: applicant.currentRole,
    currentOrganization: applicant.currentOrganization,
    profileLinks: applicant.links,
    additionalInfo: applicant.additionalInfo,
    cvExcerpt: applicant.cvText ? applicant.cvText.slice(0, CV_EXCERPT_CHARS) : null,
  };
}

export const claimForPrompt = (c: Claim) => ({ id: c.id, criterion: c.criterion, summary: c.summary, details: c.payload });
export const json = (v: unknown) => JSON.stringify(v, null, 2);
export const truncate = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Run `fn` over `items` with at most `limit` running at once, keeping order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
