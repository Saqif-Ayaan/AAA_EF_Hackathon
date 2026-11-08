/**
 * War-room contracts that live outside src/lib/schemas.ts (which only main edits):
 *
 * 1. Response shape of GET /api/cases/[id]/events — the one endpoint the
 *    dashboard polls (every 500ms). `[id]` is the applicant id.
 *    - `events` are incremental: only events with id > `?after=N`.
 *    - Everything else is a full snapshot on every poll (it's small).
 *    - `firstEventId` lets the client notice a reset (e.g. the mock re-ran):
 *      if it changes, the client drops its events and refetches from 0.
 *
 * 2. The replay file format (replays/<id>.json) used by /case/[id]?replay=1.
 *    Built only from the shared schemas, so a replay is real recorded data.
 */
import { z } from "zod";
import {
  AgentEventSchema,
  CaseRecordSchema,
  CriterionSchema,
  DiscrepancySchema,
  FindingRecordSchema,
  ScoreSchema,
  type AgentEvent,
  type CaseRecord,
  type Discrepancy,
  type FindingRecord,
  type Score,
} from "./schemas";

export const WarRoomApplicantSchema = z.object({
  id: z.string(),
  name: z.string(),
  alternateNames: z.array(z.string()),
  field: z.string(),
  currentRole: z.string(),
  currentOrganization: z.string(),
  createdAt: z.string(),
});
export type WarRoomApplicant = z.infer<typeof WarRoomApplicantSchema>;

export const WarRoomClaimSchema = z.object({
  id: z.string(),
  criterion: CriterionSchema,
  summary: z.string(),
});
export type WarRoomClaim = z.infer<typeof WarRoomClaimSchema>;

export type CaseEventsResponse = {
  applicant: WarRoomApplicant | null;
  firstEventId: number | null;
  events: AgentEvent[];
  /** True when more events are waiting than one response returns; poll again right away. */
  hasMore: boolean;
  claims: WarRoomClaim[];
  /** Latest finding per claim. */
  findings: FindingRecord[];
  discrepancies: Discrepancy[];
  /** Latest built case (dossier) for this applicant, if any. */
  case: CaseRecord | null;
  /** Latest score for that case, if the scorer has posted one. */
  score: Score | null;
};

/** replays/<id>.json — everything recorded for one case, with original timestamps. */
export const ReplayFileSchema = z.object({
  version: z.literal(1),
  caseId: z.string(),
  savedAt: z.string(),
  applicant: WarRoomApplicantSchema,
  claims: z.array(WarRoomClaimSchema),
  events: z.array(AgentEventSchema),
  /** Every finding ever written (not just the latest), so the ledger evolves as it did live. */
  findings: z.array(FindingRecordSchema),
  discrepancies: z.array(DiscrepancySchema),
  cases: z.array(CaseRecordSchema),
  scores: z.array(ScoreSchema),
});
export type ReplayFile = z.infer<typeof ReplayFileSchema>;

/** What the page hands the dashboard when ?replay=1 is set. */
export type ReplayLoad = { ok: true; file: ReplayFile } | { ok: false; error: string; command?: string };

/** Case ids that are safe to use as a file name under replays/. */
export const SAFE_CASE_ID = /^[A-Za-z0-9_-]{1,64}$/;
