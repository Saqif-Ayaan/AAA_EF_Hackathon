/**
 * Write one row to the `events` table — the feed the war-room dashboard polls.
 */
import { createTool } from "@mastra/core/tools";
import { db } from "../../db";
import { events } from "../../db/schema";
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
      const [row] = await db.insert(events).values(input).returning();
      return row;
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
