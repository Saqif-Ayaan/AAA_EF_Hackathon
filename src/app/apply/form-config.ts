/**
 * Every field on the intake form, defined once. The form renders, converts and
 * validates from these lists. `key` is the field's path in the zod schema
 * (dots for nested fields, e.g. "links.github" or "breakdown.base").
 */
import { CRITERIA, type Criterion } from "@/lib/schemas";
import { CITATION_SOURCE_LABELS, CRITERION_LABELS, PRESS_FOCUS_LABELS } from "@/lib/labels";

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "url"
  | "email"
  | "tel"
  | "select"
  | "checkbox"
  | "list"; // textarea, one item per line → string[]

export type FieldDef = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  listOf?: "text" | "url";
  defaultValue?: string;
  /** Span the full row (textareas, lists and checkboxes always do). */
  wide?: boolean;
};

const optionsFrom = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

// ── Step 1: About you ────────────────────────────────────────────────────────

export const ABOUT_SECTIONS: { title: string; description?: string; fields: FieldDef[] }[] = [
  {
    title: "Identity",
    fields: [
      {
        key: "name",
        label: "Full professional name",
        type: "text",
        required: true,
        placeholder: "As it appears on your publications and profiles",
        wide: true,
      },
      {
        key: "alternateNames",
        label: "Former or alternate names",
        type: "list",
        placeholder: "One per line",
        help: "Maiden names, transliterations or earlier spellings. We search under these too.",
      },
    ],
  },
  {
    title: "Contact",
    fields: [
      { key: "email", label: "Email", type: "email", required: true },
      { key: "phone", label: "Phone (optional)", type: "tel" },
      {
        key: "consentToCall",
        label: "I agree to a follow-up call from an AI assistant",
        type: "checkbox",
        help: "The caller is an AI, not a person, and will say so at the start. Prefer email? Leave this unticked and we'll follow up in writing instead.",
      },
    ],
  },
  {
    title: "Your work",
    fields: [
      { key: "field", label: "Field of expertise", type: "text", required: true, wide: true },
      { key: "currentRole", label: "Current role", type: "text", required: true },
      { key: "currentOrganization", label: "Current organisation", type: "text", required: true },
      {
        key: "usWorkPlan",
        label: "What work will you do in the US?",
        type: "textarea",
        required: true,
      },
    ],
  },
  {
    title: "Profiles",
    description: "Links help us find and verify your work. Add any you have.",
    fields: [
      { key: "links.linkedin", label: "LinkedIn", type: "url", placeholder: "linkedin.com/in/…" },
      { key: "links.github", label: "GitHub", type: "url", placeholder: "github.com/…" },
      { key: "links.scholar", label: "Google Scholar", type: "url" },
      { key: "links.orcid", label: "ORCID", type: "url", placeholder: "orcid.org/…" },
      { key: "links.devpost", label: "Devpost", type: "url", placeholder: "devpost.com/…" },
      { key: "links.website", label: "Personal website", type: "url" },
    ],
  },
];

export const ABOUT_FIELDS: FieldDef[] = ABOUT_SECTIONS.flatMap((s) => s.fields);

// ── Steps 2–9: the eight O-1A criteria ───────────────────────────────────────

export type CriterionStepConfig = {
  question: string;
  entryNoun: string; // "award" → "+ Add another award"
  note?: string;
  fields: FieldDef[];
};

