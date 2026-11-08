/**
 * Shared data contract for the whole app.
 *
 * Every piece of data that moves between the intake form, the database, the
 * agents, the UI, and the teammate's scoring agent is defined here with zod.
 *
 * Rules:
 * - Only the main branch (terminal 1) edits this file. Other worktrees merge it in.
 * - The Drizzle tables in src/db/schema.ts reuse the enum arrays below, so the
 *   database and the validation can't drift apart.
 * - Agent output schemas use `.nullable()` (key always present) rather than
 *   `.optional()`, because structured-output models handle that more reliably.
 */
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Enums (plain arrays are exported so Drizzle can reuse them)
// ─────────────────────────────────────────────────────────────────────────────

export const CRITERIA = [
  "awards",
  "membership",
  "press",
  "judging",
  "contributions",
  "scholarly",
  "critical_role",
  "remuneration",
] as const;
export const CriterionSchema = z.enum(CRITERIA);
export type Criterion = z.infer<typeof CriterionSchema>;

export const FINDING_STATUSES = ["corroborated", "partial", "unverified", "contradicted"] as const;
export const FindingStatusSchema = z.enum(FINDING_STATUSES);
export type FindingStatus = z.infer<typeof FindingStatusSchema>;

export const DISCREPANCY_TYPES = [
  "numerical",
  "identity",
  "evidence",
  "insufficient_proof",
  "criterion_fit",
  "failure_mode", // PART 3: a sceptic hypothesis the investigation couldn't settle
] as const;
export const DiscrepancyTypeSchema = z.enum(DISCREPANCY_TYPES);
export type DiscrepancyType = z.infer<typeof DiscrepancyTypeSchema>;

export const RESOLUTIONS = ["open", "amended", "substantiated", "reframed", "escalated"] as const;
export const ResolutionSchema = z.enum(RESOLUTIONS);
export type Resolution = z.infer<typeof ResolutionSchema>;

/** The five parallel research agents (one per source), each shown as a card on the dashboard. */
export const SOURCE_AGENT_IDS = ["devpost", "linkedin", "github", "scholar", "press"] as const;
export const SourceAgentIdSchema = z.enum(SOURCE_AGENT_IDS);
export type SourceAgentId = z.infer<typeof SourceAgentIdSchema>;

/**
 * PART 3 investigate mode: the five source agents plus two new ones —
 * `patents` (LLM) and `wages` (code only, no LLM). Each gets its own card.
 */
export const INVESTIGATOR_IDS = [...SOURCE_AGENT_IDS, "patents", "wages"] as const;
export const InvestigatorIdSchema = z.enum(INVESTIGATOR_IDS);
export type InvestigatorId = z.infer<typeof InvestigatorIdSchema>;

/** Which job a source agent is doing: Part 2 claim verification or Part 3 hypothesis investigation. */
export const AGENT_MODES = ["verify", "investigate"] as const;
export const AgentModeSchema = z.enum(AGENT_MODES);
export type AgentMode = z.infer<typeof AgentModeSchema>;

/** Every agent that can emit events. "pipeline" is the workflow itself (step changes, handoffs). */
export const AGENT_IDS = [
  ...INVESTIGATOR_IDS,
  "reconciler",
  "sceptic",
  "hypothesisResolver",
  "questioner",
  "resolver",
  "caseBuilder",
  "scorer",
  "pipeline",
] as const;
export const AgentIdSchema = z.enum(AGENT_IDS);
export type AgentId = z.infer<typeof AgentIdSchema>;

export const EVENT_TYPES = [
  "status",
  "tool_call",
  "tool_result",
  "message",
  "handoff",
  "finding",
  "verdict",
] as const;
export const EventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventTypeSchema>;

/**
 * Status pill on an agent card. The spec's source-agent states
 * (queued/searching/reading/done/error) plus "thinking" for the reasoning
 * agents (reconciler, questioner, resolver, case builder, scorer).
 */
export const AGENT_STATUSES = ["queued", "searching", "reading", "thinking", "done", "error"] as const;
export const AgentStatusSchema = z.enum(AGENT_STATUSES);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const ARGUMENT_STRENGTHS = ["strong", "moderate", "weak"] as const;
export const EXHIBIT_STATUSES = ["corroborated", "substantiated"] as const;
export const PRESS_FOCUS = ["me", "my_company", "brief_mention"] as const;
export const CITATION_SOURCES = ["google_scholar", "semantic_scholar", "other"] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Small building blocks
// ─────────────────────────────────────────────────────────────────────────────

