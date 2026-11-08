/**
 * PART 3 investigation: sceptic queue items → Hypotheses → Measurements →
 * HypothesisFindings. Used by the o1Pipeline steps and by the recheck after
 * follow-up (src/lib/followup.ts), so it takes everything it needs as
 * arguments.
 *
 *   draftHypotheses()   queue items → Hypotheses (the judge's, or drafted when missing)
 *   investigateWith()   one investigator measures the checks it handles, for every hypothesis
 *   resolveHypothesis() one hypothesis + its measurements → cleared / confirmed / still_unknown
 *
 * Every call logs war-room events with mode "investigate" and the
 * hypothesisId. Failures never throw: they are logged, and the hypothesis
 * ends up still_unknown (a question for the applicant, never a rejection).
 */
import type { Mastra } from "@mastra/core";
import { RequestContext } from "@mastra/core/request-context";
import { z } from "zod";
import {
  HypothesisRecordSchema,
  HypothesisSchema,
  MeasurementSchema,
  type Applicant,
  type Claim,
  type Hypothesis,
  type HypothesisCheck,
  type InvestigatorId,
  type Measurement,
  type SourceAgentId,
} from "../../lib/schemas";
import { ScepticQueueItemSchema, type QueuedItem } from "../../lib/sceptic";
import { CHECKS_BY_AGENT, INVESTIGATE_LIMITS, investigateSetup } from "../agents/investigate";
import {
  HypothesisDrafterModelOutput,
  HypothesisResolverModelOutput,
  MeasurementModelOutput,
  isUsable,
  queueStatusAfter,
  toDraftedHypothesis,
  toHypothesisFinding,
  toMeasurements,
} from "../agents/investigation-schemas";
import { eventLogger, toolEventHooks } from "../events";
import { benchmarkSalary } from "../tools/wages";
import { claimForPrompt, errorMessage, identityOf, json, mapLimit, truncate } from "./prompt-helpers";

export const QueuedHypothesisSchema = z.object({
  hypothesis: HypothesisSchema,
  queueStatusBefore: z.enum(["applies", "unknown"]),
  origin: z.enum(["sceptic", "drafted"]),
  item: ScepticQueueItemSchema,
});
export type QueuedHypothesis = z.infer<typeof QueuedHypothesisSchema>;

export const InvestigatorResultSchema = z.object({
  agentId: z.string(),
  measurements: z.array(MeasurementSchema),
  error: z.string().nullable(),
});
export type InvestigatorResult = z.infer<typeof InvestigatorResultSchema>;

/** One investigated hypothesis, ready to save (HypothesisRecord without the DB fields). */
export const HypothesisOutcomeSchema = HypothesisRecordSchema.omit({ id: true, applicantId: true, createdAt: true }).extend({
  item: ScepticQueueItemSchema,
});
export type HypothesisOutcome = z.infer<typeof HypothesisOutcomeSchema>;

const NAMES: Record<SourceAgentId, string> = {
  devpost: "Devpost research agent",
  linkedin: "LinkedIn research agent",
  github: "GitHub research agent",
  scholar: "Scholar research agent",
  press: "Press research agent",
};

/** The current-action line for a check, e.g. "Counting citations of patent US 11,234,567". */
export function describeCheck(c: HypothesisCheck): string {
  switch (c.metric) {
    case "patent_forward_citations":
      return `Counting citations of patent ${c.target}`;
    case "patent_licence_or_product":
      return `Looking for licences or products using ${c.target}`;
    case "paper_citations":
    case "paper_field_normalised_impact":
      return `Measuring citation impact of ${c.target}`;
    case "repo_adoption":
      return `Measuring adoption of ${c.target}`;
    case "package_downloads":
      return `Counting downloads of ${c.target}`;
    case "press_about_person":
      return `Looking for press about ${c.target}`;
    case "judging_role_completed":
      return `Checking judging role at ${c.target}`;
    case "salary_vs_benchmark":
      return "Comparing salary with the OFLC prevailing wage";
    case "org_reputation":
      return `Checking the reputation of ${c.target}`;
    default:
      return truncate(c.description, 90);
  }
}

