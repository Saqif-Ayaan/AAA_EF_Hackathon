/**
 * PART 3: what the investigate-mode models fill in (structured output), and
 * the code that turns their answers into the shared contract, enforcing the
 * spec's rules (§5) in code like the Part 2 reconciler:
 *   - measurements only for known checks, with real URLs from tool results
 *   - measurements with identityConfidence < 0.7 are ignored
 *   - cleared / confirmed need a relied-on measurement with a source and a value
 *     ("found nothing" never confirms); otherwise still_unknown
 *   - still_unknown always carries a question
 */
import { z } from "zod";
import {
  HypothesisCheckSchema,
  HypothesisMetricSchema,
  HypothesisResultSchema,
  MeasurementSchema,
  type Hypothesis,
  type HypothesisFinding,
  type HypothesisResult,
  type InvestigatorId,
  type Measurement,
  type QueueStatus,
} from "../../lib/schemas";
import { HIGH_CONFIDENCE } from "../../lib/decision";
import { cleanSources } from "./output-schemas";
import { INVESTIGATE_LIMITS } from "./investigate";

const ModelSource = z.object({
  url: z.string().describe("Exact URL that appeared in a tool result"),
  title: z.string(),
  excerpt: z.string().describe("The snippet that supports the measurement"),
});

// Numbers and text are split into two nullable fields: structured-output APIs handle unions unevenly.
export const MeasurementModelOutput = z.object({
  measurements: z.array(
    z.object({
      hypothesisId: z.string().describe("Copied exactly"),
      checkId: z.string().describe("Copied exactly"),
      metric: z.string(),
      valueNumber: z.number().nullable().describe("The measured number, if the value is numeric"),
      valueText: z.string().nullable().describe("The measured value as short text, if it isn't a number"),
      benchmarkDescription: z.string().nullable().describe('What to compare against, e.g. "citation percentile for field and year"'),
      benchmarkValue: z.string().nullable().describe("The benchmark's value"),
      identityConfidence: z.number().describe("0 to 1: is this about the applicant's work?"),
      sources: z.array(ModelSource),
      note: z.string(),
    }),
  ),
});

export const HypothesisResolverModelOutput = z.object({
  result: HypothesisResultSchema,
  reliedOn: z.array(z.number().int()).describe("Numbers of the measurements the result depends on"),
  reasoning: z.string(),
  sharpenedQuestion: z.string().nullable().describe("Only when still_unknown"),
});

export const HypothesisDrafterModelOutput = z.object({
  checks: z
    .array(z.object({ metric: HypothesisMetricSchema, target: z.string(), description: z.string() }))
    .describe("1 to 4 measurable checks"),
  clearsIf: z.string(),
  confirmsIf: z.string(),
  questionIfUnresolved: z.string(),
});

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

function numberOrText(n: number | null, t: string | null): number | string | null {
  if (typeof n === "number" && Number.isFinite(n)) return n;
  const s = t?.trim();
  return s ? s : null;
}

/** An investigator's answer → valid Measurements for this hypothesis's checks only. */
export function toMeasurements(
  raw: z.infer<typeof MeasurementModelOutput> | undefined,
  agentId: InvestigatorId,
  hypothesis: Hypothesis,
  allowedCheckIds: Set<string>,
): Measurement[] {
  return (raw?.measurements ?? []).flatMap((m) => {
    if (m.hypothesisId !== hypothesis.hypothesisId || !allowedCheckIds.has(m.checkId)) return [];
    const check = hypothesis.checks.find((c) => c.checkId === m.checkId)!;
    const benchmarkValue = numberOrText(null, m.benchmarkValue);
    const parsed = MeasurementSchema.safeParse({
      hypothesisId: hypothesis.hypothesisId,
      checkId: m.checkId,
      agentId,
      metric: check.metric,
      value: numberOrText(m.valueNumber, m.valueText),
      benchmark:
        m.benchmarkDescription?.trim() && benchmarkValue !== null
          ? { description: m.benchmarkDescription.trim(), value: Number.isFinite(Number(benchmarkValue)) ? Number(benchmarkValue) : benchmarkValue }
          : null,
      identityConfidence: clamp01(m.identityConfidence),
      sources: cleanSources(m.sources),
      note: m.note,
    });
    return parsed.success ? [parsed.data] : [];
  });
}

