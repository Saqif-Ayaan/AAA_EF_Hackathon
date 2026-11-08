/**
 * Turns the intake form's criterion entries into claim rows — in code, no LLM.
 * One entry = one claim. The summary is a one-line, human-readable version of
 * the entry that agents and the UI can show.
 */
import { CRITERIA, type ClaimPayload, type CriteriaEntries, type Criterion } from "./schemas";
import { CITATION_SOURCE_LABELS } from "./labels";

/** The entry type for one criterion, e.g. EntryOf<"awards"> = AwardEntry. */
export type EntryOf<C extends Criterion> = CriteriaEntries[C][number];

export type NewClaim = { criterion: Criterion; payload: ClaimPayload; summary: string };

const PRESS_FOCUS_SUMMARY = {
  me: "article focuses on the applicant",
  my_company: "article focuses on the applicant's company",
  brief_mention: "brief mention of the applicant",
} as const;

/** Joins the non-empty parts with " · ". */
const join = (parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" · ");

const SUMMARIZERS: { [C in Criterion]: (entry: EntryOf<C>) => string } = {
  awards: (e) =>
    join([
      `${e.awardName} — ${e.issuingOrganization} (${e.year})`,
      e.whatWasAwarded,
      e.recipientsOrEntrants && `recipients/entrants: ${e.recipientsOrEntrants}`,
    ]),

  membership: (e) =>
    join([
      `Member of ${e.associationName}`,
      e.membershipLevel && `level: ${e.membershipLevel}`,
      e.admissionCriteria && `admission: ${e.admissionCriteria}`,
    ]),

  press: (e) =>
    join([`"${e.articleTitle}" — ${e.outlet}`, e.publicationDate, PRESS_FOCUS_SUMMARY[e.focus]]),

  judging: (e) =>
    join([
      `Judge/reviewer for ${e.eventOrJournal}`,
      e.sessionsCompleted !== undefined && `${e.sessionsCompleted} reviews/sessions completed`,
      e.dates,
      e.whatWasAssessed && `assessed: ${e.whatWasAssessed}`,
    ]),

  contributions: (e) =>
    join([
      e.whatYouCreated,
      e.individualContribution && `role: ${e.individualContribution}`,
      e.impactEvidence && `impact: ${e.impactEvidence}`,
    ]),

  scholarly: (e) => {
    const count = e.publicationCount ?? e.titles.length;
    const citations =
      e.claimedCitationCount !== undefined &&
      `${e.claimedCitationCount} citations claimed` +
        (e.citationSource
          ? ` (${CITATION_SOURCE_LABELS[e.citationSource]}${e.asOfDate ? `, as of ${e.asOfDate}` : ""})`
          : "");
    return join([
      `${count} publication${count === 1 ? "" : "s"}`,
      citations,
      e.titles.length > 0 && `titles: ${e.titles.join("; ")}`,
    ]);
  },

  critical_role: (e) =>
    join([
      `${e.position} at ${e.organization}`,
      (e.startDate || e.endDate) && `${e.startDate ?? "?"} – ${e.endDate ?? "present"}`,
      e.measurableContributions,
    ]),

  remuneration: (e) =>
    join([
      `${e.currency} ${e.annualCompensation.toLocaleString("en-US")} annual compensation (${e.year})`,
      e.jobTitle,
      e.location,
    ]),
};

export function summarizeEntry<C extends Criterion>(criterion: C, entry: EntryOf<C>): string {
  return SUMMARIZERS[criterion](entry);
}

function claimsFor<C extends Criterion>(criterion: C, entries: EntryOf<C>[]): NewClaim[] {
  return entries.map((payload) => ({ criterion, payload, summary: summarizeEntry(criterion, payload) }));
}

/** All claims for one application, in criterion order (awards first). */
export function buildClaims(criteria: CriteriaEntries): NewClaim[] {
  return CRITERIA.flatMap((criterion) => claimsFor(criterion, criteria[criterion]));
}
