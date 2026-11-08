/**
 * PART 3: package adoption — monthly downloads from the npm downloads API and
 * pypistats.org. No keys needed.
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { cached } from "./cache";
import { fetchJson, HttpError } from "./http";

const DownloadsSchema = z.object({
  registry: z.enum(["npm", "pypi"]),
  package: z.string(),
  url: z.string().describe("Public page for the package (use as the source URL)"),
  lastMonth: z.number(),
  lastWeek: z.number().nullable(),
  period: z.string(),
});

async function orNotFound<T>(registry: string, pkg: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) throw new Error(`${registry}: no package named "${pkg}"`);
    throw err;
  }
}

export const npmDownloads = createTool({
  id: "npmDownloads",
  description: "Monthly downloads of an npm package (last 30 days), from the official npm downloads API.",
  inputSchema: z.object({ pkg: z.string().trim().min(1).describe('npm package name, e.g. "zod" or "@scope/name"') }),
  outputSchema: DownloadsSchema,
  execute: async ({ pkg }, { abortSignal }) => {
    const name = pkg.replace(/^https?:\/\/(www\.)?npmjs\.com\/package\//i, "").replace(/\/$/, "");
    return cached("npmDownloads", name, () =>
      orNotFound("npm", name, async () => {
        const month = await fetchJson<{ downloads: number; start: string; end: string }>(
          `https://api.npmjs.org/downloads/point/last-month/${name}`,
          { signal: abortSignal },
        );
        const week = await fetchJson<{ downloads: number }>(`https://api.npmjs.org/downloads/point/last-week/${name}`, {
          signal: abortSignal,
        }).catch(() => null);
        return {
          registry: "npm" as const,
          package: name,
          url: `https://www.npmjs.com/package/${name}`,
          lastMonth: month.downloads,
          lastWeek: week?.downloads ?? null,
          period: `${month.start} to ${month.end}`,
        };
      }),
    );
  },
});

export const pypiDownloads = createTool({
  id: "pypiDownloads",
  description: "Recent downloads of a PyPI package (last month and last week), from pypistats.org.",
  inputSchema: z.object({ pkg: z.string().trim().min(1).describe('PyPI package name, e.g. "requests"') }),
  outputSchema: DownloadsSchema,
  execute: async ({ pkg }, { abortSignal }) => {
    const name = pkg.replace(/^https?:\/\/pypi\.org\/project\//i, "").replace(/\/$/, "").toLowerCase();
    return cached("pypiDownloads", name, () =>
      orNotFound("PyPI", name, async () => {
        const res = await fetchJson<{ data: { last_month: number; last_week: number } }>(
          `https://pypistats.org/api/packages/${encodeURIComponent(name)}/recent`,
          { signal: abortSignal, headers: { "User-Agent": "o1-intake-agent" } },
        );
        return {
          registry: "pypi" as const,
          package: name,
          url: `https://pypistats.org/packages/${name}`,
          lastMonth: res.data.last_month,
          lastWeek: res.data.last_week,
          period: "last 30 days",
        };
      }),
    );
  },
});
