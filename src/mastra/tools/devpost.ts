/**
 * Devpost has no public API, so this reads the page HTML. Devpost embeds
 * schema.org JSON-LD on every page we care about (project awards, hackathon
 * dates/organizer), which is far sturdier than scraping the markup; the rest
 * (team, project cards, participant count) comes from a few regexes.
 *
 * Devpost sits behind Cloudflare and sometimes answers with a bot challenge.
 * We don't try to get past it: we read the page through Exa instead (text only,
 * so the structured fields are mostly empty and the agent reads `text`).
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { exaClient } from "./exa";
import { decodeEntities, fetchOk, htmlToText, HttpError } from "./http";

const USER_AGENT = "o1-intake-agent/0.1 (O-1A evidence verification)";

type Ref = { name: string; url: string };
type JsonLd = Record<string, unknown>;
type PageType = "profile" | "project" | "hackathon" | "other";

const clean = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const refs = (v: unknown): Ref[] =>
  (Array.isArray(v) ? v : v ? [v] : [])
    .filter((x): x is JsonLd => typeof x === "object" && x !== null)
    .map((x) => ({ name: String(x.name ?? ""), url: String(x.url ?? "") }));
const types = (ld: JsonLd) => (Array.isArray(ld["@type"]) ? ld["@type"] : [ld["@type"]]).map(String);
const participantsIn = (s: string) => {
  const m = s.match(/<strong>\s*([\d,]+)\s*<\/strong>\s*participants/i) ?? s.match(/\b([\d,]+)\s+participants\b/i);
  return m ? Number(m[1].replace(/,/g, "")) : null;
};

function parseJsonLd(html: string): JsonLd[] {
  const blocks: JsonLd[] = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed && typeof parsed === "object" && !types(parsed).includes("WebSite")) blocks.push(parsed);
    } catch {
      // Ignore malformed blocks.
    }
  }
  return blocks;
}

/** "jdoe", "devpost.com/jdoe", "https://foo.devpost.com/" → a full https URL on devpost.com. */
function normalizeUrl(input: string): URL {
  let s = input.trim();
  if (!/[./]/.test(s)) s = `devpost.com/${s.replace(/^@/, "")}`;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  const url = new URL(s);
  if (!/(^|\.)devpost\.com$/i.test(url.hostname)) throw new Error(`Not a Devpost URL: ${input}`);
  url.protocol = "https:";
  return url;
}

function pageTypeOf(url: URL): PageType {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const segments = url.pathname.split("/").filter(Boolean);
  if (host !== "devpost.com") return "hackathon"; // <name>.devpost.com (incl. /project-gallery)
  if (segments[0] === "software" && segments[1]) return "project";
  const reserved = ["software", "hackathons", "settings", "portfolio", "search", "users", "api"];
  if (segments.length === 1 && !reserved.includes(segments[0])) return "profile";
  return "other";
}

/** Project cards on a profile or a hackathon's project gallery. */
function parseCards(html: string) {
  const chunks = html.split(/<div class="[^"]*\bgallery-item\b[^"]*"/).slice(1);
  return chunks.flatMap((chunk) => {
    const url = chunk.match(/href="(https:\/\/devpost\.com\/software\/[^"]+)"/)?.[1];
    if (!url) return [];
    const ld = parseJsonLd(chunk)[0];
    const awards = ld ? strings(ld.award) : [];
    return [
      {
        name: clean(chunk.match(/<h5>([\s\S]*?)<\/h5>/)?.[1] ?? ""),
        url,
        tagline: clean(chunk.match(/class="small tagline">([\s\S]*?)<\/p>/)?.[1] ?? "") || null,
        winner: /class="winner"/.test(chunk) || awards.length > 0,
        awards,
        hackathons: ld ? refs(ld.subjectOf) : [],
        builtWith: [] as string[],
      },
    ];
  });
}

