/**
 * Exa web search + page contents. Used by the press agent, the Devpost agent
 * (search restricted to devpost.com) and the LinkedIn fallback (linkedin.com).
 */
import { createTool } from "@mastra/core/tools";
import Exa from "exa-js";
import { z } from "zod";
import { requireEnv } from "./http";

let client: Exa | undefined;
export function exaClient(): Exa {
  client ??= new Exa(requireEnv("EXA_API_KEY"));
  return client;
}
const exa = exaClient;

const SEARCH_TEXT_CHARS = 1_000;

export const exaSearch = createTool({
  id: "exaSearch",
  description:
    "Search the web with Exa. Returns up to numResults pages with url, title and a short excerpt. " +
    "Use includeDomains to restrict to sites like devpost.com or linkedin.com. Open a result in full with exaContents.",
  inputSchema: z.object({
    query: z.string().trim().min(1).describe('Search query, e.g. "Jane Doe" TechCrunch'),
    numResults: z.number().int().min(1).max(25).default(5),
    includeDomains: z
      .array(z.string().trim().min(1))
      .optional()
      .describe('Only return results from these domains, e.g. ["devpost.com"]'),
  }),
  outputSchema: z.object({
    query: z.string(),
    results: z.array(
      z.object({
        url: z.string(),
        title: z.string(),
        excerpt: z.string(),
        publishedDate: z.string().nullable(),
        author: z.string().nullable(),
      }),
    ),
  }),
  execute: async ({ query, numResults, includeDomains }, { abortSignal }) => {
    const res = await exa().search(
      query,
      {
        numResults,
        ...(includeDomains?.length ? { includeDomains } : {}),
        contents: { text: { maxCharacters: SEARCH_TEXT_CHARS }, highlights: true },
      },
      { signal: abortSignal },
    );
    return {
      query,
      results: res.results.map((r) => ({
        url: r.url,
        title: r.title ?? "",
        // Highlights are the query-relevant sentences; fall back to the start of the page.
        excerpt: r.highlights?.length ? r.highlights.join(" … ") : (r.text ?? ""),
        publishedDate: r.publishedDate ?? null,
        author: r.author || null,
      })),
    };
  },
});

export const exaContents = createTool({
  id: "exaContents",
  description:
    "Read the full text of one or more web pages (via Exa). Use it to open an article or profile found by exaSearch " +
    "and check what it actually says.",
  inputSchema: z.object({
    urls: z.array(z.url()).min(1).max(10).describe("Page URLs to read"),
    maxCharacters: z.number().int().min(500).max(50_000).default(8_000).describe("Max characters of text per page"),
  }),
  outputSchema: z.object({
    pages: z.array(
      z.object({
        url: z.string(),
        title: z.string(),
        text: z.string(),
        publishedDate: z.string().nullable(),
        author: z.string().nullable(),
      }),
    ),
    failed: z.array(z.object({ url: z.string(), error: z.string() })),
  }),
  execute: async ({ urls, maxCharacters }, { abortSignal }) => {
    const res = await exa().getContents(urls, { text: { maxCharacters } }, { signal: abortSignal });
    const pages = res.results.map((r) => ({
      url: r.url,
      title: r.title ?? "",
      text: r.text ?? "",
      publishedDate: r.publishedDate ?? null,
      author: r.author || null,
    }));
    const failed = (res.statuses ?? [])
      .filter((s) => s.status !== "success")
      .map((s) => ({
        url: s.id,
        error: [s.error?.tag, s.error?.httpStatusCode && `HTTP ${s.error.httpStatusCode}`].filter(Boolean).join(", ") || s.status,
      }));
    return { pages, failed };
  },
});
