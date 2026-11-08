/**
 * The app's database connection. Import `db` anywhere on the server:
 *   import { db } from "@/db";
 *   import { applicants } from "@/db/schema";
 *
 * Local SQLite file (gitignored). Each git worktree gets its own copy.
 */
import { drizzle } from "drizzle-orm/libsql";
import { resolveFileUrl } from "../lib/project-root";
import * as schema from "./schema";

export const db = drizzle({
  // Relative file: URLs resolve against the project root, so `mastra dev` (which
  // runs from .mastra/output) uses the same local.db as the Next app.
  connection: { url: resolveFileUrl(process.env.DATABASE_URL ?? "file:local.db") },
  schema,
});
