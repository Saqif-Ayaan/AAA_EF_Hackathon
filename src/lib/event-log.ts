/**
 * THE one way events get into the `events` table — the live feed the war room
 * polls. Every writer goes through here: the pipeline's logEvent tool, the
 * resolver, Build case, the scorer handoff and the mock generator.
 *
 * (Relative imports on purpose: this also runs under tsx scripts and `mastra dev`.)
 */
import { db } from "../db";
import { events } from "../db/schema";
import { NewAgentEventSchema, type NewAgentEvent } from "./schemas";

export async function logEvent(event: NewAgentEvent) {
  const valid = NewAgentEventSchema.parse(event);
  const [row] = await db.insert(events).values(valid).returning();
  return row;
}