// ─── 1. Hypotheses ───────────────────────────────────────────────────────────

/**
 * The judge's Hypothesis for each queue item, or one drafted by the
 * hypothesisDrafter agent when the queue doesn't carry one yet. If drafting
 * fails, a minimal one (a single catch-all check) keeps the item in play.
 */
export async function draftHypotheses(
  mastra: Mastra,
  applicant: Applicant,
  claims: Claim[],
  items: QueuedItem[],
  abortSignal?: AbortSignal,
): Promise<QueuedHypothesis[]> {
  const log = eventLogger(applicant.id, "sceptic", { mode: "investigate" });
  const missing = items.filter((i) => !i.hypothesis).length;
  if (missing) await log("status", `Drafting measurable checks for ${missing} flagged item(s)`, { status: "thinking", progress: 70, currentAction: "Turning failure modes into checks" });

  return mapLimit(items, 4, async (q) => {
    const queueStatusBefore = q.item.status;
    if (q.hypothesis) return { hypothesis: q.hypothesis, queueStatusBefore, origin: "sceptic" as const, item: q.item };

    const claim = claims.find((c) => c.id === q.claimId)!;
    const base = {
      hypothesisId: q.hypothesisId,
      evidenceId: q.item.evidence_id,
      claimId: q.claimId,
      criterion: q.criterion,
      failureMode: q.item.failure_mode,
      precedent: { caseId: q.item.precedent.case_id, quote: q.item.precedent.quote },
    };
    let hypothesis: Hypothesis | null = null;
    try {
      const result = await mastra.getAgent("hypothesisDrafter").generate(
        `Applicant: ${applicant.name} — ${applicant.currentRole} at ${applicant.currentOrganization} (${applicant.field})

The claim (their own evidence):
${json(claimForPrompt(claim))}

The sceptic's flagged item (status "${q.item.status}"):
${json({ failureMode: q.item.failure_mode, reasoning: q.item.reasoning, precedent: q.item.precedent, questionForApplicant: q.item.question_for_applicant ?? null })}`,
        { structuredOutput: { schema: HypothesisDrafterModelOutput }, abortSignal, modelSettings: { maxOutputTokens: 8_000 } },
      );
      hypothesis = toDraftedHypothesis(result.object, base, q.item.question_for_applicant ?? null);
    } catch (err) {
      await log("message", `Couldn't draft checks for "${truncate(q.item.failure_mode, 80)}": ${truncate(errorMessage(err), 160)}`);
    }
    hypothesis ??= {
      ...base,
      checks: [{ checkId: `${q.hypothesisId}_c1`, metric: "other", target: claim.summary, description: `Find independent evidence that addresses: ${q.item.failure_mode}` }],
      clearsIf: "An independent source shows the weakness does not apply to this evidence",
      confirmsIf: "An independent source shows the same weakness the AAO named",
      questionIfUnresolved: q.item.question_for_applicant ?? `We couldn't settle a concern about this evidence (${q.item.failure_mode}). Can you tell us more?`,
    };
    return { hypothesis, queueStatusBefore, origin: "drafted" as const, item: q.item };
  });
}

// ─── 2. Measure ──────────────────────────────────────────────────────────────

type Assignment = { qh: QueuedHypothesis; checks: HypothesisCheck[] };

function assignments(agentId: InvestigatorId, hypotheses: QueuedHypothesis[]): Assignment[] {
  return hypotheses
    .map((qh) => ({ qh, checks: qh.hypothesis.checks.filter((c) => CHECKS_BY_AGENT[agentId](c, qh.hypothesis.criterion)) }))
    .filter((a) => a.checks.length > 0);
}

