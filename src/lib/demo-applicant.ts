/**
 * Fallback data for the "Load demo applicant" button.
 *
 * ⚠ PLACEHOLDER: "Jordan Lee" is a fictional person. The real demo applicant
 * lives in demo/applicant.local.json (gitignored — a real person's details must
 * not go in this public repo). GET /api/demo-applicant serves that file when it
 * exists and falls back to this placeholder otherwise.
 *
 * The profile is built around the spec's three scripted discrepancies:
 *  1. Membership — claims "Thiel Fellow"; truth: finalist only
 *     → agent flags `contradicted` → applicant amends.
 *  2. Scholarly — claims 10 citations (Google Scholar); OpenAlex shows fewer,
 *     some papers published under a former name ("Jordan Park")
 *     → applicant substantiates.
 *  3. Awards — a real hackathon win, but small (~30 teams)
 *     → `criterion_fit` → reframed as supporting evidence.
 * Everything else is meant to check out cleanly.
 */
import type { ApplicationSubmission } from "./schemas";

export const DEMO_SUBMISSION: ApplicationSubmission = {
  applicant: {
    name: "Jordan Lee",
    alternateNames: ["Jordan Park"],
    email: "jordan.lee@example.com",
    consentToCall: true,
    field: "Applied machine learning for legal documents",
    currentRole: "Co-founder & CTO",
    currentOrganization: "Fieldnote AI",
    usWorkPlan:
      "Lead the engineering team at Fieldnote AI in San Francisco, building document-understanding models used by immigration and corporate law firms.",
    // Replace with the teammate's real profile URLs so the source agents have somewhere to look.
    links: {},
    additionalInfo:
      "My first two papers were published under my former name, Jordan Park. I also mentor first-time hackers at university hackathons.",
  },
  criteria: {
    awards: [
      {
        awardName: "Grand Prize",
        issuingOrganization: "Bay Area Legal Tech Hackathon",
        year: 2025,
        whatWasAwarded: "First place overall for an AI contract-review assistant",
        selectionProcess: "Judged by a panel of engineers and practising lawyers",
        recipientsOrEntrants: "1 winning team out of about 30",
      },
    ],
    membership: [
      {
        associationName: "Thiel Fellowship",
        membershipLevel: "Fellow",
        admissionCriteria: "Highly selective two-year fellowship for young founders",
        evaluatedBy: "Thiel Foundation selection committee",
      },
    ],
    press: [],
    judging: [
      {
        eventOrJournal: "Bay Area Legal Tech Hackathon 2026",
        dates: "March 2026",
        sessionsCompleted: 12,
        whatWasAssessed: "Final-round team projects",
        hasEmailsOrLetters: true,
      },
    ],
    contributions: [
      {
        whatYouCreated: "clausekit — an open-source library for extracting clauses from contracts",
        individualContribution: "Creator and lead maintainer; wrote the core parsing engine",
        impactEvidence: "1,200 GitHub stars; about 8,000 monthly downloads",
        organizationsUsingIt: "Two legal-aid nonprofits",
        independentSourceUrls: [],
      },
    ],
    scholarly: [
      {
        titles: [
          "Layout-aware transformers for legal document parsing",
          "Few-shot clause extraction with retrieval augmentation",
        ],
        venues: ["Workshop on Legal NLP 2023", "arXiv preprint 2024"],
        doiLinks: [],
        publicationCount: 2,
        claimedCitationCount: 10,
        citationSource: "google_scholar",
        asOfDate: "October 2026",
      },
    ],
    critical_role: [
      {
        organization: "Fieldnote AI",
        position: "Co-founder & CTO",
        startDate: "January 2024",
        endDate: "present",
        responsibilities: "Leads a team of 6 engineers; owns the model and infrastructure roadmap",
        measurableContributions: "Built the core product now used by 40 law firms",
        organizationReputationEvidence: "Raised a $3M seed round",
      },
    ],
    remuneration: [],
  },
};