const Id = z.string().min(1);
/** ISO 8601 timestamp string, e.g. "2026-11-07T18:30:00.000Z". */
const Timestamp = z.iso.datetime();
const RequiredText = z.string().trim().min(1);
const OptionalText = z.string().trim().optional();
/**
 * A link typed by the applicant. Kept lenient (people type "github.com/me");
 * the form should add "https://" if it's missing.
 */
const UserLink = z.string().trim().min(1);
const Year = z.number().int().min(1900).max(2100);

/** A web page an agent used as evidence. Must be a real, clickable URL. */
export const SourceSchema = z.object({
  url: z.url(),
  title: z.string(),
  excerpt: z.string(),
});
export type Source = z.infer<typeof SourceSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// PART 1 — Intake form
// ─────────────────────────────────────────────────────────────────────────────

export const ProfileLinksSchema = z.object({
  linkedin: UserLink.optional(),
  github: UserLink.optional(),
  scholar: UserLink.optional(), // Google Scholar
  orcid: UserLink.optional(),
  devpost: UserLink.optional(),
  website: UserLink.optional(),
});
export type ProfileLinks = z.infer<typeof ProfileLinksSchema>;

/** "About you" step + the final "Anything else" step. */
export const ApplicantInputSchema = z.object({
  name: RequiredText, // full professional name
  alternateNames: z.array(RequiredText).default([]), // maiden names, transliterations, etc.
  email: z.email(),
  phone: OptionalText,
  consentToCall: z.boolean().default(false), // AI follow-up call consent
  field: RequiredText, // field of expertise
  currentRole: RequiredText,
  currentOrganization: RequiredText,
  usWorkPlan: RequiredText,
  links: ProfileLinksSchema.default({}),
  cvText: z.string().optional(), // extracted server-side from the uploaded PDF
  additionalInfo: z.string().optional(), // "Anything significant not on your CV?"
});
export type ApplicantInput = z.infer<typeof ApplicantInputSchema>;

// One schema per criterion step. Each "+ Add another" entry is one of these.

export const AwardEntrySchema = z.object({
  awardName: RequiredText,
  issuingOrganization: RequiredText,
  year: Year,
  whatWasAwarded: OptionalText,
  selectionProcess: OptionalText, // how winners were selected
  recipientsOrEntrants: OptionalText, // e.g. "1 winner out of ~30 teams"
  url: UserLink.optional(), // announcement / certificate
});

export const MembershipEntrySchema = z.object({
  associationName: RequiredText,
  membershipLevel: OptionalText,
  admissionCriteria: OptionalText,
  evaluatedBy: OptionalText, // who evaluated the application
  url: UserLink.optional(),
});

export const PressEntrySchema = z.object({
  outlet: RequiredText,
  articleTitle: RequiredText,
  publicationDate: OptionalText,
  url: UserLink.optional(),
  language: OptionalText,
  focus: z.enum(PRESS_FOCUS), // is the article about me / my company / a brief mention?
});

export const JudgingEntrySchema = z.object({
  eventOrJournal: RequiredText,
  dates: OptionalText,
  sessionsCompleted: z.number().int().nonnegative().optional(), // reviews / judging sessions
  whatWasAssessed: OptionalText,
  proofUrl: UserLink.optional(),
  hasEmailsOrLetters: z.boolean().default(false), // "I have emails/letters"
});

export const ContributionEntrySchema = z.object({
  whatYouCreated: RequiredText,
  individualContribution: OptionalText,
  impactEvidence: OptionalText, // users, adoption, revenue, stars
  organizationsUsingIt: OptionalText,
  relatedPatentsOrPublications: OptionalText,
  independentSourceUrls: z.array(UserLink).default([]),
});

export const ScholarlyEntrySchema = z.object({
  titles: z.array(RequiredText).default([]),
  venues: z.array(RequiredText).default([]),
  doiLinks: z.array(UserLink).default([]),
  publicationCount: z.number().int().nonnegative().optional(),
  claimedCitationCount: z.number().int().nonnegative().optional(),
  citationSource: z.enum(CITATION_SOURCES).optional(),
  asOfDate: OptionalText,
});

export const CriticalRoleEntrySchema = z.object({
  organization: RequiredText,
  position: RequiredText,
  startDate: OptionalText,
  endDate: OptionalText, // or "present"
  responsibilities: OptionalText,
  measurableContributions: OptionalText,
  organizationReputationEvidence: OptionalText, // funding, press, rankings
});

