/**
 * Mastra entry point. Agents and the o1Pipeline workflow are registered here.
 * (One agent per line, so merges from the agents branch stay simple.)
 *
 * Mastra keeps its own state (workflow snapshots, so the pipeline can pause
 * for the applicant's follow-up and resume) in a separate SQLite file, so
 * `drizzle-kit push` never sees or touches Mastra's tables.
 */
import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";
import { resolverAgent } from "./agents/resolver";

export const mastra = new Mastra({
  agents: {
    resolver: resolverAgent,
  },
  workflows: {},
  storage: new LibSQLStore({
    id: "mastra-storage",
    url: process.env.MASTRA_DATABASE_URL ?? "file:mastra.db",
  }),
});
