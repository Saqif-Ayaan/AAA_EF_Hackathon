/**
 * The app's database connection. Import `db` anywhere on the server:
 *   import { db } from "@/db";
 *   import { applicants } from "@/db/schema";
 *
 * Local SQLite file (gitignored). Each git worktree gets its own copy.
 */
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

export const db = drizzle({
  connection: { url: process.env.DATABASE_URL ?? "file:local.db" },
  schema,
});