export const RemunerationEntrySchema = z.object({
  annualCompensation: z.number().nonnegative(),
  currency: RequiredText, // e.g. "USD"
  year: Year,
  jobTitle: OptionalText,
  location: OptionalText,
  breakdown: z
    .object({
      base: z.number().nonnegative().optional(),
      bonus: z.number().nonnegative().optional(),
      equity: z.number().nonnegative().optional(),
    })
    .optional(),
  benchmarkSource: OptionalText,
});

export type AwardEntry = z.infer<typeof AwardEntrySchema>;
export type MembershipEntry = z.infer<typeof MembershipEntrySchema>;
export type PressEntry = z.infer<typeof PressEntrySchema>;
export type JudgingEntry = z.infer<typeof JudgingEntrySchema>;
export type ContributionEntry = z.infer<typeof ContributionEntrySchema>;
export type ScholarlyEntry = z.infer<typeof ScholarlyEntrySchema>;
export type CriticalRoleEntry = z.infer<typeof CriticalRoleEntrySchema>;
export type RemunerationEntry = z.infer<typeof RemunerationEntrySchema>;

/** Lookup: criterion → the schema for one entry of that criterion. */
export const CRITERION_ENTRY_SCHEMAS = {
  awards: AwardEntrySchema,
  membership: MembershipEntrySchema,
  press: PressEntrySchema,
  judging: JudgingEntrySchema,
  contributions: ContributionEntrySchema,
  scholarly: ScholarlyEntrySchema,
  critical_role: CriticalRoleEntrySchema,
  remuneration: RemunerationEntrySchema,
} as const satisfies Record<Criterion, z.ZodType>;

/** All criterion steps. A step answered "No" is an empty array. */
export const CriteriaEntriesSchema = z.object({
  awards: z.array(AwardEntrySchema).default([]),
  membership: z.array(MembershipEntrySchema).default([]),
  press: z.array(PressEntrySchema).default([]),
  judging: z.array(JudgingEntrySchema).default([]),
  contributions: z.array(ContributionEntrySchema).default([]),
  scholarly: z.array(ScholarlyEntrySchema).default([]),
  critical_role: z.array(CriticalRoleEntrySchema).default([]),
  remuneration: z.array(RemunerationEntrySchema).default([]),
});
export type CriteriaEntries = z.infer<typeof CriteriaEntriesSchema>;

/** Body of POST /api/applications. */
export const ApplicationSubmissionSchema = z.object({
  applicant: ApplicantInputSchema,
  criteria: CriteriaEntriesSchema,
});
export type ApplicationSubmission = z.infer<typeof ApplicationSubmissionSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Stored records: applicants + claims
// ─────────────────────────────────────────────────────────────────────────────

export const ApplicantSchema = ApplicantInputSchema.extend({
  id: Id,
  // Optional form fields come back from the database as null, not missing.
  phone: z.string().nullable(),
  cvText: z.string().nullable(),
  additionalInfo: z.string().nullable(),
  createdAt: Timestamp,
});
export type Applicant = z.infer<typeof ApplicantSchema>;

const claimBase = {
  id: Id,
  applicantId: Id,
  summary: z.string(), // built in code from the entry fields (no LLM)
  createdAt: Timestamp,
};

/**
 * One claim = one criterion entry from the form. `criterion` tells you which
 * shape `payload` has (TypeScript narrows it automatically in a switch).
 */
export const ClaimSchema = z.discriminatedUnion("criterion", [
  z.object({ ...claimBase, criterion: z.literal("awards"), payload: AwardEntrySchema }),
  z.object({ ...claimBase, criterion: z.literal("membership"), payload: MembershipEntrySchema }),
  z.object({ ...claimBase, criterion: z.literal("press"), payload: PressEntrySchema }),
  z.object({ ...claimBase, criterion: z.literal("judging"), payload: JudgingEntrySchema }),
  z.object({ ...claimBase, criterion: z.literal("contributions"), payload: ContributionEntrySchema }),
  z.object({ ...claimBase, criterion: z.literal("scholarly"), payload: ScholarlyEntrySchema }),
  z.object({ ...claimBase, criterion: z.literal("critical_role"), payload: CriticalRoleEntrySchema }),
  z.object({ ...claimBase, criterion: z.literal("remuneration"), payload: RemunerationEntrySchema }),
]);
export type Claim = z.infer<typeof ClaimSchema>;
/** Any one criterion entry (the `payload` column). */
export type ClaimPayload = Claim["payload"];

