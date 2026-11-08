/**
 * Writes one event to the `events` table — the live feed the war room polls.
 * Every agent (and the pipeline itself) should log through this.
 */
import { db } from "@/db";
import { events } from "@/db/schema";
import { NewAgentEventSchema, type NewAgentEvent } from "@/lib/schemas";

export async function logEvent(event: NewAgentEvent) {
  const valid = NewAgentEventSchema.parse(event);
  const [row] = await db.insert(events).values(valid).returning();
  return row;
}
