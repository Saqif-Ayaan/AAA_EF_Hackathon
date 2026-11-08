/**
 * LinkedIn via the Apify actor harvestapi/linkedin-profile-search (set
 * APIFY_TOKEN and APIFY_LINKEDIN_ACTOR_ID). It searches LinkedIn for
 * "<full name> <current company>" and returns full profiles; we keep the one
 * whose URL matches the LinkedIn link on the form.
 *
 * Runs take ~20–60s, so outcomes are cached per profile URL in
 * .cache/apify-linkedin.json and rehearsal re-runs are instant. If Apify fails
 * or no result matches, we fall back to an Exa search restricted to linkedin.com.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createTool } from "@mastra/core/tools";
import { ApifyClient } from "apify-client";
import { z } from "zod";
import { projectRoot } from "../../lib/project-root";
import type { AgentId } from "../../lib/schemas";
import { eventLogger } from "../events";
import { searchWeb } from "./exa";
import { requireEnv } from "./http";

const MAX_RESULTS = 10;

/** Input for harvestapi/linkedin-profile-search (schema read from the Apify API). */
function buildActorInput(searchQuery: string): Record<string, unknown> {
  return {
    searchQuery, // fuzzy; the company filters need LinkedIn company URLs, which the form doesn't have
    profileScraperMode: "Full", // experience, education, honors (~$0.004/profile + $0.10/search page)
    maxItems: MAX_RESULTS,
    takePages: 1,
  };
}

/**
 * Queries to try in order. LinkedIn's search often finds nothing for name +
 * company together, so fall back to the name alone (at most two search pages).
 */
const searchQueries = (fullName: string, company?: string) =>
  company ? [`${fullName} ${company}`, fullName] : [fullName];

/** The profile fields that matter for verification (drops pictures, skills lists, interests, etc.). */
const PROFILE_FIELDS = [
  "linkedinUrl", "publicIdentifier", "firstName", "lastName", "headline", "location", "about",
  "followerCount", "connectionsCount", "currentPosition", "experience", "education", "honorsAndAwards",
  "certifications", "publications", "patents", "projects", "organizations", "volunteering", "topSkills",
];
const DROP_KEYS = /picture|logo|image|photo|^_meta$|insights$/i;
function stripMedia(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripMedia);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).filter(([k]) => !DROP_KEYS.test(k)).map(([k, v]) => [k, stripMedia(v)]),
    );
  }
  return value;
}
const trimProfile = (item: Item): Item =>
  Object.fromEntries(PROFILE_FIELDS.filter((k) => item[k] != null).map((k) => [k, stripMedia(item[k])]));

const POLL_SECS = 5;
const RUN_TIMEOUT_SECS = 180;

const cacheFile = () => path.join(projectRoot(), ".cache", "apify-linkedin.json");

type Candidate = { name: string; headline: string | null; url: string | null };
type ApifyOutcome = {
  fetchedAt: string;
  actorId: string;
  runId: string;
  matchedBy: "url" | "name" | null;
  profile: Record<string, unknown> | null;
  candidates: Candidate[];
};

async function readCache(): Promise<Record<string, ApifyOutcome>> {
  try {
    return JSON.parse(await readFile(cacheFile(), "utf8"));
  } catch {
    return {};
  }
}

async function writeCacheEntry(key: string, entry: ApifyOutcome): Promise<void> {
  const file = cacheFile();
  await mkdir(path.dirname(file), { recursive: true });
  const cache = await readCache(); // re-read so parallel runs don't drop each other's entries
  cache[key] = entry;
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(cache, null, 2));
  await rename(tmp, file);
}

/** "linkedin.com/in/Jane-Doe/?trk=x" → "jane-doe"; null if it isn't a /in/ profile URL. */
function linkedInHandle(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const m = url.match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  return m ? decodeURIComponent(m[1]).toLowerCase() : null;
}

