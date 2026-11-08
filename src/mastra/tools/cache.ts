/**
 * A small JSON file cache for tool results, keyed by input (query, URL, ID), so
 * rehearsal runs are instant (PART 3 §4). One file per tool under
 * .cache/tools/. Delete the folder to refetch everything.
 *
 * Only successful results are cached; errors always retry.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "../../lib/project-root";

const fileFor = (tool: string) => path.join(projectRoot(), ".cache", "tools", `${tool}.json`);

async function readAll<T>(tool: string): Promise<Record<string, { at: string; value: T }>> {
  try {
    return JSON.parse(await readFile(fileFor(tool), "utf8"));
  } catch {
    return {};
  }
}

async function writeEntry<T>(tool: string, key: string, value: T): Promise<void> {
  const file = fileFor(tool);
  await mkdir(path.dirname(file), { recursive: true });
  const all = await readAll<T>(tool); // re-read so parallel runs don't drop each other's entries
  all[key] = { at: new Date().toISOString(), value };
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmp, JSON.stringify(all, null, 2));
  await rename(tmp, file);
}

/** Return the cached result for (tool, key), or compute, cache and return it. Set TOOL_CACHE=off to bypass. */
export async function cached<T>(tool: string, key: string, compute: () => Promise<T>): Promise<T> {
  const k = key.trim().toLowerCase();
  if (process.env.TOOL_CACHE !== "off") {
    const hit = (await readAll<T>(tool))[k];
    if (hit) return hit.value;
  }
  const value = await compute();
  await writeEntry(tool, k, value).catch((err) => console.error(`[cache] ${tool}: ${err instanceof Error ? err.message : err}`));
  return value;
}
