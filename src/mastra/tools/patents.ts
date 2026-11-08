/**
 * PART 3: forward citations of a patent (how many later patents cite it), from
 * the public Google Patents page. No key needed. The spec suggests PatentsView
 * or Lens.org; Google Patents gives the same count plus the citing patents'
 * assignees, which also helps judge licensing/adoption, and needs no key.
 *
 * Benchmark: years since grant (zero citations a year after grant means little;
 * zero after 3+ years is a measurable signal).
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { cached } from "./cache";
import { decodeEntities, fetchOk, HttpError } from "./http";

/** "US 11,234,567 B2", "us11234567", "11234567" → "US11234567B2" / "US11234567". */
export function normalizePatentNumber(input: string): string {
  const s = input.toUpperCase().replace(/[\s,./-]/g, "");
  const m = s.match(/^([A-Z]{2})?(RE|D|PP)?(\d{4,})([A-Z]\d?)?$/);
  if (!m) throw new Error(`Expected a patent number like "US 11,234,567", got "${input}"`);
  return `${m[1] ?? "US"}${m[2] ?? ""}${m[3]}${m[4] ?? ""}`;
}

const text = (s: string | undefined) => (s ? decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() : "");

type Citing = { number: string; assignee: string; title: string; publicationDate: string | null; examinerCited: boolean };

function parseRows(html: string, itemprop: string): Citing[] {
  return html
    .split(`<tr itemprop="${itemprop}"`)
    .slice(1)
    .map((row) => row.split("</tr>")[0])
    .map((row) => ({
      number: text(row.match(/itemprop="publicationNumber">([^<]+)/)?.[1]),
      assignee: text(row.match(/itemprop="assigneeOriginal">([\s\S]*?)<\/span>/)?.[1]),
      title: text(row.match(/itemprop="title">([\s\S]*?)<\/td>/)?.[1]),
      publicationDate: row.match(/itemprop="publicationDate">([\d-]+)/)?.[1] ?? null,
      examinerCited: row.includes('itemprop="examinerCited"'),
    }))
    .filter((r) => r.number);
}

export const patentCitations = createTool({
  id: "patentCitations",
  description:
    "Count the later patents that cite a patent (forward citations), from Google Patents. Returns title, assignee, " +
    "grant date, years since grant, legal status, forward citation counts (direct and via the patent family), and the " +
    "citing patents with their assignees. A company other than the owner citing it repeatedly can hint at adoption.",
  inputSchema: z.object({
    patentNumber: z.string().trim().min(1).describe('Patent number, e.g. "US 11,234,567" or "US11234567B2"'),
  }),
  outputSchema: z.object({
    patentNumber: z.string(),
    url: z.string(),
    title: z.string(),
    assignees: z.array(z.string()),
    inventors: z.array(z.string()),
    filingDate: z.string().nullable(),
    grantDate: z.string().nullable(),
    yearsSinceGrant: z.number().nullable(),
    legalStatus: z.string().nullable(),
    forwardCitations: z.number().describe("Patents citing this patent directly"),
    familyForwardCitations: z.number().describe("Patents citing other members of its family"),
    examinerCitations: z.number().describe("How many of the direct citations were added by examiners"),
    citingAssignees: z.array(z.object({ assignee: z.string(), count: z.number() })),
    citing: z.array(
      z.object({ number: z.string(), assignee: z.string(), title: z.string(), publicationDate: z.string().nullable(), examinerCited: z.boolean() }),
    ),
  }),
  execute: async ({ patentNumber }, { abortSignal }) => {
    const number = normalizePatentNumber(patentNumber);
    return cached("patentCitations", number, async () => {
      const url = `https://patents.google.com/patent/${number}/en`;
      let html: string;
      try {
        const res = await fetchOk(url, {
          signal: abortSignal,
          timeoutMs: 30_000,
          headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)" },
        });
        html = await res.text();
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) throw new Error(`Google Patents has no patent ${number}`);
        throw err;
      }

      const direct = parseRows(html, "forwardReferencesOrig");
      const family = parseRows(html, "forwardReferencesFamily");
      const events = [...html.matchAll(/<dd itemprop="events"[\s\S]*?<time itemprop="date" datetime="([\d-]+)"[\s\S]*?<span itemprop="type">([^<]+)<\/span>/g)].map(
        (m) => ({ date: m[1], type: m[2].trim() }),
      );
      const grantDate = events.find((e) => e.type === "granted")?.date ?? null;
      const yearsSinceGrant = grantDate ? Math.round(((Date.now() - Date.parse(grantDate)) / (365.25 * 864e5)) * 10) / 10 : null;

      const byAssignee = new Map<string, number>();
      for (const c of [...direct, ...family]) if (c.assignee) byAssignee.set(c.assignee, (byAssignee.get(c.assignee) ?? 0) + 1);

      return {
        patentNumber: text(html.match(/itemprop="publicationNumber">([^<]+)/)?.[1]) || number,
        url,
        title: text(html.match(/<span itemprop="title">([\s\S]*?)<\/span>/)?.[1]),
        assignees: [...html.matchAll(/<dd itemprop="assigneeCurrent"[^>]*>([\s\S]*?)<\/dd>/g)].map((m) => text(m[1])).filter(Boolean),
        inventors: [...html.matchAll(/<dd itemprop="inventor"[^>]*>([\s\S]*?)<\/dd>/g)].map((m) => text(m[1])).filter(Boolean).slice(0, 10),
        filingDate: html.match(/itemprop="filingDate"[^>]*datetime="([\d-]+)"/)?.[1] ?? null,
        grantDate,
        yearsSinceGrant,
        legalStatus: text(html.match(/itemprop="legalStatusIfi"[\s\S]*?itemprop="status">([^<]+)/)?.[1]) || null,
        forwardCitations: direct.length,
        familyForwardCitations: family.length,
        examinerCitations: direct.filter((c) => c.examinerCited).length,
        citingAssignees: [...byAssignee].map(([assignee, count]) => ({ assignee, count })).sort((a, b) => b.count - a.count).slice(0, 10),
        citing: [...direct, ...family].slice(0, 25),
      };
    });
  },
});