function investigatePrompt(applicant: Applicant, claim: Claim | undefined, a: Assignment, extraContext?: string) {
  const { checks, ...h } = a.qh.hypothesis;
  return `Applicant identity:
${json(identityOf(applicant))}

Hypothesis to investigate:
${json({ hypothesisId: h.hypothesisId, criterion: h.criterion, failureMode: h.failureMode, precedent: h.precedent, clearsIf: h.clearsIf, confirmsIf: h.confirmsIf })}

The applicant's evidence it is about:
${json(claim ? claimForPrompt(claim) : { id: h.claimId })}

Checks for you to measure (only these):
${json(checks)}
${extraContext ? `\n${extraContext}\n` : ""}`;
}

/** The `wages` investigator: code only. Benchmarks the claimed salary against OFLC Level 4. */
function measureWages(applicant: Applicant, claims: Claim[], a: Assignment): Measurement[] {
  return a.checks.map((check) => {
    const claim = claims.find((c) => c.id === a.qh.hypothesis.claimId);
    const fromClaim = claim?.criterion === "remuneration" ? claim.payload : null;
    const [title, location, amount] = check.target.split("|").map((s) => s.trim());
    const salary = fromClaim?.annualCompensation ?? (Number(String(amount ?? "").replace(/[^\d.]/g, "")) || null);
    const result = benchmarkSalary({
      jobTitle: fromClaim?.jobTitle || title || applicant.currentRole,
      location: fromClaim?.location || location || null,
      salary,
    });
    const base = { hypothesisId: a.qh.hypothesis.hypothesisId, checkId: check.checkId, agentId: "wages" as const, metric: check.metric, identityConfidence: 1 };
    if ("error" in result) return { ...base, value: null, benchmark: null, sources: [], note: `Couldn't benchmark: ${result.error}.` };
    if (fromClaim && fromClaim.currency.toUpperCase() !== "USD") {
      return { ...base, value: null, benchmark: null, sources: [], note: `Salary is in ${fromClaim.currency}; the OFLC table is in USD, so it wasn't compared.` };
    }
    const { levels } = result;
    const fmt = (n: number) => `$${n.toLocaleString("en-US")}`;
    const where = result.levelReached === null ? "no salary given" : result.levelReached === 0 ? "below Level 1" : `at or above Level ${result.levelReached}`;
    return {
      ...base,
      value: result.salary,
      benchmark: { description: `OFLC Level 4 prevailing wage, ${result.occupation}, ${result.areaName} (${result.wageYear})`, value: levels.level4 },
      sources: [
        {
          url: result.sourceUrl,
          title: `DOL OFLC prevailing wages ${result.wageYear}`,
          excerpt: `${result.occupation} (${result.socCode}), ${result.areaName}: Level 1 ${fmt(levels.level1)}, Level 2 ${fmt(levels.level2)}, Level 3 ${fmt(levels.level3)}, Level 4 ${fmt(levels.level4)} per year.`,
        },
      ],
      note: `${result.salary === null ? "No salary" : fmt(result.salary)} is ${where}${result.ratioToLevel4 !== null ? ` (${Math.round(result.ratioToLevel4 * 100)}% of Level 4)` : ""}. ${result.matchNotes.join(" ")}`.trim(),
    };
  });
}

/**
 * One investigator measures every check it handles, across all hypotheses
 * (at most 4 hypotheses at a time, ≤6 tool calls and 60s per check).
 */
