/**
 * OpenAlex (free scholarly database): find an author, then list their works with
 * citation counts. No key needed; OPENALEX_MAILTO joins the polite pool and the
 * optional OPENALEX_API_KEY gives you your own daily budget.
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { fetchJson } from "./http";

const API = "https://api.openalex.org";

function oa<T>(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const qs = new URLSearchParams(params);
  const mailto = process.env.OPENALEX_MAILTO?.trim();
  const apiKey = process.env.OPENALEX_API_KEY?.trim();
  if (mailto) qs.set("mailto", mailto);
  if (apiKey) qs.set("api_key", apiKey);
  return fetchJson<T>(`${API}${path}?${qs}`, { signal });
}

/** "https://openalex.org/A123" → "A123". */
const shortId = (id: string) => id.replace(/^https?:\/\/openalex\.org\//i, "");

const ORCID = /(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/i;
const AUTHOR_ID = /^(?:https?:\/\/openalex\.org\/)?(A\d+)$/i;

type OaAuthor = {
  id: string;
  display_name: string;
  display_name_alternatives?: string[];
  raw_author_names?: string[];
  orcid: string | null;
  works_count: number;
  cited_by_count: number;
  summary_stats?: { h_index?: number; i10_index?: number };
  last_known_institutions?: { display_name: string }[];
  affiliations?: { institution: { display_name: string }; years: number[] }[];
  topics?: { display_name: string }[];
};

type OaWork = {
  id: string;
  doi: string | null;
  title: string | null;
  publication_year: number | null;
  cited_by_count: number;
  type: string | null;
  primary_location?: { source?: { display_name?: string } | null } | null;
  authorships: { author_position: string; raw_author_name?: string; author: { id: string | null; display_name: string } }[];
};

type OaList<T> = { meta: { count: number }; results: T[] };

export const openAlexAuthor = createTool({
  id: "openAlexAuthor",
  description:
    "Find a researcher on OpenAlex. Returns candidate authors with their ID, name variants, ORCID, works count, " +
    "total citations, h-index and institutions. Search former names separately. Pass an ORCID or OpenAlex ID for an exact match.",
  inputSchema: z.object({
    name: z
      .string()
      .trim()
      .min(1)
      .describe('Author name (e.g. "Jane Doe"), or an ORCID / OpenAlex author ID (A123...) for an exact lookup'),
    limit: z.number().int().min(1).max(25).default(5).describe("Max candidates when searching by name"),
  }),
  outputSchema: z.object({
    query: z.string(),
    totalMatches: z.number(),
    candidates: z.array(
      z.object({
        id: z.string(),
        url: z.string(),
        displayName: z.string(),
        nameVariants: z.array(z.string()),
        orcid: z.string().nullable(),
        worksCount: z.number(),
        citedByCount: z.number(),
        hIndex: z.number().nullable(),
        lastKnownInstitutions: z.array(z.string()),
        affiliations: z.array(z.object({ institution: z.string(), years: z.array(z.number()) })),
        topics: z.array(z.string()),
      }),
    ),
  }),
  execute: async ({ name, limit }, { abortSignal }) => {
    const orcid = name.match(ORCID)?.[1];
    const authorId = name.match(AUTHOR_ID)?.[1];

    let authors: OaAuthor[];
    let total: number;
    if (orcid || authorId) {
      const key = orcid ? `orcid:${orcid}` : authorId!.toUpperCase();
      authors = [await oa<OaAuthor>(`/authors/${key}`, {}, abortSignal)];
      total = 1;
    } else {
      const res = await oa<OaList<OaAuthor>>("/authors", { search: name, "per-page": String(limit) }, abortSignal);
      authors = res.results;
      total = res.meta.count;
    }

    return {
      query: name,
      totalMatches: total,
      candidates: authors.map((a) => ({
        id: shortId(a.id),
        url: a.id,
        displayName: a.display_name,
        nameVariants: [...new Set([...(a.display_name_alternatives ?? []), ...(a.raw_author_names ?? [])])].slice(0, 15),
        orcid: a.orcid,
        worksCount: a.works_count,
        citedByCount: a.cited_by_count,
        hIndex: a.summary_stats?.h_index ?? null,
        lastKnownInstitutions: (a.last_known_institutions ?? []).map((i) => i.display_name),
        affiliations: (a.affiliations ?? []).slice(0, 5).map((af) => ({
          institution: af.institution.display_name,
          years: af.years,
        })),
        topics: (a.topics ?? []).slice(0, 5).map((t) => t.display_name),
      })),
    };
  },
});

export const openAlexWorks = createTool({
  id: "openAlexWorks",
  description:
    "List an OpenAlex author's works (most-cited first by default) with title, year, venue, DOI, citation count, " +
    "and the name printed on each paper (useful for former names). Get the authorId from openAlexAuthor.",
  inputSchema: z.object({
    authorId: z.string().trim().min(1).describe('OpenAlex author ID, e.g. "A5009290031"'),
    limit: z.number().int().min(1).max(100).default(25),
    sort: z.enum(["cited", "recent"]).default("cited"),
  }),
  outputSchema: z.object({
    authorId: z.string(),
    totalWorks: z.number(),
    citationsInList: z.number(),
    works: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        year: z.number().nullable(),
        venue: z.string().nullable(),
        type: z.string().nullable(),
        doi: z.string().nullable(),
        citedByCount: z.number(),
        nameAsPrinted: z.string().nullable(),
        authorPosition: z.string().nullable(),
        authorCount: z.number(),
        authors: z.array(z.string()),
      }),
    ),
  }),
  execute: async ({ authorId, limit, sort }, { abortSignal }) => {
    const id = authorId.match(AUTHOR_ID)?.[1]?.toUpperCase();
    if (!id) throw new Error(`Expected an OpenAlex author ID like "A5009290031", got "${authorId}"`);

    const res = await oa<OaList<OaWork>>(
      "/works",
      {
        filter: `author.id:${id}`,
        sort: sort === "cited" ? "cited_by_count:desc" : "publication_date:desc",
        "per-page": String(limit),
        select: "id,doi,title,publication_year,cited_by_count,type,primary_location,authorships",
      },
      abortSignal,
    );

    const works = res.results.map((w) => {
      const me = w.authorships.find((a) => a.author.id && shortId(a.author.id).toUpperCase() === id);
      return {
        id: shortId(w.id),
        title: w.title ?? "(untitled)",
        year: w.publication_year,
        venue: w.primary_location?.source?.display_name ?? null,
        type: w.type,
        doi: w.doi,
        citedByCount: w.cited_by_count,
        nameAsPrinted: me?.raw_author_name ?? me?.author.display_name ?? null,
        authorPosition: me?.author_position ?? null,
        authorCount: w.authorships.length,
        authors: w.authorships.slice(0, 8).map((a) => a.author.display_name),
      };
    });

    return {
      authorId: id,
      totalWorks: res.meta.count,
      citationsInList: works.reduce((sum, w) => sum + w.citedByCount, 0),
      works,
    };
  },
});
