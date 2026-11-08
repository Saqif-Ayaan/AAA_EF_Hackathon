/**
 * TEST FIXTURE: creates a case with open follow-up questions, so the follow-up
 * chat can be tried before the vetting agents (agents branch) exist.
 *
 * Uses the demo applicant (demo/applicant.local.json, or the placeholder) and
 * adds an "unverified" finding + one open discrepancy for up to 3 claims. The
 * question wording is generic per criterion, so nothing personal is committed.
 * Findings are clearly marked as seeded test data, not real verification.
 */
import { db } from "@/db";
import { applicants, claims, discrepancies, events, findings } from "@/db/schema";
import { buildClaims } from "@/lib/claims";
import { loadDemoSubmission } from "@/lib/demo-source";
import type { Criterion, DiscrepancyType } from "@/lib/schemas";

/** Which claims get a question first (the spec's scripted three come first). */
const PRIORITY: Criterion[] = ["press", "scholarly", "awards", "membership", "contributions", "critical_role", "judging", "remuneration"];

const TEMPLATES: Record<Criterion, { type: DiscrepancyType; description: string; question: string; requestedDocument: string }> = {
  press: {
    type: "evidence",
    description: "We couldn't find the applicant's name in this article — it appears to focus on the project rather than on them.",
    question: "We couldn't find your name in this article. Does it mention you by name, or is it mainly about the project or your team?",
    requestedDocument: "A link to coverage that names you",
  },
  scholarly: {
    type: "identity",
    description: "Some publications under this name appear to belong to a different researcher, so the publication record needs confirming.",
    question: "We found papers under your name that seem to belong to a different researcher. Which publications are yours, and do you have a Google Scholar or ORCID profile we can check?",
    requestedDocument: "Google Scholar or ORCID profile link",
  },
  awards: {
    type: "criterion_fit",
    description: "This looks like a team prize from a single event, which may not count on its own as a nationally or internationally recognised award.",
    question: "Was this prize awarded to you personally or to your team, and how were the winners selected?",
    requestedDocument: "Award announcement or certificate naming you",
  },
  membership: {
    type: "criterion_fit",
    description: "This looks like a fellowship or programme rather than an association that admits members based on outstanding achievements.",
    question: "Is this a professional association with expert-judged admission, or a fellowship or programme you were selected for?",
    requestedDocument: "Admission criteria or acceptance letter",
  },
  contributions: {
    type: "insufficient_proof",
    description: "We found the project but no independent evidence of its impact on the field.",
    question: "What independent evidence shows the impact of this work — for example users, adoption by other organisations, or citations?",
    requestedDocument: "Links to independent adoption or usage evidence",
  },
  critical_role: {
    type: "insufficient_proof",
    description: "We could confirm the title but not the scale of the applicant's individual contribution or the organisation's reputation.",
    question: "What did you personally own or deliver in this role, and what shows the organisation is distinguished (funding, press, customers)?",
    requestedDocument: "A reference letter from a manager or co-founder",
  },
  judging: {
    type: "evidence",
    description: "We couldn't find a record that the applicant completed these reviews or judging sessions.",
    question: "Do you have confirmation that you completed these reviews or judging sessions — for example the invitation and a thank-you email?",
    requestedDocument: "Judging invitation and confirmation email",
  },
  remuneration: {
    type: "insufficient_proof",
    description: "Salary information isn't public, so this can't be verified online.",
    question: "Salary details usually aren't public. Would you be able to share an offer letter or payslip privately with your attorney?",
    requestedDocument: "Offer letter or payslip (shared privately with counsel)",
  },
};

export async function seedFollowupCase(maxQuestions = 3) {
  const { source, submission } = await loadDemoSubmission();
  const newClaims = buildClaims(submission.criteria);
  const base = Date.now();
  const at = (offsetMs: number) => new Date(base + offsetMs).toISOString(); // keeps a stable order

  return db.transaction(async (tx) => {
    const [applicant] = await tx.insert(applicants).values(submission.applicant).returning();
    const savedClaims = newClaims.length
      ? await tx
          .insert(claims)
          .values(newClaims.map((c, i) => ({ ...c, applicantId: applicant.id, createdAt: at(i) })))
          .returning()
      : [];

    const chosen = PRIORITY.map((c) => savedClaims.find((cl) => cl.criterion === c))
      .filter((c): c is (typeof savedClaims)[number] => c !== undefined)
      .slice(0, maxQuestions);

    for (const [i, claim] of chosen.entries()) {
      await tx.insert(findings).values({
        claimId: claim.id,
        status: "unverified",
        foundValue: null,
        identityConfidence: 0.5,
        sources: [],
        reasoning: "Seeded test data (scripts/seed-followup.ts) so the follow-up chat has something to resolve. Not a real verification.",
        createdAt: at(100 + i),
      });
      await tx.insert(discrepancies).values({ claimId: claim.id, ...TEMPLATES[claim.criterion], createdAt: at(200 + i) });
    }

    await tx.insert(events).values({
      applicantId: applicant.id,
      agentId: "pipeline",
      type: "message",
      message: `Test case seeded with ${chosen.length} open follow-up question(s).`,
    });

    return { applicantId: applicant.id, applicantName: applicant.name, source, questions: chosen.length };
  });
}