/** Any linkedin.com/in/<handle> URL (or a bare handle) → "https://www.linkedin.com/in/<handle>". */
export function normalizeLinkedInUrl(input: string): string {
  const s = input.trim();
  const handle = linkedInHandle(s) ?? (/^[\w%-]+$/.test(s) ? decodeURIComponent(s).toLowerCase() : null);
  if (!handle) throw new Error(`Expected a LinkedIn profile URL like https://www.linkedin.com/in/<handle>, got "${input}"`);
  return `https://www.linkedin.com/in/${handle}`;
}

type Item = Record<string, unknown>;
const itemUrl = (item: Item) =>
  [item.linkedinUrl, item.url, item.profileUrl].find((v): v is string => typeof v === "string") ??
  (typeof item.publicIdentifier === "string" ? `https://www.linkedin.com/in/${item.publicIdentifier}` : null);
const itemName = (item: Item) =>
  String(item.fullName ?? item.name ?? [item.firstName, item.lastName].filter(Boolean).join(" ")).trim();
const itemHandle = (item: Item) =>
  linkedInHandle(itemUrl(item)) ?? (typeof item.publicIdentifier === "string" ? item.publicIdentifier.toLowerCase() : null);
const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export type LinkedInProgress = { status: string; elapsedSecs: number; progress: number; message: string };

type ProgressOpts = { onProgress?: (p: LinkedInProgress) => void; signal?: AbortSignal };

/** Search LinkedIn (name + company, then name only) and pick the matching profile. Throws if Apify fails. */
async function runApifySearch(
  fullName: string,
  company: string | undefined,
  profileUrl: string | null,
  opts: ProgressOpts,
): Promise<ApifyOutcome> {
  const actorId = requireEnv("APIFY_LINKEDIN_ACTOR_ID");
  const client = new ApifyClient({ token: requireEnv("APIFY_TOKEN") });
  const wanted = linkedInHandle(profileUrl);

  let items: Item[] = [];
  let runId = "";
  let match: Item | undefined;
  let matchedBy: ApifyOutcome["matchedBy"] = null;
  for (const query of searchQueries(fullName, company)) {
    ({ items, runId } = await runActor(client, actorId, query, opts));
    match = wanted ? items.find((item) => itemHandle(item) === wanted) : undefined;
    if (match) matchedBy = "url";
    // No LinkedIn link on the form: accept an exact full-name match (lower identity confidence).
    if (!match && !wanted) {
      match = items.find((item) => norm(itemName(item)) === norm(fullName));
      if (match) matchedBy = "name";
    }
    if (match) break;
  }

  return {
    fetchedAt: new Date().toISOString(),
    actorId,
    runId,
    matchedBy,
    profile: match ? trimProfile(match) : null,
    candidates: items
      .filter((item) => item !== match)
      .map((item) => ({
        name: itemName(item),
        headline: typeof item.headline === "string" ? item.headline : null,
        url: itemUrl(item),
      })),
  };
}

/** One actor run for one search query. Throws if the run fails. */
async function runActor(
  client: ApifyClient,
  actorId: string,
  query: string,
  opts: ProgressOpts,
): Promise<{ items: Item[]; runId: string }> {
  const report = (p: LinkedInProgress) => opts.onProgress?.(p);
  const started = Date.now();
  let run = await client.actor(actorId).start(buildActorInput(query), { timeout: RUN_TIMEOUT_SECS });
  report({ status: run.status, elapsedSecs: 0, progress: 5, message: `Searching LinkedIn for "${query}"` });

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
      message: run.statusMessage ?? `LinkedIn search ${run.status.toLowerCase()} (${elapsedSecs}s)`,
    });
  }
  if (run.status !== "SUCCEEDED") {
    throw new Error(`Apify run ${run.id} ended with ${run.status}${run.statusMessage ? `: ${run.statusMessage}` : ""}`);
  }

  const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: MAX_RESULTS });
  return { items: items as Item[], runId: run.id };
}