// ─────────────────────────────────────────────────────────────────────────────
// PART 2 — Vetting
// ─────────────────────────────────────────────────────────────────────────────

/** What one source agent found for one claim. */
export const SourceFindingSchema = z.object({
  claimId: Id,
  agentId: SourceAgentIdSchema,
  foundValue: z.string().nullable(), // e.g. "Listed as finalist, not fellow"
  sources: z.array(SourceSchema),
  identityConfidence: z.number().min(0).max(1), // is this the same person?
  note: z.string(),
});
export type SourceFinding = z.infer<typeof SourceFindingSchema>;

/** Structured output of each source agent (devpost, linkedin, github, scholar, press). */
export const SourceAgentOutputSchema = z.object({
  sourceFindings: z.array(SourceFindingSchema),
});
export type SourceAgentOutput = z.infer<typeof SourceAgentOutputSchema>;

const findingFields = z.object({
  claimId: Id,
  status: FindingStatusSchema,
  foundValue: z.string().nullable(), // e.g. "5 citations on OpenAlex"
  identityConfidence: z.number().min(0).max(1),
  sources: z.array(SourceSchema), // REQUIRED unless status is "unverified"
  reasoning: z.string(),
});

/** Rule from the spec: only "unverified" may have no sources (so "contradicted" always cites one). */
const hasSourcesUnlessUnverified = (f: { status: FindingStatus; sources: Source[] }) =>
  f.status === "unverified" || f.sources.length > 0;
const sourcesRule = {
  message: "sources are required unless status is 'unverified'",
  path: ["sources"],
};

/** The reconciled verdict for one claim (reconciler output, one per claim). */
export const FindingSchema = findingFields.refine(hasSourcesUnlessUnverified, sourcesRule);
export type Finding = z.infer<typeof FindingSchema>;

/** Structured output of the reconciler agent. */
export const ReconcilerOutputSchema = z.object({
  findings: z.array(FindingSchema),
});
export type ReconcilerOutput = z.infer<typeof ReconcilerOutputSchema>;

export const FindingRecordSchema = findingFields
  .extend({ id: Id, createdAt: Timestamp })
  .refine(hasSourcesUnlessUnverified, sourcesRule);
export type FindingRecord = z.infer<typeof FindingRecordSchema>;

/** Questioner output: one neutral question per non-corroborated finding. */
export const QuestionerOutputSchema = z.object({
  claimId: Id,
  type: DiscrepancyTypeSchema,
  description: z.string(), // "Claimed 10 citations; OpenAlex shows 5"
  question: z.string(), // one specific, neutral question
  requestedDocument: z.string().nullable(), // "Google Scholar profile link"
});
export type QuestionerOutput = z.infer<typeof QuestionerOutputSchema>;

export const DiscrepancySchema = QuestionerOutputSchema.extend({
  id: Id,
  /** PART 3: set when the question comes from a sceptic hypothesis (type "failure_mode"). */
  hypothesisId: z.string().nullable().default(null),
  resolution: ResolutionSchema, // starts as "open"
  applicantResponse: z.string().nullable(),
  resolvedAt: Timestamp.nullable(),
  createdAt: Timestamp,
});
export type Discrepancy = z.infer<typeof DiscrepancySchema>;

/** Resolver output: how the applicant's reply settles one discrepancy. */
export const ResolverOutputSchema = z.object({
  discrepancyId: Id,
  resolution: ResolutionSchema.exclude(["open"]),
  applicantResponse: z.string(), // the reply being classified
  amendedSummary: z.string().nullable(), // new claim summary when "amended"
  reframedCriterion: CriterionSchema.nullable(), // target criterion when "reframed"
  newSources: z.array(SourceSchema), // links the applicant supplied (may be empty)
  reasoning: z.string(),
});
export type ResolverOutput = z.infer<typeof ResolverOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// PART 3 — Investigation mode (PART3_INVESTIGATION_SPEC.md)
//
// The sceptic (rag/, RAG_SPEC.md) flags failure modes from past AAO denials.
// Each flagged item carries a Hypothesis: measurable checks plus the
// conditions that clear or confirm it. The source agents measure; the
// hypothesis resolver decides.
// ─────────────────────────────────────────────────────────────────────────────

