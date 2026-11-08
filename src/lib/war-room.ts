/**
 * Response shape of GET /api/cases/[id]/events — the one endpoint the war-room
 * dashboard polls (every 500ms). `[id]` is the applicant id.
 *
 * - `events` are incremental: only events with id > `?after=N`.
 * - Everything else is a full snapshot on every poll (it's small).
 * - `firstEventId` lets the client notice a reset (e.g. the mock re-ran):
 *   if it changes, the client drops its events and refetches from 0.
 */
import type { AgentEvent, Criterion, Discrepancy, FindingRecord } from "./schemas";

export type WarRoomApplicant = {
  id: string;
  name: string;
  alternateNames: string[];
  field: string;
  currentRole: string;
  currentOrganization: string;
  createdAt: string;
};

export type WarRoomClaim = {
  id: string;
  criterion: Criterion;
  summary: string;
};

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
};
