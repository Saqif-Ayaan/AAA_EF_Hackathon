/**
 * Drizzle tables (SQLite). Column names match the zod schemas in
 * src/lib/schemas.ts, and the enum lists are imported from there.
 *
 * Apply changes to the local database with: npm run db:push
 *
 * (Relative import on purpose: drizzle-kit loads this file outside Next.js and
 * doesn't understand the "@/..." path alias.)
 */
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  AGENT_IDS,
  AGENT_MODES,
  AGENT_STATUSES,
  CRITERIA,
  DISCREPANCY_TYPES,
  EVENT_TYPES,
  FINDING_STATUSES,
  HYPOTHESIS_RESULTS,
  QUEUE_STATUSES,
  RESOLUTIONS,
  type Case,
  type ClaimPayload,
  type Hypothesis,
  type Measurement,
  type ProfileLinks,
  type Source,
} from "../lib/schemas";

const id = () =>
  text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
/** ISO 8601 string, so DB rows and API JSON look identical. */
const createdAt = () =>
  text()
    .notNull()
    .$defaultFn(() => new Date().toISOString());

export const applicants = sqliteTable("applicants", {
  id: id(),
  name: text().notNull(),
  alternateNames: text({ mode: "json" })
    .$type<string[]>()
    .notNull()
    .$defaultFn(() => []),
  email: text().notNull(),
  phone: text(),
  consentToCall: integer({ mode: "boolean" }).notNull().default(false),
  field: text().notNull(),
  currentRole: text().notNull(),
  currentOrganization: text().notNull(),
  usWorkPlan: text().notNull(),
  links: text({ mode: "json" })
    .$type<ProfileLinks>()
    .notNull()
    .$defaultFn(() => ({})),
  cvText: text(),
  additionalInfo: text(),
  createdAt: createdAt(),
});

export const claims = sqliteTable(
  "claims",
  {
    id: id(),
    applicantId: text()
      .notNull()
      .references(() => applicants.id, { onDelete: "cascade" }),
    criterion: text({ enum: CRITERIA }).notNull(),
    payload: text({ mode: "json" }).$type<ClaimPayload>().notNull(), // the raw form entry
    summary: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("claims_applicant_idx").on(t.applicantId)],
);

export const findings = sqliteTable(
  "findings",
  {
    id: id(),
    claimId: text()
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    status: text({ enum: FINDING_STATUSES }).notNull(),
    foundValue: text(),
    identityConfidence: real().notNull(), // 0–1
    sources: text({ mode: "json" })
      .$type<Source[]>()
      .notNull()
      .$defaultFn(() => []),
    reasoning: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("findings_claim_idx").on(t.claimId)],
);

export const discrepancies = sqliteTable(
  "discrepancies",
  {
    id: id(),
    claimId: text()
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    type: text({ enum: DISCREPANCY_TYPES }).notNull(),
    description: text().notNull(),
    question: text().notNull(),
    requestedDocument: text(),
    resolution: text({ enum: RESOLUTIONS }).notNull().default("open"),
    applicantResponse: text(),
    resolvedAt: text(),
    hypothesisId: text(), // PART 3: set for sceptic questions (type "failure_mode")
    createdAt: createdAt(),
  },
  (t) => [index("discrepancies_claim_idx").on(t.claimId)],
);

/** PART 3: one row per sceptic hypothesis, with what the investigation measured and the resolver's verdict. */
export const hypotheses = sqliteTable(
  "hypotheses",
  {
    id: id(),
    applicantId: text()
      .notNull()
      .references(() => applicants.id, { onDelete: "cascade" }),
    hypothesisId: text().notNull(),
    claimId: text()
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    criterion: text({ enum: CRITERIA }).notNull(),
    failureMode: text().notNull(),
    hypothesis: text({ mode: "json" }).$type<Hypothesis>().notNull(),
    queueStatusBefore: text({ enum: ["applies", "unknown"] }).notNull(),
    origin: text({ enum: ["sceptic", "drafted"] }).notNull(),
    result: text({ enum: HYPOTHESIS_RESULTS }).notNull(),
    queueStatusAfter: text({ enum: QUEUE_STATUSES }).notNull(),
    measurements: text({ mode: "json" })
      .$type<Measurement[]>()
      .notNull()
      .$defaultFn(() => []),
    reliedOn: text({ mode: "json" })
      .$type<number[]>()
      .notNull()
      .$defaultFn(() => []),
    reasoning: text().notNull(),
    sharpenedQuestion: text(),
    createdAt: createdAt(),
  },
  (t) => [index("hypotheses_applicant_idx").on(t.applicantId)],
);

export const cases = sqliteTable(
  "cases",
  {
    id: id(),
    applicantId: text()
      .notNull()
      .references(() => applicants.id, { onDelete: "cascade" }),
    caseJson: text({ mode: "json" }).$type<Case>().notNull(),
    markdown: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("cases_applicant_idx").on(t.applicantId)],
);

export const scores = sqliteTable(
  "scores",
  {
    id: id(),
    caseId: text()
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    approvalLikelihood: real().notNull(), // 0–100
    rfeRisk: real().notNull(), // 0–100
    reasoning: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("scores_case_idx").on(t.caseId)],
);

/** Drives the live war-room UI. Integer id so the UI can poll "everything after id N". */
export const events = sqliteTable(
  "events",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    applicantId: text()
      .notNull()
      .references(() => applicants.id, { onDelete: "cascade" }),
    agentId: text({ enum: AGENT_IDS }).notNull(),
    type: text({ enum: EVENT_TYPES }).notNull(),
    message: text().notNull(),
    status: text({ enum: AGENT_STATUSES }),
    currentAction: text(),
    progress: integer(), // 0–100
    url: text(),
    found: text(),
    mode: text({ enum: AGENT_MODES }), // PART 3: verify | investigate
    hypothesisId: text(),
    createdAt: createdAt(),
  },
  (t) => [index("events_applicant_idx").on(t.applicantId, t.id)],
);