export async function investigateWith(
  agentId: InvestigatorId,
  ctx: { mastra: Mastra; applicant: Applicant; claims: Claim[]; hypotheses: QueuedHypothesis[]; abortSignal?: AbortSignal; extraContext?: string },
): Promise<InvestigatorResult> {
  const { mastra, applicant, claims, abortSignal } = ctx;
  const log = eventLogger(applicant.id, agentId, { mode: "investigate" });
  const work = assignments(agentId, ctx.hypotheses);
  if (work.length === 0) {
    await log("status", "Investigating: nothing for this source", { status: "done", progress: 100, currentAction: "Investigating: nothing to measure", found: null });
    return { agentId, measurements: [], error: null };
  }
  const total = work.reduce((n, a) => n + a.checks.length, 0);
  await log("status", `Investigating ${work.length} hypothesis(es), ${total} check(s)`, {
    status: "searching",
    progress: 5,
    currentAction: `Investigating: ${describeCheck(work[0].checks[0])}`,
  });

  let done = 0;
  const errors: string[] = [];
  const perHypothesis = await mapLimit(work, INVESTIGATE_LIMITS.concurrencyPerAgent, async (a) => {
    const hypothesisId = a.qh.hypothesis.hypothesisId;
    const hlog = eventLogger(applicant.id, agentId, { mode: "investigate", hypothesisId });
    const progress = () => 5 + (90 * done) / work.length;
    await hlog("status", `Investigating: ${a.qh.hypothesis.failureMode}`, { status: "searching", progress: progress(), currentAction: describeCheck(a.checks[0]) });

    let measurements: Measurement[] = [];
    try {
      if (agentId === "wages") {
        measurements = measureWages(applicant, claims, a);
      } else {
        const hooks = toolEventHooks(applicant.id, agentId, progress(), { mode: "investigate", hypothesisId });
        const requestContext = new RequestContext();
        requestContext.set("applicantId", applicant.id);
        requestContext.set("agentId", agentId);
        const timeout = AbortSignal.timeout(INVESTIGATE_LIMITS.timeoutMsPerCheck * a.checks.length);
        const signal = abortSignal ? AbortSignal.any([abortSignal, timeout]) : timeout;
        const setup = agentId === "patents" ? null : investigateSetup(agentId, NAMES[agentId]);
        const result = await mastra.getAgent(agentId).generate(investigatePrompt(applicant, claims.find((c) => c.id === a.qh.hypothesis.claimId), a, ctx.extraContext), {
          structuredOutput: { schema: MeasurementModelOutput },
          maxSteps: INVESTIGATE_LIMITS.maxToolCallsPerCheck * a.checks.length + 2,
          hooks,
          requestContext,
          abortSignal: signal,
          modelSettings: { maxOutputTokens: 12_000 },
          ...(setup ? { instructions: setup.instructions, toolsets: { investigate: setup.tools } } : {}),
        });
        measurements = toMeasurements(result.object, agentId, a.qh.hypothesis, new Set(a.checks.map((c) => c.checkId)));
      }
    } catch (err) {
      const message = errorMessage(err);
      errors.push(`${hypothesisId}: ${message}`);
      await hlog("message", `Couldn't finish: ${truncate(message, 200)}`, { found: `Couldn't measure: ${truncate(message, 100)}` });
    }
    done++;
    for (const m of measurements) {
      const value = m.value === null ? "couldn't measure" : String(m.value);
      const bench = m.benchmark ? ` (benchmark: ${m.benchmark.description} = ${m.benchmark.value})` : "";
      await hlog("finding", m.note || `${m.metric}: ${value}`, { found: `${m.metric.replace(/_/g, " ")}: ${value}${bench}`, url: m.sources[0]?.url ?? null, progress: progress() });
    }
    return measurements;
  });

  const measurements = perHypothesis.flat();
  const summary = `${measurements.filter((m) => m.value !== null).length} of ${total} check(s) measured`;
  await log("status", `Investigation done: ${summary}`, { status: errors.length && !measurements.length ? "error" : "done", progress: 100, currentAction: "Done investigating", found: summary });
  return { agentId, measurements, error: errors.length ? errors.join("; ") : null };
}

// ─── 3. Decide ───────────────────────────────────────────────────────────────