export const HYPOTHESIS_METRICS = [
  "patent_forward_citations",
  "patent_licence_or_product",
  "paper_citations",
  "paper_field_normalised_impact",
  "repo_adoption",
  "package_downloads",
  "press_about_person",
  "judging_role_completed",
  "salary_vs_benchmark",
  "org_reputation",
  "other",
] as const;
export const HypothesisMetricSchema = z.enum(HYPOTHESIS_METRICS);
export type HypothesisMetric = z.infer<typeof HypothesisMetricSchema>;

/** Sceptic queue statuses (RAG_SPEC.md). `does_not_apply` only appears after investigation clears an item. */
export const QUEUE_STATUSES = ["applies", "unknown", "does_not_apply"] as const;
export const QueueStatusSchema = z.enum(QUEUE_STATUSES);
export type QueueStatus = z.infer<typeof QueueStatusSchema>;

export const HYPOTHESIS_RESULTS = ["cleared", "confirmed", "still_unknown"] as const;
export const HypothesisResultSchema = z.enum(HYPOTHESIS_RESULTS);
export type HypothesisResult = z.infer<typeof HypothesisResultSchema>;

export const HypothesisCheckSchema = z.object({
  checkId: Id,
  metric: HypothesisMetricSchema,
  target: z.string(), // "US 11,234,567", "doi:10.1145/...", "github.com/x/y"
  description: z.string(), // human-readable
});
export type HypothesisCheck = z.infer<typeof HypothesisCheckSchema>;

export const HypothesisSchema = z.object({
  hypothesisId: Id, // e.g. "hyp_ev4_1"
  evidenceId: Id, // the sceptic's evidence item (our exporter uses the claim id)
  claimId: Id, // link to the Part 2 claim
  criterion: CriterionSchema,
  failureMode: z.string(), // "Patent technically impressive but little impact"
  precedent: z.object({ caseId: z.string(), quote: z.string() }),
  checks: z.array(HypothesisCheckSchema).min(1).max(4),
  clearsIf: z.string(), // "≥10 forward citations, or any licence/product"
  confirmsIf: z.string(), // "0 forward citations ≥3 years after grant"
  questionIfUnresolved: z.string(), // fallback question for the applicant
});
export type Hypothesis = z.infer<typeof HypothesisSchema>;

/** One fact an investigator measured for one check. Agents measure; they do not decide. */
export const MeasurementSchema = z.object({
  hypothesisId: Id,
  checkId: Id,
  agentId: InvestigatorIdSchema,
  metric: z.string(),
  value: z.union([z.number(), z.string(), z.null()]), // null = could not measure
  benchmark: z
    .object({
      description: z.string(), // "median for papers in same field & year"
      value: z.union([z.number(), z.string()]),
    })
    .nullable(),
  identityConfidence: z.number().min(0).max(1),
  sources: z.array(SourceSchema),
  note: z.string(),
});
export type Measurement = z.infer<typeof MeasurementSchema>;

/** The hypothesis resolver's verdict for one hypothesis. */
export const HypothesisFindingSchema = z.object({
  hypothesisId: Id,
  result: HypothesisResultSchema,
  measurements: z.array(MeasurementSchema), // the ones it relied on
  reasoning: z.string(), // one or two sentences, cites values
  sharpenedQuestion: z.string().nullable(), // only when still_unknown
});
export type HypothesisFinding = z.infer<typeof HypothesisFindingSchema>;

/** A source agent's job: verify claims (Part 2) or investigate hypotheses (Part 3). */
export const AgentJobSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("verify"), claims: z.array(ClaimSchema) }),
  z.object({ mode: z.literal("investigate"), hypotheses: z.array(HypothesisSchema) }),
]);
export type AgentJob = z.infer<typeof AgentJobSchema>;

/** One investigated hypothesis as stored (and returned by GET /api/cases/[id]/hypotheses). */
export const HypothesisRecordSchema = z.object({
  id: Id,
  applicantId: Id,
  hypothesisId: Id,
  claimId: Id,
  criterion: CriterionSchema,
  failureMode: z.string(),
  hypothesis: HypothesisSchema,
  queueStatusBefore: QueueStatusSchema.exclude(["does_not_apply"]),
  /** Where the hypothesis came from: the sceptic judge, or our fallback drafter for queues without hypotheses. */
  origin: z.enum(["sceptic", "drafted"]),
  result: HypothesisResultSchema,
  queueStatusAfter: QueueStatusSchema,
  measurements: z.array(MeasurementSchema), // every measurement taken, not only the ones relied on
  reliedOn: z.array(z.number().int().nonnegative()), // indexes into `measurements`
  reasoning: z.string(),
  sharpenedQuestion: z.string().nullable(),
  createdAt: Timestamp,
});
export type HypothesisRecord = z.infer<typeof HypothesisRecordSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// PART 3 — Case builder (this is the handoff contract)
// ─────────────────────────────────────────────────────────────────────────────

