/**
 * Follow-up resolution (spec PART 2c): the applicant answers one open
 * discrepancy, the resolver agent classifies the answer, and we update the
 * discrepancy, the claim and the finding in one transaction.
 */
import { and, count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { applicants, claims, discrepancies, findings } from "@/db/schema";
import { logEvent } from "@/lib/event-log";
import { CRITERION_LABELS, RESOLUTION_LABELS } from "@/lib/labels";
import {
  ResolverOutputSchema,
  type Criterion,
  type DiscrepancyType,
  type FindingStatus,
  type ResolverOutput,
  type Source,
} from "@/lib/schemas";
import { mastra } from "@/mastra";
import type { Agent } from "@mastra/core/agent";

const MAX_REPLY_CHARS = 5000;

/** An error with an HTTP status the API route can return as-is. */
export class FollowupError extends Error {
  constructor(
    message: string,
    public status: 400 | 404 | 409,
  ) {
    super(message);
  }
}

/** Everything the resolver needs to judge one reply. */
export type ResolverInput = {
  discrepancyId: string;
  applicant: { name: string; alternateNames: string[] };
  claim: { criterion: Criterion; summary: string; payload: unknown };
  finding: { status: FindingStatus; foundValue: string | null; reasoning: string; sources: Source[] } | null;
  discrepancy: { type: DiscrepancyType; description: string; question: string; requestedDocument: string | null };
  reply: string;
};

/** Classifies a reply. The app uses the resolver agent; tests pass a stub (no API calls). */
export type ClassifyReply = (input: ResolverInput) => Promise<ResolverOutput>;

export type FollowupResult = {
  discrepancyId: string;
  resolution: ResolverOutput["resolution"];
  reasoning: string;
  amendedSummary: string | null;
  reframedCriterion: Criterion | null;
  newSources: Source[];
  remainingOpen: number;
  /** PART 3: set when this was a sceptic question; the caller runs recheckHypothesis() in the background. */
  recheck: { hypothesisId: string } | null;
};

export function buildResolverPrompt(input: ResolverInput): string {
  const { applicant, claim, finding, discrepancy } = input;
  const aka = applicant.alternateNames.length ? ` (also known as ${applicant.alternateNames.join(", ")})` : "";
  const sources = finding?.sources.map((s) => `${s.title} <${s.url}>`).join("; ") || "none";
  return [
    `Applicant: ${applicant.name}${aka}`,
    "",
    `Claim (${CRITERION_LABELS[claim.criterion]}): ${claim.summary}`,
    `Original form entry (JSON): ${JSON.stringify(claim.payload)}`,
    "",
    "What our verification found:",
    `- Status: ${finding?.status ?? "no finding recorded"}`,
    `- Found value: ${finding?.foundValue ?? "none"}`,
    `- Reasoning: ${finding?.reasoning ?? "none"}`,
    `- Sources: ${sources}`,
    "",
    `Discrepancy (${discrepancy.type}): ${discrepancy.description}`,
    `Question we asked: ${discrepancy.question}`,
    `Document that would resolve it: ${discrepancy.requestedDocument ?? "none requested"}`,
    "",
    `discrepancyId: ${input.discrepancyId}`,
    "",
    "The applicant's reply is between the <reply> tags:",
    "<reply>",
    input.reply,
    "</reply>",
  ].join("\n");
}

/** Runs a resolver agent on one reply and returns its validated decision. */
export async function runResolver(agent: Agent, input: ResolverInput): Promise<ResolverOutput> {
  const result = await agent.generate(buildResolverPrompt(input), {
    structuredOutput: { schema: ResolverOutputSchema },
    // The answer is short; this leaves ample room for Sonnet's adaptive thinking
    // while avoiding the 128k default on a non-streaming request.
    modelSettings: { maxOutputTokens: 16_000 },
  });
  return ResolverOutputSchema.parse(result.object);
}

/** Default classifier: the registered Mastra resolver agent (claude-sonnet-5-5). */
export const classifyWithResolverAgent: ClassifyReply = (input) => runResolver(mastra.getAgent("resolver"), input);

/** "https://www.Example.com/a/" → "example.com/a" so links can be compared loosely. */
function normalizeUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

/** Only keep links the applicant actually typed — the model must not invent sources. */
export function keepSourcesFromReply(sources: Source[], reply: string): Source[] {
  const haystack = reply.toLowerCase().replace(/https?:\/\//g, "").replace(/www\./g, "");
  const seen = new Set<string>();
  return sources.filter((s) => {
    const key = normalizeUrl(s.url);
    if (!key || seen.has(key) || !haystack.includes(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeSources(existing: Source[], added: Source[]): Source[] {
  const seen = new Set(existing.map((s) => normalizeUrl(s.url)));
  return [...existing, ...added.filter((s) => !seen.has(normalizeUrl(s.url)))];
}

function followupNote(resolution: ResolverOutput["resolution"], reasoning: string, reframedCriterion: Criterion | null) {
  let note = `Applicant follow-up (${RESOLUTION_LABELS[resolution]}): ${reasoning}`;
  if (resolution === "reframed") {
    note += reframedCriterion
      ? ` Reframed as evidence for: ${CRITERION_LABELS[reframedCriterion]}.`
      : " Reframed as supporting evidence only.";
  }
  return note;
}

async function countOpen(applicantId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(discrepancies)
    .innerJoin(claims, eq(discrepancies.claimId, claims.id))
    .where(and(eq(claims.applicantId, applicantId), eq(discrepancies.resolution, "open")));
  return row?.n ?? 0;
}

export async function resolveDiscrepancy(
  { applicantId, discrepancyId, reply }: { applicantId: string; discrepancyId: string; reply: string },
  classify: ClassifyReply = classifyWithResolverAgent,
): Promise<FollowupResult> {
  const text = reply.trim();
  if (!text) throw new FollowupError("Please type a reply first.", 400);
  if (text.length > MAX_REPLY_CHARS) throw new FollowupError("Please keep your reply under 5,000 characters.", 400);

  const [row] = await db
    .select({ d: discrepancies, c: claims, a: applicants })
    .from(discrepancies)
    .innerJoin(claims, eq(discrepancies.claimId, claims.id))
    .innerJoin(applicants, eq(claims.applicantId, applicants.id))
    .where(and(eq(discrepancies.id, discrepancyId), eq(claims.applicantId, applicantId)));
  if (!row) throw new FollowupError("That question doesn't exist for this case.", 404);
  if (row.d.resolution !== "open") throw new FollowupError("That question has already been answered.", 409);

  const [finding] = await db
    .select()
    .from(findings)
    .where(eq(findings.claimId, row.c.id))
    .orderBy(desc(findings.createdAt))
    .limit(1);

  await logEvent({
    applicantId,
    agentId: "resolver",
    type: "status",
    status: "thinking",
    currentAction: "Reading the applicant's reply",
    message: `Resolver is reviewing the reply about: ${row.c.summary}`,
  });

  let output: ResolverOutput;
  try {
    output = await classify({
      discrepancyId,
      applicant: { name: row.a.name, alternateNames: row.a.alternateNames },
      claim: { criterion: row.c.criterion, summary: row.c.summary, payload: row.c.payload },
      finding: finding
        ? { status: finding.status, foundValue: finding.foundValue, reasoning: finding.reasoning, sources: finding.sources }
        : null,
      discrepancy: {
        type: row.d.type,
        description: row.d.description,
        question: row.d.question,
        requestedDocument: row.d.requestedDocument,
      },
      reply: text,
    });
  } catch (error) {
    await logEvent({ applicantId, agentId: "resolver", type: "status", status: "error", message: "Resolver couldn't classify the reply" });
    throw error;
  }

  // Never trust the model for IDs, the reply text, or links: use our own values.
  const resolution = output.resolution;
  const newSources = keepSourcesFromReply(output.newSources, text);
  const amendedSummary = resolution === "amended" ? output.amendedSummary?.trim() || null : null;
  const reframedCriterion = resolution === "reframed" ? output.reframedCriterion : null;

  await db.transaction(async (tx) => {
    const updated = await tx
      .update(discrepancies)
      .set({ resolution, applicantResponse: text, resolvedAt: new Date().toISOString() })
      .where(and(eq(discrepancies.id, discrepancyId), eq(discrepancies.resolution, "open")))
      .returning({ id: discrepancies.id });
    if (updated.length === 0) throw new FollowupError("That question has already been answered.", 409);

    if (amendedSummary) {
      await tx.update(claims).set({ summary: amendedSummary }).where(eq(claims.id, row.c.id));
    }
    if (finding) {
      await tx
        .update(findings)
        .set({
          sources: mergeSources(finding.sources, newSources),
          reasoning: `${finding.reasoning}\n\n${followupNote(resolution, output.reasoning, reframedCriterion)}`,
        })
        .where(eq(findings.id, finding.id));
    }
  });

  await logEvent({
    applicantId,
    agentId: "resolver",
    type: "verdict",
    status: "done",
    found: resolution,
    message: `${RESOLUTION_LABELS[resolution]}: ${output.reasoning}`,
  });

  const remainingOpen = await countOpen(applicantId);
  if (remainingOpen === 0) {
    await logEvent({
      applicantId,
      agentId: "pipeline",
      type: "handoff",
      message: "All follow-up questions answered — ready to build the case.",
    });
  }

  return {
    discrepancyId,
    resolution,
    reasoning: output.reasoning,
    amendedSummary,
    reframedCriterion,
    newSources,
    remainingOpen,
    recheck: row.d.hypothesisId ? { hypothesisId: row.d.hypothesisId } : null,
  };
}
