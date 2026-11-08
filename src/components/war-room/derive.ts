/**
 * Folds the raw event stream into what each card shows. Pure, so it is cheap
 * to recompute on every poll (a 60s run is a few hundred events).
 *
 * Event fields are sparse: an event only sets the fields it carries.
 * - `status` / `progress`: last non-null value wins.
 * - `currentAction`: last non-null wins, and it also resets `url` to that
 *   event's url (a new search with no url means "not reading a page now").
 * - `url` on an event without an action updates the page being read.
 * - `found` appends to the card's log of finds.
 */
import { AGENT_IDS, type AgentEvent, type AgentId } from "@/lib/schemas";
import type { PillStatus } from "./meta";

export type Find = { id: number; text: string; /** The agent's plain-English explanation (finding events only). */ detail: string | null; url: string | null; at: number };

export type AgentView = {
  status: PillStatus;
  currentAction: string | null;
  progress: number;
  url: string | null;
  finds: Find[];
  /** Distinct URLs this agent has opened. */
  pagesRead: number;
  lastMessage: string | null;
  /** First event that wasn't "queued" (ms epoch). */
  startedAt: number | null;
  /** When it reached done/error; cleared if it starts working again. */
  endedAt: number | null;
  eventCount: number;
};

const emptyView = (): AgentView => ({
  status: "idle",
  currentAction: null,
  progress: 0,
  url: null,
  finds: [],
  pagesRead: 0,
  lastMessage: null,
  startedAt: null,
  endedAt: null,
  eventCount: 0,
});

export function deriveAgents(events: AgentEvent[]): Record<AgentId, AgentView> {
  const views = Object.fromEntries(AGENT_IDS.map((id) => [id, emptyView()])) as Record<
    AgentId,
    AgentView
  >;

  const urls = new Map<AgentId, Set<string>>();

  for (const e of events) {
    const v = views[e.agentId];
    if (!v) continue; // an agent id this UI doesn't know yet
    const at = Date.parse(e.createdAt);
    v.eventCount++;
    v.lastMessage = e.message;
    if (e.url) {
      const seen = urls.get(e.agentId) ?? new Set<string>();
      seen.add(e.url);
      urls.set(e.agentId, seen);
      v.pagesRead = seen.size;
    }

    if (e.status) {
      v.status = e.status;
      if (e.status !== "queued" && v.startedAt === null) v.startedAt = at;
      if (e.status === "done" || e.status === "error") v.endedAt = at;
      else v.endedAt = null;
    }
    if (e.progress !== null) v.progress = e.progress;
    if (e.currentAction !== null) {
      v.currentAction = e.currentAction;
      v.url = e.url;
    } else if (e.url !== null) {
      v.url = e.url;
    }
    if (e.found) v.finds.push({ id: e.id, text: e.found, detail: e.type === "finding" && e.message !== e.found ? e.message : null, url: e.url, at });
  }
  return views;
}
