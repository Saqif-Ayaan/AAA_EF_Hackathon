/**
 * Write one row to the `events` table — the feed the war-room dashboard polls.
 * Writes through src/lib/event-log.ts, the app's single event path.
 */
import { createTool } from "@mastra/core/tools";
import { logEvent as writeEvent } from "../../lib/event-log";
import { AgentEventSchema, NewAgentEventSchema } from "../../lib/schemas";

export const logEvent = createTool({
  id: "logEvent",
  description:
    "Log a war-room event for an applicant: status changes, tool calls/results, findings, handoffs. " +
    "Source agents should set status, currentAction, progress (0-100), url (page being read) and found (short result).",
  inputSchema: NewAgentEventSchema,
  outputSchema: AgentEventSchema,
  execute: async (input) => {
    try {
      return await writeEvent(input);
    } catch (err) {
      const cause = err instanceof Error ? `${err.message} ${String(err.cause ?? "")}` : String(err);
      if (cause.includes("FOREIGN KEY")) {
        throw new Error(`No applicant with id "${input.applicantId}" (events.applicantId must reference applicants.id)`);
      }
      if (cause.includes("no such table")) {
        throw new Error(`The events table doesn't exist yet. Run "npm run db:push" first. (${cause})`);
      }
      throw err;
    }
  },
});