export const apifyLinkedIn = createTool({
  id: "apifyLinkedIn",
  description:
    "Find the applicant's LinkedIn profile (experience, titles, dates, education, honors) by searching LinkedIn for " +
    "their full name + current company and keeping the result whose URL matches the LinkedIn link on the form. " +
    "Takes 20–60s the first time; cached afterwards. If the scrape fails or nothing matches, returns Exa search " +
    'results from linkedin.com instead (source: "exa").',
  inputSchema: z.object({
    fullName: z.string().trim().min(1).describe("Applicant's full professional name"),
    company: z.string().trim().min(1).optional().describe("Current company / organisation"),
    profileUrl: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("LinkedIn profile URL from the form; used to pick the right search result"),
    forceRefresh: z.boolean().default(false).describe("Ignore the cache and search again"),
  }),
  outputSchema: z.object({
    source: z.enum(["apify", "exa"]),
    matched: z.boolean().describe("A LinkedIn result matched the applicant (see matchedBy)"),
    matchedBy: z.enum(["url", "name"]).nullable(),
    cached: z.boolean(),
    profileUrl: z.string().nullable(),
    fetchedAt: z.string(),
    profile: z.record(z.string(), z.unknown()).nullable().describe("The matched profile, as returned by the actor"),
    candidates: z.array(z.object({ name: z.string(), headline: z.string().nullable(), url: z.string().nullable() })),
    exaResults: z.array(
      z.object({
        url: z.string(),
        title: z.string(),
        excerpt: z.string(),
        publishedDate: z.string().nullable(),
        author: z.string().nullable(),
      }),
    ),
    note: z.string().nullable(),
  }),
  execute: async ({ fullName, company, profileUrl: rawUrl, forceRefresh }, { abortSignal, writer, requestContext }) => {
    const profileUrl = rawUrl ? normalizeLinkedInUrl(rawUrl) : null;
    const cacheKey = profileUrl ?? `search:${norm(fullName)}|${norm(company ?? "")}`;

    // Inside the pipeline, report scrape progress on the LinkedIn agent's card.
    const applicantId = requestContext?.get("applicantId") as string | undefined;
    const agentId = (requestContext?.get("agentId") as AgentId | undefined) ?? "linkedin";
    const log = applicantId ? eventLogger(applicantId, agentId) : null;

    let outcome: ApifyOutcome | null = null;
    let cached = false;
    let failure: string | null = null;
    if (!forceRefresh) {
      outcome = (await readCache())[cacheKey] ?? null;
      cached = outcome !== null;
    }
    if (!outcome) {
      try {
        outcome = await runApifySearch(fullName, company, profileUrl, {
          signal: abortSignal,
          onProgress: (p) => {
            console.error(`[apifyLinkedIn] ${p.progress}% ${p.message}`);
            void writer?.write({ type: "progress", ...p });
            void log?.("status", p.message, {
              status: "reading",
              currentAction: `Scraping LinkedIn (${p.elapsedSecs}s)`,
              url: profileUrl,
            });
          },
        });
        await writeCacheEntry(cacheKey, outcome);
      } catch (err) {
        failure = err instanceof Error ? err.message : String(err);
        console.error(`[apifyLinkedIn] ${failure}`);
      }
    }

    const base = { profileUrl, cached, candidates: outcome?.candidates ?? [] };
    if (outcome?.profile) {
      return {
        ...base,
        source: "apify" as const,
        matched: true,
        matchedBy: outcome.matchedBy,
        fetchedAt: outcome.fetchedAt,
        profile: outcome.profile,
        exaResults: [],
        note: null,
      };
    }

    // Fallback: Exa search restricted to linkedin.com.
    const exaResults = await searchWeb(`"${fullName}"${company ? ` ${company}` : ""}`, {
      numResults: 5,
      includeDomains: ["linkedin.com"],
      signal: abortSignal,
    }).catch((err) => {
      failure = [failure, `Exa fallback failed: ${err instanceof Error ? err.message : err}`].filter(Boolean).join("; ");
      return [];
    });
    return {
      ...base,
      source: "exa" as const,
      matched: false,
      matchedBy: null,
      fetchedAt: outcome?.fetchedAt ?? new Date().toISOString(),
      profile: null,
      exaResults,
      note: failure
        ? `LinkedIn scrape failed (${failure}); showing linkedin.com search results instead.`
        : `No LinkedIn search result matched ${profileUrl ?? `the name "${fullName}"`}; showing linkedin.com search results instead.`,
    };
  },
});
