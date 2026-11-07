/**
 * LinkedIn profile via an Apify Store actor (one that takes a public profile URL
 * and needs no login cookies). Runs take ~20–60s, so results are cached per
 * profile URL in .cache/apify-linkedin.json and rehearsal re-runs are instant.
 *
 * Set APIFY_TOKEN and APIFY_LINKEDIN_ACTOR_ID (e.g. "username/actor-name").
 * If your actor expects a different input shape, change buildActorInput().
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createTool } from "@mastra/core/tools";
import { ApifyClient } from "apify-client";
import { z } from "zod";
import { projectRoot } from "../../lib/project-root";
import { requireEnv } from "./http";

/** Input for the actor. Most no-cookie profile scrapers take a list of profile URLs. */
function buildActorInput(profileUrl: string): Record<string, unknown> {
  return { profileUrls: [profileUrl] };
}

const POLL_SECS = 5;
const RUN_TIMEOUT_SECS = 180;

const cacheFile = () => path.join(projectRoot(), ".cache", "apify-linkedin.json");

type CacheEntry = { fetchedAt: string; actorId: string; runId: string; profile: unknown };
type Cache = Record<string, CacheEntry>;

async function readCache(): Promise<Cache> {
  try {
    return JSON.parse(await readFile(cacheFile(), "utf8")) as Cache;
  } catch {
    return {};
  }
}

async function writeCacheEntry(key: string, entry: CacheEntry): Promise<void> {
  const file = cacheFile();
  await mkdir(path.dirname(file), { recursive: true });
  const cache = await readCache(); // re-read so parallel runs don't drop each other's entries
  cache[key] = entry;
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(cache, null, 2));
  await rename(tmp, file);
}

/** Any linkedin.com/in/<handle> URL (or a bare handle) → "https://www.linkedin.com/in/<handle>". */
export function normalizeLinkedInUrl(input: string): string {
  const s = input.trim();
  const m = s.match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  const handle = m ? m[1] : /^[\w%-]+$/.test(s) ? s : null;
  if (!handle) throw new Error(`Expected a LinkedIn profile URL like https://www.linkedin.com/in/<handle>, got "${input}"`);
  return `https://www.linkedin.com/in/${decodeURIComponent(handle).toLowerCase()}`;
}

export type LinkedInProgress = { status: string; elapsedSecs: number; progress: number; message: string };

/**
 * Scrape one profile (or return the cached copy). `onProgress` fires on every
 * poll so callers (the LinkedIn agent) can emit war-room progress events.
 */
export async function scrapeLinkedInProfile(
  profileUrlInput: string,
  opts: { forceRefresh?: boolean; onProgress?: (p: LinkedInProgress) => void; signal?: AbortSignal } = {},
) {
  const profileUrl = normalizeLinkedInUrl(profileUrlInput);

  if (!opts.forceRefresh) {
    const hit = (await readCache())[profileUrl];
    if (hit) return { profileUrl, cached: true, ...hit };
  }

  const actorId = requireEnv("APIFY_LINKEDIN_ACTOR_ID");
  const client = new ApifyClient({ token: requireEnv("APIFY_TOKEN") });
  const report = (p: LinkedInProgress) => opts.onProgress?.(p);

  const started = Date.now();
  let run = await client.actor(actorId).start(buildActorInput(profileUrl), { timeout: RUN_TIMEOUT_SECS });
  report({ status: run.status, elapsedSecs: 0, progress: 5, message: `Started Apify run ${run.id}` });

  const terminal = ["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"];
  while (!terminal.includes(run.status)) {
    if (opts.signal?.aborted || Date.now() - started > RUN_TIMEOUT_SECS * 1000) {
      await client.run(run.id).abort().catch(() => {});
      throw new Error(`Apify run ${run.id} ${opts.signal?.aborted ? "was cancelled" : `took over ${RUN_TIMEOUT_SECS}s`}; aborted it.`);
    }
    run = (await client.run(run.id).get({ waitForFinish: POLL_SECS })) ?? run;
    const elapsedSecs = Math.round((Date.now() - started) / 1000);
    report({
      status: run.status,
      elapsedSecs,
      // Runs usually finish within a minute; creep toward 95% until they do.
      progress: Math.min(95, 5 + Math.round((elapsedSecs / 60) * 90)),
      message: run.statusMessage ?? `Apify run ${run.status.toLowerCase()} (${elapsedSecs}s)`,
    });
  }

  if (run.status !== "SUCCEEDED") {
    throw new Error(`Apify run ${run.id} ended with ${run.status}${run.statusMessage ? `: ${run.statusMessage}` : ""}`);
  }
  const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 5 });
  if (!items.length) throw new Error(`Apify actor ${actorId} returned no data for ${profileUrl}`);

  const entry: CacheEntry = { fetchedAt: new Date().toISOString(), actorId, runId: run.id, profile: items[0] };
  await writeCacheEntry(profileUrl, entry);
  report({ status: run.status, elapsedSecs: Math.round((Date.now() - started) / 1000), progress: 100, message: "Profile scraped" });
  return { profileUrl, cached: false, ...entry };
}

export const apifyLinkedIn = createTool({
  id: "apifyLinkedIn",
  description:
    "Scrape a public LinkedIn profile (experience, titles, dates, education, honors) with Apify. " +
    "Takes 20–60s the first time; results are cached per profile URL so repeat calls are instant.",
  inputSchema: z.object({
    profileUrl: z.string().trim().min(1).describe("LinkedIn profile URL, e.g. https://www.linkedin.com/in/jane-doe"),
    forceRefresh: z.boolean().default(false).describe("Ignore the cache and scrape again"),
  }),
  outputSchema: z.object({
    profileUrl: z.string(),
    cached: z.boolean(),
    fetchedAt: z.string(),
    actorId: z.string(),
    runId: z.string(),
    profile: z.unknown().describe("The actor's raw output for this profile"),
  }),
  execute: async ({ profileUrl, forceRefresh }, { abortSignal, writer }) =>
    scrapeLinkedInProfile(profileUrl, {
      forceRefresh,
      signal: abortSignal,
      onProgress: (p) => {
        console.error(`[apifyLinkedIn] ${p.progress}% ${p.message}`);
        void writer?.write({ type: "progress", ...p });
      },
    }),
});
