/**
 * Schemas the models fill in (structured output), plus the code that turns
 * their answers into the shared contract in src/lib/schemas.ts.
 *
 * The model-facing schemas skip `format: uri` and min/max constraints, which
 * structured-output APIs handle unevenly. The sanitizers below enforce those
 * rules in code instead, along with the spec's hard rules:
 *   - only "unverified" may have no sources (so "contradicted" always cites one)
 *   - sources must be real URLs from tool results
 *   - every claim gets exactly one Finding
 */
import { z } from "zod";
import {
  DiscrepancyTypeSchema,
  FindingSchema,
  FindingStatusSchema,
  QuestionerOutputSchema,
  SourceFindingSchema,
  SourceSchema,
  type Finding,
  type QuestionerOutput,
  type Source,
  type SourceAgentId,
  type SourceFinding,
} from "../../lib/schemas";

const ModelSource = z.object({
  url: z.string().describe("Exact URL that appeared in a tool result"),
  title: z.string(),
  excerpt: z.string().describe("The snippet that supports the finding"),
});

export const SourceAgentModelOutput = z.object({
  sourceFindings: z.array(
    z.object({
      claimId: z.string().describe("The claim's id, copied exactly"),
      agentId: z.string(),
      foundValue: z.string().nullable().describe("What the source shows, short and factual; null if nothing found"),
      sources: z.array(ModelSource),
      identityConfidence: z.number().describe("0 to 1: is this evidence about the same person?"),
      note: z.string(),
    }),
  ),
});

export const ReconcilerModelOutput = z.object({
  findings: z.array(
    z.object({
      claimId: z.string(),
      status: FindingStatusSchema,
      foundValue: z.string().nullable(),
      identityConfidence: z.number().describe("0 to 1"),
      sources: z.array(ModelSource).describe("Required unless status is unverified"),
      reasoning: z.string(),
    }),
  ),
});

export const QuestionerModelOutput = z.object({
  type: DiscrepancyTypeSchema,
  description: z.string().describe('What we found vs. what was claimed, e.g. "Claimed 10 citations; OpenAlex shows 5"'),
  question: z.string().describe("One neutral, specific question the applicant can answer in a sentence"),
  requestedDocument: z.string().nullable().describe("The document that would resolve it, or null"),
});

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** Keep only sources with valid http(s) URLs, deduplicated, with trimmed excerpts. */
export function cleanSources(sources: z.infer<typeof ModelSource>[]): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of sources) {
    const parsed = SourceSchema.safeParse({ url: s.url.trim(), title: s.title.trim(), excerpt: s.excerpt.trim().slice(0, 600) });
    if (!parsed.success || !/^https?:\/\//i.test(parsed.data.url) || seen.has(parsed.data.url)) continue;
    seen.add(parsed.data.url);
    out.push(parsed.data);
  }
  return out;
}

/** A source agent's answer → valid SourceFindings for known claims only. */
export function toSourceFindings(
  raw: z.infer<typeof SourceAgentModelOutput> | undefined,
  agentId: SourceAgentId,
  claimIds: Set<string>,
): SourceFinding[] {
  return (raw?.sourceFindings ?? []).flatMap((f) => {
    if (!claimIds.has(f.claimId)) return [];
    const parsed = SourceFindingSchema.safeParse({
      ...f,
      agentId,
      sources: cleanSources(f.sources),
      identityConfidence: clamp01(f.identityConfidence),
    });
    return parsed.success ? [parsed.data] : [];
  });
}

/** The reconciler's answer → exactly one valid Finding per claim, with the spec's rules enforced. */
export function toFindings(raw: z.infer<typeof ReconcilerModelOutput> | undefined, claimIds: string[]): Finding[] {
  const byClaim = new Map<string, Finding>();
  for (const f of raw?.findings ?? []) {
    if (!claimIds.includes(f.claimId) || byClaim.has(f.claimId)) continue;
    const sources = cleanSources(f.sources);
    let { status, reasoning } = f;
    if (status !== "unverified" && sources.length === 0) {
      reasoning = `${reasoning} (Marked unverified: no source was cited for "${status}".)`;
      status = "unverified";
    }
    const parsed = FindingSchema.safeParse({ ...f, status, reasoning, sources, identityConfidence: clamp01(f.identityConfidence) });
    if (parsed.success) byClaim.set(f.claimId, parsed.data);
  }
  return claimIds.map(
    (claimId) =>
      byClaim.get(claimId) ?? {
        claimId,
        status: "unverified",
        foundValue: null,
        identityConfidence: 0,
        sources: [],
        reasoning: "No source agent reported evidence for this claim. Absence online is not proof it is false.",
      },
  );
}

/** The questioner's answer for one finding → a valid QuestionerOutput. */
export function toDiscrepancy(raw: z.infer<typeof QuestionerModelOutput>, claimId: string): QuestionerOutput {
  return QuestionerOutputSchema.parse({ ...raw, claimId, requestedDocument: raw.requestedDocument?.trim() || null });
}
