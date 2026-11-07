/**
 * Mastra entry point. Agents and the o1Pipeline workflow get registered here
 * later (agents worktree). Empty for now on purpose.
 *
 * Mastra keeps its own state (workflow snapshots, so the pipeline can pause
 * for the applicant's follow-up and resume) in a separate SQLite file, so
 * `drizzle-kit push` never sees or touches Mastra's tables.
 */
import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";

export const mastra = new Mastra({
  agents: {},
  workflows: {},
  storage: new LibSQLStore({
    id: "mastra-storage",
    url: process.env.MASTRA_DATABASE_URL ?? "file:mastra.db",
  }),
});
