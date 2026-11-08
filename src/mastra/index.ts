/**
 * Mastra entry point: the source tools, the five source agents, the reconciler
 * and questioner, and the o1Pipeline workflow. All show up in the playground
 * (`npx mastra dev`).
 *
 * Mastra keeps its own state (workflow snapshots, so the pipeline can pause
 * for the applicant's follow-up and resume) in a separate SQLite file, so
 * `drizzle-kit push` never sees or touches Mastra's tables.
 */
import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";
import { resolveFileUrl } from "../lib/project-root";
import { questionerAgent } from "./agents/questioner";
import { reconcilerAgent } from "./agents/reconciler";
import { sourceAgents } from "./agents/source-agents";
import { tools } from "./tools";
import { o1Pipeline } from "./workflows/o1-pipeline";

export const mastra = new Mastra({
  // Keys match the agent ids, so the workflow can call mastra.getAgent("github") etc.
  agents: { ...sourceAgents, reconciler: reconcilerAgent, questioner: questionerAgent },
  workflows: { o1Pipeline },
  tools,
  storage: new LibSQLStore({
    id: "mastra-storage",
    // Resolved against the project root: `mastra dev` runs from src/mastra/public.
    url: resolveFileUrl(process.env.MASTRA_DATABASE_URL ?? "file:mastra.db"),
  }),
});