export const ExhibitSchema = z.object({
  label: z.string(),
  url: z.string(), // a source URL, or a reference to an applicant-supplied document
  status: z.enum(EXHIBIT_STATUSES),
});
export type Exhibit = z.infer<typeof ExhibitSchema>;

export const CaseSchema = z.object({
  applicantId: Id,
  summary: z.string(), // 3–4 sentence case theory
  criteriaArgued: z.array(
    z.object({
      criterion: CriterionSchema,
      strength: z.enum(ARGUMENT_STRENGTHS),
      argument: z.string(),
      exhibits: z.array(ExhibitSchema),
      weaknesses: z.array(z.string()),
    }),
  ),
  criteriaNotArgued: z.array(z.object({ criterion: CriterionSchema, reason: z.string() })),
  unresolvedIssues: z.array(z.string()),
  suggestedLetterWriters: z.array(z.object({ role: z.string(), reason: z.string() })),
  evidenceStats: z.object({
    totalClaims: z.number().int().nonnegative(),
    corroborated: z.number().int().nonnegative(),
    substantiated: z.number().int().nonnegative(),
    unverified: z.number().int().nonnegative(),
    contradicted: z.number().int().nonnegative(),
  }),
});
export type Case = z.infer<typeof CaseSchema>;

export const CaseRecordSchema = z.object({
  id: Id,
  applicantId: Id,
  caseJson: CaseSchema,
  markdown: z.string(), // rendered dossier for display/download
  createdAt: Timestamp,
});
export type CaseRecord = z.infer<typeof CaseRecordSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// HANDOFF — teammate's scoring agent
// ─────────────────────────────────────────────────────────────────────────────

/** Response of GET /api/cases/[id]/bundle. */
export const CaseBundleSchema = z.object({
  applicant: ApplicantSchema,
  claims: z.array(ClaimSchema),
  findings: z.array(FindingRecordSchema),
  discrepancies: z.array(DiscrepancySchema),
  /** PART 3: investigated sceptic failure modes (empty when the sceptic didn't run). */
  hypotheses: z.array(HypothesisRecordSchema).default([]),
  case: CaseRecordSchema,
});
export type CaseBundle = z.infer<typeof CaseBundleSchema>;

/** Body of POST /api/cases/[id]/score (sent by the scoring agent). */
export const ScoreInputSchema = z.object({
  approvalLikelihood: z.number().min(0).max(100),
  rfeRisk: z.number().min(0).max(100), // risk of a Request for Evidence
  reasoning: z.string(),
});
export type ScoreInput = z.infer<typeof ScoreInputSchema>;

export const ScoreSchema = ScoreInputSchema.extend({
  id: Id,
  caseId: Id,
  createdAt: Timestamp,
});
export type Score = z.infer<typeof ScoreSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Events — drive the live war-room UI (polled every 500ms)
// ─────────────────────────────────────────────────────────────────────────────

/** One event as stored and as returned by GET /api/cases/[id]/events. */
export const AgentEventSchema = z.object({
  id: z.number().int(), // auto-increment, so the UI can poll "events after id N"
  applicantId: Id,
  agentId: AgentIdSchema,
  type: EventTypeSchema,
  message: z.string(),
  status: AgentStatusSchema.nullable(),
  currentAction: z.string().nullable(), // "Searching Devpost for 'Jane Doe'"
  progress: z.number().int().min(0).max(100).nullable(),
  url: z.string().nullable(), // page currently being read
  found: z.string().nullable(), // short result, e.g. "Finalist, not winner"
  // PART 3. Defaults keep older replay files (recorded before these columns) valid.
  mode: AgentModeSchema.nullable().default(null),
  hypothesisId: z.string().nullable().default(null),
  createdAt: Timestamp,
});
export type AgentEvent = z.infer<typeof AgentEventSchema>;

/** What code passes when logging an event (id + createdAt are filled in by the DB). */
export const NewAgentEventSchema = AgentEventSchema.omit({ id: true, createdAt: true }).partial({
  status: true,
  currentAction: true,
  progress: true,
  url: true,
  found: true,
  mode: true,
  hypothesisId: true,
});
export type NewAgentEvent = z.infer<typeof NewAgentEventSchema>;