/** The hypothesis resolver on one hypothesis and all its measurements, with the spec's rules enforced in code. */
export async function resolveHypothesis(
  mastra: Mastra,
  applicant: Applicant,
  qh: QueuedHypothesis,
  measurements: Measurement[],
  abortSignal?: AbortSignal,
): Promise<HypothesisOutcome> {
  const h = qh.hypothesis;
  const log = eventLogger(applicant.id, "hypothesisResolver", { mode: "investigate", hypothesisId: h.hypothesisId });
  let decided: ReturnType<typeof toHypothesisFinding>;

  if (measurements.length === 0) {
    decided = {
      finding: {
        hypothesisId: h.hypothesisId,
        result: "still_unknown",
        measurements: [],
        reasoning: "No investigator could measure any of its checks, so this stays open. Absence of data is not confirmation.",
        sharpenedQuestion: h.questionIfUnresolved,
      },
      reliedOn: [],
    };
  } else {
    try {
      const result = await mastra.getAgent("hypothesisResolver").generate(
        `Applicant: ${applicant.name}${applicant.alternateNames.length ? ` (also known as ${applicant.alternateNames.join(", ")})` : ""}

Hypothesis:
${json(h)}

Measurements (numbered from 1; usable = sourced, measured, about this applicant):
${measurements.map((m, i) => `${i + 1}. ${json({ ...m, usable: isUsable(m) })}`).join("\n")}`,
        { structuredOutput: { schema: HypothesisResolverModelOutput }, abortSignal, modelSettings: { maxOutputTokens: 8_000 } },
      );
      decided = toHypothesisFinding(result.object, h, measurements);
    } catch (err) {
      decided = toHypothesisFinding(undefined, h, measurements);
      decided.finding.reasoning = `The resolver failed (${truncate(errorMessage(err), 120)}), so this stays open.`;
    }
  }

  const { finding, reliedOn } = decided;
  const after = queueStatusAfter(qh.queueStatusBefore, finding.result);
  const rescued = qh.queueStatusBefore === "applies" && after === "does_not_apply" ? " (rescued)" : "";
  await log("finding", finding.reasoning, {
    found: `${finding.result.replace("_", " ")}${rescued}: ${truncate(h.failureMode, 90)}`,
    url: finding.measurements[0]?.sources[0]?.url ?? null,
  });
  return {
    hypothesisId: h.hypothesisId,
    claimId: h.claimId,
    criterion: h.criterion,
    failureMode: h.failureMode,
    hypothesis: h,
    queueStatusBefore: qh.queueStatusBefore,
    origin: qh.origin,
    result: finding.result,
    queueStatusAfter: after,
    measurements,
    reliedOn,
    reasoning: finding.reasoning,
    sharpenedQuestion: finding.sharpenedQuestion,
    item: qh.item,
  };
}

/** Resolve every hypothesis (4 at a time), with the resolver's status shown on its card. */
export async function resolveAll(
  mastra: Mastra,
  applicant: Applicant,
  hypotheses: QueuedHypothesis[],
  measurements: Measurement[],
  abortSignal?: AbortSignal,
): Promise<HypothesisOutcome[]> {
  const log = eventLogger(applicant.id, "hypothesisResolver", { mode: "investigate" });
  await log("status", `Weighing ${measurements.length} measurement(s) for ${hypotheses.length} hypothesis(es)`, {
    status: "thinking",
    progress: 10,
    currentAction: "Deciding cleared / confirmed / still unknown",
  });
  let done = 0;
  const outcomes = await mapLimit(hypotheses, 4, async (qh) => {
    const o = await resolveHypothesis(mastra, applicant, qh, measurements.filter((m) => m.hypothesisId === qh.hypothesis.hypothesisId), abortSignal);
    done++;
    await log("status", `Resolved ${done} of ${hypotheses.length}`, { progress: 10 + (85 * done) / hypotheses.length });
    return o;
  });
  const count = (r: string) => outcomes.filter((o) => o.result === r).length;
  const rescued = outcomes.filter((o) => o.queueStatusBefore === "applies" && o.queueStatusAfter === "does_not_apply").length;
  const summary = `${count("cleared")} cleared${rescued ? ` (${rescued} rescued)` : ""}, ${count("confirmed")} confirmed, ${count("still_unknown")} still unknown`;
  await log("status", `Done: ${summary}`, { status: "done", progress: 100, currentAction: "Done", found: summary });
  return outcomes;
}