/** Everything we can read from a Devpost page's HTML. Exported for testing against saved pages. */
export function parseDevpostHtml(html: string, pageUrl: string) {
  const url = new URL(pageUrl);
  const pageType = pageTypeOf(url);
  const jsonLd = parseJsonLd(html);
  const title = clean(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "") || null;

  let projects = parseCards(html);
  const work = pageType === "project" ? jsonLd.find((b) => types(b).includes("CreativeWork")) : undefined;
  if (work) {
    const awards = strings(work.award);
    projects = [
      {
        name: String(work.name ?? ""),
        url: String(work.url ?? url),
        tagline: typeof work.description === "string" ? work.description : null,
        winner: awards.length > 0,
        awards,
        hackathons: refs(work.subjectOf),
        builtWith: strings(work.keywords),
      },
    ];
  }

  const teamSection = html.match(/<section id="app-team">([\s\S]*?)<\/section>/)?.[1] ?? "";
  const team = [...teamSection.matchAll(/<a class="user-profile-link" href="([^"]+)">([^<]+)<\/a>/g)].map((m) => ({
    name: clean(m[2]),
    profileUrl: m[1],
  }));

  let hackathon = null;
  const event = jsonLd.find((b) => types(b).includes("Hackathon") || types(b).includes("Event"));
  if (event) {
    const loc = event.location as JsonLd | undefined;
    const address = loc?.address as JsonLd | undefined;
    const organizer = event.organizer as JsonLd | undefined;
    const prize = (Array.isArray(event.additionalProperty) ? (event.additionalProperty as JsonLd[]) : []).find((p) =>
      /prize/i.test(String(p?.name)),
    );
    hackathon = {
      name: String(event.name ?? ""),
      url: String(event.url ?? url.origin),
      startDate: typeof event.startDate === "string" ? event.startDate : null,
      endDate: typeof event.endDate === "string" ? event.endDate : null,
      organizer: organizer?.name ? String(organizer.name) : null,
      location: String(address?.streetAddress ?? address?.name ?? loc?.name ?? "") || null,
      participants: participantsIn(html),
      prizePool: prize?.value != null ? `${prize.value} ${prize.unitText ?? ""}`.trim() : null,
    };
  }

  const text = htmlToText(html).replace(/^We've detected that you are using an unsupported browser[\s\S]*?or higher\.\s*/, "");
  return { url: url.toString(), pageType, title, projects, team, hackathon, text };
}

const isChallenge = (html: string) => /<title>Just a moment\.\.\.<\/title>|challenge-platform/i.test(html);

export const devpostFetch = createTool({
  id: "devpostFetch",
  description:
    "Read a Devpost page: a user profile (devpost.com/<user>), a project (devpost.com/software/<slug>), or a hackathon " +
    "(<name>.devpost.com, or its /project-gallery). Returns projects with winner badges and award names, project team " +
    "members, hackathon dates/organizer/participant count, and the page text. If via is \"exa\", Devpost blocked the " +
    "direct request and only the text (plus participant count) is available.",
  inputSchema: z.object({
    url: z.string().trim().min(1).describe("Devpost URL, or just a Devpost username"),
    maxTextChars: z.number().int().min(0).max(30_000).default(4_000).describe("Max characters of page text"),
  }),
  outputSchema: z.object({
    url: z.string(),
    via: z.enum(["direct", "exa"]),
    note: z.string().nullable(),
    pageType: z.enum(["profile", "project", "hackathon", "other"]),
    title: z.string().nullable(),
    projects: z.array(
      z.object({
        name: z.string(),
        url: z.string(),
        tagline: z.string().nullable(),
        winner: z.boolean(),
        awards: z.array(z.string()),
        hackathons: z.array(z.object({ name: z.string(), url: z.string() })),
        builtWith: z.array(z.string()),
      }),
    ),
    team: z.array(z.object({ name: z.string(), profileUrl: z.string() })),
    hackathon: z
      .object({
        name: z.string(),
        url: z.string(),
        startDate: z.string().nullable(),
        endDate: z.string().nullable(),
        organizer: z.string().nullable(),
        location: z.string().nullable(),
        participants: z.number().nullable(),
        prizePool: z.string().nullable(),
      })
      .nullable(),
    text: z.string(),
  }),
  execute: async ({ url: input, maxTextChars }, { abortSignal }) => {
    const url = normalizeUrl(input).toString();

    let blocked: string;
    try {
      const res = await fetchOk(url, { signal: abortSignal, headers: { "User-Agent": USER_AGENT, Accept: "text/html" } });
      const html = await res.text();
      if (!isChallenge(html)) {
        const page = parseDevpostHtml(html, res.url || url);
        return { ...page, via: "direct" as const, note: null, text: page.text.slice(0, maxTextChars) };
      }
      blocked = "a bot challenge";
    } catch (err) {
      if (!(err instanceof HttpError) || ![403, 429, 503].includes(err.status)) throw err;
      blocked = `HTTP ${err.status}`;
    }

    // Blocked: read the same page through Exa instead.
    if (!process.env.EXA_API_KEY?.trim()) {
      throw new Error(`Devpost answered with ${blocked}. Set EXA_API_KEY so devpostFetch can read the page via Exa instead.`);
    }
    const res = await exaClient().getContents(
      [url],
      { text: { maxCharacters: Math.max(maxTextChars, 4_000) } },
      { signal: abortSignal },
    );
    const page = res.results[0];
    if (!page?.text) throw new Error(`Devpost answered with ${blocked} and Exa couldn't read ${url} either`);
    const pageType = pageTypeOf(new URL(url));
    const participants = pageType === "hackathon" ? participantsIn(page.text) : null;
    return {
      url,
      via: "exa" as const,
      note: `Devpost answered with ${blocked}; read via Exa, so only the page text is available.`,
      pageType,
      title: page.title ?? null,
      projects: [],
      team: [],
      hackathon:
        participants === null
          ? null
          : {
              name: page.title ?? "",
              url,
              startDate: null,
              endDate: null,
              organizer: null,
              location: null,
              participants,
              prizePool: null,
            },
      text: page.text.slice(0, maxTextChars),
    };
  },
});
