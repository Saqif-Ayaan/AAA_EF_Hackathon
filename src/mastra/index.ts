/**
 * Mastra entry point. Source tools are registered here so they can be tried in
 * the playground (`npx mastra dev`); agents and the o1Pipeline workflow come next.
 *
 * Mastra keeps its own state (workflow snapshots, so the pipeline can pause
 * for the applicant's follow-up and resume) in a separate SQLite file, so
 * `drizzle-kit push` never sees or touches Mastra's tables.
 */
import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";
import { resolveFileUrl } from "../lib/project-root";
import { tools } from "./tools";

export const mastra = new Mastra({
  agents: {},
  workflows: {},
  tools,
  storage: new LibSQLStore({
    id: "mastra-storage",
    // Resolved against the project root: `mastra dev` runs from src/mastra/public.
    url: resolveFileUrl(process.env.MASTRA_DATABASE_URL ?? "file:mastra.db"),
  }),
});
