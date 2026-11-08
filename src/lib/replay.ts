/**
 * Server-side loader for replays/<id>.json (used by /case/[id]?replay=1).
 * Record a replay with: npm run replay:save -- --id <id>
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ReplayFileSchema, SAFE_CASE_ID, type ReplayLoad } from "./war-room";

export async function loadReplay(id: string): Promise<ReplayLoad> {
  if (!SAFE_CASE_ID.test(id)) return { ok: false, error: `“${id}” isn't a valid replay name.` };
  const file = path.join(process.cwd(), "replays", `${id}.json`);

  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return {
      ok: false,
      error: `No replay saved for case “${id}”. Record one with:`,
      command: `npm run replay:save -- --id ${id}`,
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: `replays/${id}.json is not valid JSON.` };
  }

  const parsed = ReplayFileSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: `replays/${id}.json doesn't match the replay format (${issue.path.join(".")}: ${issue.message}).`,
    };
  }
  return { ok: true, file: parsed.data };
}