/** Counts as evidence for cleared/confirmed: about this applicant, sourced, and actually measured. */
export const isUsable = (m: Measurement) =>
  m.identityConfidence >= INVESTIGATE_LIMITS.minIdentityConfidence && m.sources.length > 0 && m.value !== null;

/**
 * The resolver's answer → a HypothesisFinding with the rules enforced. Returns
 * the indexes (into `measurements`) it relied on as well.
 */
export function toHypothesisFinding(
  raw: z.infer<typeof HypothesisResolverModelOutput> | undefined,
  hypothesis: Hypothesis,
  measurements: Measurement[],
): { finding: HypothesisFinding; reliedOn: number[] } {
  if (!raw) {
    return {
      finding: {
        hypothesisId: hypothesis.hypothesisId,
        result: "still_unknown",
        measurements: [],
        reasoning: "The resolver returned no decision, so this stays open.",
        sharpenedQuestion: hypothesis.questionIfUnresolved,
      },
      reliedOn: [],
    };
  }
  // The prompt numbers measurements from 1.
  const reliedOn = [...new Set(raw.reliedOn.map((n) => n - 1))].filter(
    (i) => i >= 0 && i < measurements.length && measurements[i].identityConfidence >= INVESTIGATE_LIMITS.minIdentityConfidence,
  );
  let { result, reasoning } = raw;
  if (result !== "still_unknown" && !reliedOn.some((i) => isUsable(measurements[i]))) {
    reasoning = `${reasoning} (Kept open: "${result}" needs a sourced, measured value about this applicant.)`;
    result = "still_unknown";
  }
  // Lax rule: confirming a failure mode drops evidence, so it needs HIGH confidence the measurement is about this person.
  if (result === "confirmed" && !reliedOn.some((i) => isUsable(measurements[i]) && measurements[i].identityConfidence >= HIGH_CONFIDENCE)) {
    reasoning = `${reasoning} (Kept open: confirming needs a measurement we are at least ${HIGH_CONFIDENCE * 100}% sure is about this applicant.)`;
    result = "still_unknown";
  }
  const sharpened = raw.sharpenedQuestion?.trim() || hypothesis.questionIfUnresolved;
  return {
    finding: {
      hypothesisId: hypothesis.hypothesisId,
      result,
      measurements: reliedOn.map((i) => measurements[i]),
      reasoning,
      sharpenedQuestion: result === "still_unknown" ? sharpened : null,
    },
    reliedOn,
  };
}

/**
 * Queue status after investigation (spec §5 table, made laxer): only a
 * confirmed failure mode stays `applies`. A sceptic `applies` the
 * investigation could neither confirm nor clear becomes `unknown` (a question
 * for the applicant), not a rejection: being lax is safer.
 */
export function queueStatusAfter(_before: "applies" | "unknown", result: HypothesisResult): QueueStatus {
  if (result === "cleared") return "does_not_apply"; // for `applies` this is the rescue
  if (result === "confirmed") return "applies";
  return "unknown";
}

/** The drafter's answer → a valid Hypothesis (at most 4 checks, ids assigned in code). */
export function toDraftedHypothesis(
  raw: z.infer<typeof HypothesisDrafterModelOutput> | undefined,
  base: Omit<Hypothesis, "checks" | "clearsIf" | "confirmsIf" | "questionIfUnresolved">,
  fallbackQuestion: string | null,
): Hypothesis | null {
  const checks = (raw?.checks ?? [])
    .filter((c) => c.target.trim() && c.description.trim())
    .slice(0, 4)
    .map((c, i) => HypothesisCheckSchema.parse({ checkId: `${base.hypothesisId}_c${i + 1}`, ...c }));
  if (!raw || checks.length === 0) return null;
  return {
    ...base,
    checks,
    clearsIf: raw.clearsIf,
    confirmsIf: raw.confirmsIf,
    questionIfUnresolved: raw.questionIfUnresolved.trim() || fallbackQuestion || "Can you share evidence that addresses this?",
  };
}