export const CRITERION_STEPS: Record<Criterion, CriterionStepConfig> = {
  awards: {
    question: "Have you won nationally or internationally recognised prizes or awards for excellence in your field?",
    entryNoun: "award",
    fields: [
      { key: "awardName", label: "Award name", type: "text", required: true },
      { key: "issuingOrganization", label: "Issuing organisation", type: "text", required: true },
      { key: "year", label: "Year", type: "number", required: true, placeholder: "e.g. 2025" },
      { key: "whatWasAwarded", label: "What was it awarded for?", type: "text" },
      { key: "selectionProcess", label: "How were winners selected?", type: "textarea" },
      {
        key: "recipientsOrEntrants",
        label: "Number of recipients or entrants (if known)",
        type: "text",
        placeholder: "e.g. 1 winner out of ~30 teams",
        wide: true,
      },
      { key: "url", label: "Announcement or certificate link", type: "url", wide: true },
    ],
  },
  membership: {
    question: "Are you a member of an association that requires outstanding achievements to join?",
    entryNoun: "membership",
    fields: [
      { key: "associationName", label: "Association name", type: "text", required: true },
      { key: "membershipLevel", label: "Membership level", type: "text", placeholder: "e.g. Fellow, Senior Member" },
      {
        key: "admissionCriteria",
        label: "Admission criteria",
        type: "textarea",
        help: "What did you have to achieve to be admitted?",
      },
      { key: "evaluatedBy", label: "Who evaluated your application?", type: "text" },
      { key: "url", label: "Membership or association link", type: "url" },
    ],
  },
  press: {
    question: "Has published material been written about you or your work in professional or major media?",
    entryNoun: "article",
    fields: [
      { key: "outlet", label: "Outlet", type: "text", required: true, placeholder: "e.g. TechCrunch" },
      { key: "articleTitle", label: "Article title", type: "text", required: true },
      { key: "publicationDate", label: "Publication date", type: "text", placeholder: "e.g. March 2025" },
      { key: "language", label: "Language", type: "text", placeholder: "e.g. English" },
      { key: "url", label: "Article link", type: "url", wide: true },
      {
        key: "focus",
        label: "Does the article focus on you or your work?",
        type: "select",
        required: true,
        options: optionsFrom(PRESS_FOCUS_LABELS),
        wide: true,
      },
    ],
  },
  judging: {
    question: "Have you judged the work of others in your field (e.g. as a peer reviewer or competition judge)?",
    entryNoun: "judging role",
    fields: [
      { key: "eventOrJournal", label: "Journal or event", type: "text", required: true, wide: true },
      { key: "dates", label: "Dates", type: "text", placeholder: "e.g. March 2026" },
      { key: "sessionsCompleted", label: "Reviews or judging sessions completed", type: "number" },
      { key: "whatWasAssessed", label: "What did you assess?", type: "textarea" },
      { key: "proofUrl", label: "Proof link", type: "url", wide: true },
      { key: "hasEmailsOrLetters", label: "I have emails or letters confirming this", type: "checkbox" },
    ],
  },
  contributions: {
    question: "Have you made original contributions of major significance to your field?",
    entryNoun: "contribution",
    fields: [
      { key: "whatYouCreated", label: "What did you create?", type: "text", required: true, wide: true },
      { key: "individualContribution", label: "Your individual contribution", type: "textarea" },
      {
        key: "impactEvidence",
        label: "Evidence of impact",
        type: "textarea",
        placeholder: "Users, adoption, revenue, GitHub stars…",
      },
      { key: "organizationsUsingIt", label: "Organisations using it", type: "text", wide: true },
      { key: "relatedPatentsOrPublications", label: "Related patents or publications", type: "text", wide: true },
      {
        key: "independentSourceUrls",
        label: "Independent sources",
        type: "list",
        listOf: "url",
        placeholder: "One link per line",
        help: "Coverage, adoption or citations that weren't written by you.",
      },
    ],
  },
  scholarly: {
    question: "Have you written scholarly articles in professional journals or other major media?",
    entryNoun: "set of publications",
    fields: [
      { key: "titles", label: "Titles", type: "list", required: true, placeholder: "One per line" },
      { key: "venues", label: "Venues", type: "list", placeholder: "Journals or conferences, one per line" },
      { key: "doiLinks", label: "DOI links", type: "list", listOf: "url", placeholder: "One per line" },
      { key: "publicationCount", label: "Number of publications", type: "number" },
      { key: "claimedCitationCount", label: "Total citations", type: "number" },
      {
        key: "citationSource",
        label: "Where is that citation count from?",
        type: "select",
        options: optionsFrom(CITATION_SOURCE_LABELS),
      },
      { key: "asOfDate", label: "Citation count as of", type: "text", placeholder: "e.g. October 2026" },
    ],
  },
  critical_role: {
    question: "Have you held a critical or essential role at a distinguished organisation?",
    entryNoun: "role",
    fields: [
      { key: "organization", label: "Organisation", type: "text", required: true },
      { key: "position", label: "Position", type: "text", required: true },
      { key: "startDate", label: "Start date", type: "text", placeholder: "e.g. January 2024" },
      { key: "endDate", label: "End date", type: "text", placeholder: "or “present”" },
      { key: "responsibilities", label: "Responsibilities", type: "textarea" },
      { key: "measurableContributions", label: "Measurable contributions you personally made", type: "textarea" },
      {
        key: "organizationReputationEvidence",
        label: "Evidence the organisation is distinguished",
        type: "textarea",
        placeholder: "Funding, press coverage, rankings…",
      },
    ],
  },
  remuneration: {
    question: "Do you earn a high salary or other pay compared with others in your field?",
    entryNoun: "compensation record",
    note: "Salary is rarely public — we may ask for documents later.",
    fields: [
      { key: "annualCompensation", label: "Annual compensation", type: "number", required: true },
      { key: "currency", label: "Currency", type: "text", required: true, defaultValue: "USD" },
      { key: "year", label: "Year", type: "number", required: true },
      { key: "jobTitle", label: "Job title", type: "text" },
      { key: "location", label: "Location", type: "text", wide: true },
      { key: "breakdown.base", label: "Base salary", type: "number" },
      { key: "breakdown.bonus", label: "Bonus", type: "number" },
      { key: "breakdown.equity", label: "Equity (annual value)", type: "number" },
      {
        key: "benchmarkSource",
        label: "Benchmark source (if known)",
        type: "text",
        placeholder: "e.g. levels.fyi, government wage data",
        wide: true,
      },
    ],
  },
};

// ── Step list ────────────────────────────────────────────────────────────────

export type StepId = "about" | Criterion | "anything" | "review";

export const STEPS: { id: StepId; title: string }[] = [
  { id: "about", title: "About you" },
  ...CRITERIA.map((c) => ({ id: c, title: CRITERION_LABELS[c] })),
  { id: "anything", title: "Anything else" },
  { id: "review", title: "Review & submit" },
];
