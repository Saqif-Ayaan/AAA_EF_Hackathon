/**
 * o1Pipeline (PART3_INVESTIGATION_SPEC.md §1):
 *
 *   load claims
 *   → 5 source agents in parallel, mode "verify"        (Part 2)
 *   → reconciler                                         → Finding per claim
 *   → sceptic (rag/, RAG_SPEC.md) on claims not contradicted → queue + Hypotheses
 *   → 7 investigators in parallel, mode "investigate"    → Measurements
 *   → hypothesis resolver                                → cleared / confirmed / still_unknown
 *   → merged questions (discrepancies + still-unknown hypotheses, top 4)
 *   → save findings, discrepancies and hypotheses
 *
 * Follow-up happens once, after all of this (src/lib/followup.ts), so the
 * sceptic's questions reach the applicant too.
 *
 * Every step logs war-room events. A failing agent logs an error and returns
 * nothing instead of failing the run. If the sceptic isn't configured
 * (SCEPTIC_RAG_DIR) or fails, the investigate phase is skipped and the run is
 * exactly Part 2. Saving replaces earlier results, so the pipeline can be re-run.
 */
import { RequestContext } from "@mastra/core/request-context";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { eq, inArray } from "drizzle-orm";
import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { db } from "../../db";
import {
  applicants,
  claims as claimsTable,
  discrepancies as discrepanciesTable,
  findings as findingsTable,
  hypotheses as hypothesesTable,
} from "../../db/schema";
import { decide, type FinalDecision } from "../../lib/decision";
import { CRITERION_LABELS } from "../../lib/labels";
import {
  FROM_RAG,
  evidenceIdsByCriterion,
  investigatedQueue,
  queueItems,
  runSceptic,
  scepticConfig,
  toScepticApplicant,
  type RagCriterion,
} from "../../lib/sceptic";
import {
  ApplicantSchema,
  ClaimSchema,
  CriterionSchema,
  DiscrepancySchema,
  FindingRecordSchema,
  FindingSchema,
  HypothesisRecordSchema,
  SOURCE_AGENT_IDS,
  SourceAgentIdSchema,
  SourceFindingSchema,
  type Applicant,
  type Claim,
  type Criterion,
  type Finding,
  type InvestigatorId,
  type SourceAgentId,
  type SourceFinding,
} from "../../lib/schemas";
import { MergedQuestionSchema, mergeQuestions } from "../agents/merge-questions";
import {
  QuestionerModelOutput,
  ReconcilerModelOutput,
  SourceAgentModelOutput,
  rankDiscrepancies,
  toFindings,
  toSourceFindings,
} from "../agents/output-schemas";
import { eventLogger, toolEventHooks } from "../events";
import {
  HypothesisOutcomeSchema,
  InvestigatorResultSchema,
  QueuedHypothesisSchema,
  draftHypotheses,
  investigateWith,
  resolveAll,
} from "./investigation";
import { claimForPrompt, errorMessage, identityOf, json, truncate } from "./prompt-helpers";

const SOURCE_MAX_STEPS = 14;
/** The merged follow-up list is capped; lower-ranked discrepancies are kept as notes on their findings. */
const MAX_QUESTIONS = 4;

// ─── Prompt building ─────────────────────────────────────────────────────────

function sourcePrompt(applicant: Applicant, claims: Claim[]) {
  return `Applicant identity:
${json(identityOf(applicant))}

All claims (check only the ones your source can speak to):
${json(claims.map(claimForPrompt))}`;
}

function reconcilerPrompt(applicant: Applicant, claims: Claim[], findings: SourceFinding[], failedAgents: string[]) {
  const perClaim = claims.map((c) => ({
    claim: claimForPrompt(c),
    sourceFindings: findings
      .filter((f) => f.claimId === c.id)
      .map(({ agentId, foundValue, sources, identityConfidence, note }) => ({ agentId, foundValue, identityConfidence, note, sources })),
  }));
  return `Applicant identity:
${json(identityOf(applicant))}

Claims and what each source agent found:
${json(perClaim)}
${failedAgents.length ? `\nThese agents failed, so their sources are missing (treat as no evidence, not as negative evidence): ${failedAgents.join("; ")}\n` : ""}
Return exactly one finding for each of these claim ids: ${claims.map((c) => c.id).join(", ")}`;
}

function questionerPrompt(applicant: Applicant, claims: Claim[], allFindings: Finding[], open: Finding[]) {
  const criteriaStatus = claims.map((c) => ({
    criterion: c.criterion,
    summary: c.summary,
    status: allFindings.find((f) => f.claimId === c.id)?.status ?? "unverified",
  }));
  return `Applicant: ${applicant.name}${applicant.alternateNames.length ? ` (also known as ${applicant.alternateNames.join(", ")})` : ""}

The whole case at a glance (every claim and its verification status):
${json(criteriaStatus)}

Findings that need follow-up (draft one discrepancy for each, then rank by impact):
${json(
  open.map((f) => {
    const claim = claims.find((c) => c.id === f.claimId)!;
    return { claim: claimForPrompt(claim), finding: f };
  }),
)}`;
}

// ─── Load ────────────────────────────────────────────────────────────────────

const LoadedSchema = z.object({ applicant: ApplicantSchema, claims: z.array(ClaimSchema) });

const loadStep = createStep({
  id: "load-claims",
  description: "Load the applicant and their claims from the database",
  inputSchema: z.object({ applicantId: z.string().min(1) }),
  outputSchema: LoadedSchema,
  execute: async ({ inputData }) => {
    const { applicantId } = inputData;
    const [applicant] = await db.select().from(applicants).where(eq(applicants.id, applicantId));
    if (!applicant) throw new Error(`No applicant with id "${applicantId}"`);
    const rows = await db.select().from(claimsTable).where(eq(claimsTable.applicantId, applicantId));
    if (rows.length === 0) throw new Error(`Applicant "${applicantId}" has no claims to verify`);

    const loaded = LoadedSchema.parse({ applicant, claims: rows });
    await eventLogger(applicantId, "pipeline")("status", `Vetting started: ${rows.length} claims, 5 source agents`, {
      status: "searching",
      progress: 0,
    });
    for (const agentId of SOURCE_AGENT_IDS) {
      await eventLogger(applicantId, agentId, { mode: "verify" })("status", "Queued", { status: "queued", progress: 0, currentAction: "Waiting to start" });
    }
    return loaded;
  },
});

// ─── Verify (Part 2) ─────────────────────────────────────────────────────────

const SourceStepOutput = z.object({
  agentId: SourceAgentIdSchema,
  sourceFindings: z.array(SourceFindingSchema),
  error: z.string().nullable(),
});

function sourceStep<const Id extends string>(agentId: SourceAgentId, id: Id) {
  return createStep({
    id,
    description: `Run the ${agentId} research agent over all claims (verify mode)`,
    inputSchema: LoadedSchema,
    outputSchema: SourceStepOutput,
    execute: async ({ inputData, mastra, abortSignal }) => {
      const { applicant, claims } = inputData;
      const log = eventLogger(applicant.id, agentId, { mode: "verify" });
      const hooks = toolEventHooks(applicant.id, agentId, 10, { mode: "verify" });
      await log("status", `Reviewing ${claims.length} claims`, {
        status: "searching",
        progress: 5,
        currentAction: "Deciding which claims this source can check",
      });

      // Lets tools (e.g. the LinkedIn scraper) post progress on this agent's card.
      const requestContext = new RequestContext();
      requestContext.set("applicantId", applicant.id);
      requestContext.set("agentId", agentId);

      try {
        const result = await mastra.getAgent(agentId).generate(sourcePrompt(applicant, claims), {
          structuredOutput: { schema: SourceAgentModelOutput },
          maxSteps: SOURCE_MAX_STEPS,
          hooks,
          requestContext,
          abortSignal,
          modelSettings: { maxOutputTokens: 16_000 },
        });
        const sourceFindings = toSourceFindings(result.object, agentId, new Set(claims.map((c) => c.id)));

        for (const f of sourceFindings) {
          const claim = claims.find((c) => c.id === f.claimId)!;
          // found = the headline (full, never cut off); message = the agent's plain-English explanation.
          const found = `${CRITERION_LABELS[claim.criterion]}: ${f.foundValue ?? "nothing found for this claim"}`;
          await log("finding", f.note || found, {
            found,
            url: f.sources[0]?.url ?? null,
            progress: hooks.progress(),
          });
        }
        const summary = sourceFindings.length ? `${sourceFindings.length} claim(s) checked` : "No claims this source can check";
        await log("status", `Done: ${summary}`, { status: "done", progress: 100, currentAction: "Done", found: summary });
        return { agentId, sourceFindings, error: null };
      } catch (err) {
        const message = errorMessage(err);
        await log("status", `Failed: ${truncate(message, 300)}`, { status: "error", progress: 100, found: truncate(message) });
        return { agentId, sourceFindings: [], error: message };
      }
    },
  });
}

const SOURCE_STEP_IDS = {
  devpost: "source-devpost",
  linkedin: "source-linkedin",
  github: "source-github",
  scholar: "source-scholar",
  press: "source-press",
} as const satisfies Record<SourceAgentId, string>;

const sourceSteps = [
  sourceStep("devpost", SOURCE_STEP_IDS.devpost),
  sourceStep("linkedin", SOURCE_STEP_IDS.linkedin),
  sourceStep("github", SOURCE_STEP_IDS.github),
  sourceStep("scholar", SOURCE_STEP_IDS.scholar),
  sourceStep("press", SOURCE_STEP_IDS.press),
] as const;

const FindingsSchema = z.object({ findings: z.array(FindingSchema) });

const reconcileStep = createStep({
  id: "reconcile",
  description: "Merge all source findings into one Finding per claim",
  inputSchema: z.object({
    [SOURCE_STEP_IDS.devpost]: SourceStepOutput,
    [SOURCE_STEP_IDS.linkedin]: SourceStepOutput,
    [SOURCE_STEP_IDS.github]: SourceStepOutput,
    [SOURCE_STEP_IDS.scholar]: SourceStepOutput,
    [SOURCE_STEP_IDS.press]: SourceStepOutput,
  }),
  outputSchema: FindingsSchema,
  execute: async ({ inputData, getStepResultAsync, mastra, abortSignal }) => {
    const { applicant, claims } = await getStepResultAsync(loadStep);
    const results = Object.values(inputData);
    const sourceFindings = results.flatMap((r) => r.sourceFindings);
    const failed = results.filter((r) => r.error).map((r) => `${r.agentId} (${truncate(r.error!, 120)})`);
    const log = eventLogger(applicant.id, "reconciler", { mode: "verify" });

    await eventLogger(applicant.id, "pipeline")(
      "handoff",
      `Source agents → reconciler: ${sourceFindings.length} source findings${failed.length ? `, ${failed.length} agent(s) failed` : ""}`,
    );
    await log("status", `Merging ${sourceFindings.length} source findings into ${claims.length} verdicts`, {
      status: "thinking",
      progress: 10,
      currentAction: "Weighing the evidence per claim",
    });

    try {
      const result = await mastra.getAgent("reconciler").generate(reconcilerPrompt(applicant, claims, sourceFindings, failed), {
        structuredOutput: { schema: ReconcilerModelOutput },
        abortSignal,
        modelSettings: { maxOutputTokens: 32_000 },
      });
      const findings = toFindings(result.object, claims.map((c) => c.id));

      for (const f of findings) {
        const claim = claims.find((c) => c.id === f.claimId)!;
        const found = truncate(`${f.status}${f.foundValue ? ` — ${f.foundValue}` : ""}`);
        await log("finding", `${claim.criterion}: ${found}`, { found, url: f.sources[0]?.url ?? null, progress: 90 });
      }
      const counts = Object.entries(
        findings.reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.status]: (acc[f.status] ?? 0) + 1 }), {}),
      )
        .map(([status, n]) => `${n} ${status}`)
        .join(", ");
      await log("status", `Done: ${counts}`, { status: "done", progress: 100, currentAction: "Done", found: counts });
      return { findings };
    } catch (err) {
      await log("status", `Failed: ${truncate(errorMessage(err), 300)}`, { status: "error", progress: 100 });
      throw err;
    }
  },
});

// ─── Sceptic ─────────────────────────────────────────────────────────────────

const ScepticStepOutput = z.object({
  hypotheses: z.array(QueuedHypothesisSchema),
  /** The queue as the sceptic wrote it (null when the sceptic was skipped or failed). */
  queue: z.unknown().nullable(),
  queueFile: z.string().nullable(),
  /** Evidence ids per RAG criterion, for recomputing the queue summary. */
  evidenceIds: z.record(z.string(), z.array(z.string())),
});

const scepticStep = createStep({
  id: "sceptic",
  description: "Run the sceptic RAG on claims that weren't contradicted, and turn its queue into hypotheses",
  inputSchema: FindingsSchema,
  outputSchema: ScepticStepOutput,
  execute: async ({ inputData, getStepResultAsync, mastra, abortSignal }) => {
    const { applicant, claims } = await getStepResultAsync(loadStep);
    const log = eventLogger(applicant.id, "sceptic", { mode: "investigate" });
    const none = { hypotheses: [], queue: null, queueFile: null, evidenceIds: {} };
    const config = scepticConfig();
    if (config.mode === "off") {
      await log("status", `Sceptic skipped: ${config.reason}`, { status: "done", progress: 100, currentAction: "Skipped", found: `Skipped: ${config.reason}` });
      return none;
    }

    const input = toScepticApplicant(applicant, claims, inputData.findings);
    await eventLogger(applicant.id, "pipeline")("handoff", `Reconciler → sceptic: ${input.evidence.length} evidence item(s) (contradicted claims left out)`);
    await log("status", `Comparing ${input.evidence.length} evidence item(s) with past AAO denials`, {
      status: "searching",
      progress: 5,
      currentAction: "Finding similar AAO decisions",
    });

    try {
      let progress = 5;
      const { queue, file, reused } = await runSceptic(config, input, {
        signal: abortSignal,
        onLine: (line) => {
          progress += (60 - progress) * 0.15;
          void log("tool_result", line, { progress, currentAction: truncate(line.trim(), 100) });
        },
      });
      const { items, skipped } = queueItems(queue, claims);
      for (const s of skipped) await log("message", `Skipped queue item: ${s}`);
      const applies = items.filter((i) => i.item.status === "applies").length;
      const fromJudge = items.filter((i) => i.hypothesis).length;
      await log("message", `${reused ? "Reused" : "Wrote"} ${file}: ${items.length} flagged item(s) (${applies} applies, ${items.length - applies} unknown); routing ${queue.summary.routing}`, {
        progress: 65,
        found: `${items.length} failure mode(s) to investigate`,
      });

      const hypotheses = await draftHypotheses(mastra, applicant, claims, items, abortSignal);
      for (const qh of hypotheses) {
        await eventLogger(applicant.id, "sceptic", { mode: "investigate", hypothesisId: qh.hypothesis.hypothesisId })(
          "finding",
          `${qh.hypothesis.failureMode} — precedent ${qh.hypothesis.precedent.caseId}: "${truncate(qh.hypothesis.precedent.quote, 200)}"`,
          { found: `${CRITERION_LABELS[qh.hypothesis.criterion]} (${qh.queueStatusBefore}): ${qh.hypothesis.failureMode}` },
        );
      }
      const summary = `${hypotheses.length} hypothesis(es), ${fromJudge} from the judge, ${hypotheses.length - fromJudge} drafted`;
      await log("status", `Done: ${summary}`, { status: "done", progress: 100, currentAction: "Done", found: summary });
      return { hypotheses, queue, queueFile: file, evidenceIds: evidenceIdsByCriterion(input) };
    } catch (err) {
      // The investigation is extra: without the sceptic the run is still a complete Part 2 run.
      const message = errorMessage(err);
      await log("status", `Failed: ${truncate(message, 300)}`, { status: "error", progress: 100, found: truncate(message) });
      return none;
    }
  },
});

// ─── Investigate ─────────────────────────────────────────────────────────────

function investigateStep<const Id extends string>(agentId: InvestigatorId, id: Id) {
  return createStep({
    id,
    description: `Run the ${agentId} investigator over the sceptic's hypotheses (investigate mode)`,
    inputSchema: ScepticStepOutput,
    outputSchema: InvestigatorResultSchema,
    execute: async ({ inputData, getStepResultAsync, mastra, abortSignal }) => {
      if (inputData.hypotheses.length === 0) return { agentId, measurements: [], error: null };
      const { applicant, claims } = await getStepResultAsync(loadStep);
      return investigateWith(agentId, { mastra, applicant, claims, hypotheses: inputData.hypotheses, abortSignal });
    },
  });
}

const INVESTIGATE_STEP_IDS = {
  devpost: "investigate-devpost",
  linkedin: "investigate-linkedin",
  github: "investigate-github",
  scholar: "investigate-scholar",
  press: "investigate-press",
  patents: "investigate-patents",
  wages: "investigate-wages",
} as const satisfies Record<InvestigatorId, string>;

const investigateSteps = [
  investigateStep("devpost", INVESTIGATE_STEP_IDS.devpost),
  investigateStep("linkedin", INVESTIGATE_STEP_IDS.linkedin),
  investigateStep("github", INVESTIGATE_STEP_IDS.github),
  investigateStep("scholar", INVESTIGATE_STEP_IDS.scholar),
  investigateStep("press", INVESTIGATE_STEP_IDS.press),
  investigateStep("patents", INVESTIGATE_STEP_IDS.patents),
  investigateStep("wages", INVESTIGATE_STEP_IDS.wages),
] as const;

const ResolvedSchema = z.object({
  findings: z.array(FindingSchema),
  outcomes: z.array(HypothesisOutcomeSchema),
  /** Criteria the investigated queue counts as clear (drives question ranking). */
  clearCriteria: z.array(CriterionSchema),
  /** The sceptic queue with statuses updated after investigation (null when the sceptic didn't run). */
  investigatedQueue: z.unknown().nullable(),
  investigatedFile: z.string().nullable(),
});

const resolveStep = createStep({
  id: "resolve-hypotheses",
  description: "Decide each hypothesis from its measurements, and update the sceptic queue",
  inputSchema: z.object(Object.fromEntries(Object.values(INVESTIGATE_STEP_IDS).map((id) => [id, InvestigatorResultSchema])) as Record<
    (typeof INVESTIGATE_STEP_IDS)[InvestigatorId],
    typeof InvestigatorResultSchema
  >),
  outputSchema: ResolvedSchema,
  execute: async ({ inputData, getStepResultAsync, mastra, abortSignal }) => {
    const { applicant } = await getStepResultAsync(loadStep);
    const { findings } = await getStepResultAsync(reconcileStep);
    const sceptic = await getStepResultAsync(scepticStep);
    if (sceptic.hypotheses.length === 0) return { findings, outcomes: [], clearCriteria: [], investigatedQueue: sceptic.queue, investigatedFile: null };

    const results = Object.values(inputData);
    const measurements = results.flatMap((r) => r.measurements);
    const failed = results.filter((r) => r.error).length;
    await eventLogger(applicant.id, "pipeline")(
      "handoff",
      `Investigators → hypothesis resolver: ${measurements.length} measurement(s)${failed ? `, ${failed} investigator(s) had errors` : ""}`,
    );
    const outcomes = await resolveAll(mastra, applicant, sceptic.hypotheses, measurements, abortSignal);

    // The queue after investigation. The save step writes it next to the sceptic's own file, with the final decision.
    let clearCriteria: Criterion[] = [];
    let updatedQueue: unknown = null;
    if (sceptic.queue) {
      const queue = sceptic.queue as Parameters<typeof investigatedQueue>[0];
      const updated = investigatedQueue(
        queue,
        outcomes.map((o) => ({
          hypothesisId: o.hypothesisId,
          item: o.item,
          criterion: o.criterion,
          statusAfter: o.queueStatusAfter,
          question: o.sharpenedQuestion,
          reasoning: o.reasoning,
        })),
        sceptic.evidenceIds,
      );
      clearCriteria = Object.entries(updated.summary.criteria_status)
        .filter(([, s]) => s === "clear")
        .map(([c]) => FROM_RAG[c as RagCriterion])
        .filter(Boolean);
      updatedQueue = updated;
    }
    return {
      findings,
      outcomes,
      clearCriteria,
      investigatedQueue: updatedQueue,
      investigatedFile: sceptic.queueFile ? sceptic.queueFile.replace(/\.json$/, ".investigated.json") : null,
    };
  },
});

// ─── Merged questions ────────────────────────────────────────────────────────

const QuestionsSchema = z.object({
  findings: z.array(FindingSchema),
  discrepancies: z.array(MergedQuestionSchema),
  outcomes: z.array(HypothesisOutcomeSchema),
});

const questionsStep = createStep({
  id: "generate-questions",
  description: `One follow-up list from discrepancies and still-unknown hypotheses, ranked; ask the top ${MAX_QUESTIONS}`,
  inputSchema: ResolvedSchema,
  outputSchema: QuestionsSchema,
  execute: async ({ inputData, getStepResultAsync, mastra, abortSignal }) => {
    const { applicant, claims } = await getStepResultAsync(loadStep);
    const { outcomes } = inputData;
    const open = inputData.findings.filter((f) => f.status !== "corroborated");
    const unknown = outcomes.filter((o) => o.result === "still_unknown" && o.sharpenedQuestion);
    const log = eventLogger(applicant.id, "questioner");
    const criterionOf = (claimId: string) => claims.find((c) => c.id === claimId)?.criterion ?? "claim";

    await eventLogger(applicant.id, "pipeline")(
      "handoff",
      `Reconciler + hypothesis resolver → questioner: ${open.length} finding(s) and ${unknown.length} hypothesis(es) need follow-up`,
    );
    if (open.length === 0 && unknown.length === 0) {
      await log("status", "Nothing to ask: every claim is corroborated and no failure mode is open", { status: "done", progress: 100, currentAction: "Done" });
      return { findings: inputData.findings, discrepancies: [], outcomes };
    }
    await log("status", `Ranking ${open.length} discrepancy(ies) and ${unknown.length} open failure mode(s)`, {
      status: "thinking",
      progress: 10,
      currentAction: "Classifying and ranking discrepancies",
    });

    let issues: ReturnType<typeof rankDiscrepancies>["askedIssues"] = [];
    if (open.length) {
      try {
        const result = await mastra.getAgent("questioner").generate(questionerPrompt(applicant, claims, inputData.findings, open), {
          structuredOutput: { schema: QuestionerModelOutput },
          abortSignal,
          modelSettings: { maxOutputTokens: 16_000 },
        });
        issues = rankDiscrepancies(result.object, open.map((f) => f.claimId), Number.POSITIVE_INFINITY).askedIssues;
      } catch (err) {
        // Keep going with the sceptic's questions.
        await log("message", `Failed to draft discrepancy questions: ${truncate(errorMessage(err), 300)}`);
      }
    }

    const { questions, notAskedIssues, notAskedHypothesisIds } = mergeQuestions({
      issues,
      sceptic: unknown.map((o) => ({
        hypothesisId: o.hypothesisId,
        claimId: o.claimId,
        criterion: o.criterion,
        failureMode: o.failureMode,
        precedentCaseId: o.hypothesis.precedent.caseId,
        reasoning: o.reasoning,
        question: o.sharpenedQuestion!,
      })),
      clearCriteria: new Set(inputData.clearCriteria),
      max: MAX_QUESTIONS,
    });

    for (const [i, q] of questions.entries()) {
      const tag = q.hypothesisId ? "failure mode" : q.type;
      await log("message", `Q${i + 1} · ${criterionOf(q.claimId)} (${tag}): ${q.question}`, {
        found: truncate(q.description),
        progress: 90,
        currentAction: `Question ${i + 1} of ${questions.length}`,
        hypothesisId: q.hypothesisId,
      });
    }

    // Lower-ranked discrepancies become notes on their findings; unasked hypotheses keep their sharpened question.
    const noteByClaim = new Map(notAskedIssues.map((n) => [n.claimId, n]));
    const findings = inputData.findings.map((f) => {
      const note = noteByClaim.get(f.claimId);
      return note ? { ...f, reasoning: `${f.reasoning} Note (${note.impact} impact, not asked): ${note.description}` } : f;
    });
    const kept = notAskedIssues.length + notAskedHypothesisIds.length;
    const summary = `${questions.length} question(s)${kept ? `; ${kept} kept as notes` : ""}`;
    await log("status", `Done: ${summary}`, { status: "done", progress: 100, currentAction: "Done", found: summary });
    return { findings, discrepancies: questions, outcomes };
  },
});

// ─── Save ────────────────────────────────────────────────────────────────────

const PipelineOutputSchema = z.object({
  applicantId: z.string(),
  findings: z.array(FindingRecordSchema),
  discrepancies: z.array(DiscrepancySchema),
  hypotheses: z.array(HypothesisRecordSchema),
  /** The final routing decision (see src/lib/decision.ts). */
  decision: z.custom<FinalDecision>(),
});

const saveStep = createStep({
  id: "save-results",
  description: "Save findings, discrepancies and hypotheses (replacing earlier results for this applicant)",
  inputSchema: QuestionsSchema,
  outputSchema: PipelineOutputSchema,
  execute: async ({ inputData, getStepResultAsync }) => {
    const { applicant, claims } = await getStepResultAsync(loadStep);
    const claimIds = claims.map((c) => c.id);

    const saved = await db.transaction(async (tx) => {
      await tx.delete(discrepanciesTable).where(inArray(discrepanciesTable.claimId, claimIds));
      await tx.delete(findingsTable).where(inArray(findingsTable.claimId, claimIds));
      await tx.delete(hypothesesTable).where(eq(hypothesesTable.applicantId, applicant.id));
      const findings = inputData.findings.length ? await tx.insert(findingsTable).values(inputData.findings).returning() : [];
      const discrepancies = inputData.discrepancies.length
        ? await tx
            .insert(discrepanciesTable)
            .values(inputData.discrepancies.map((d) => ({ ...d, resolution: "open" as const })))
            .returning()
        : [];
      const hypotheses = inputData.outcomes.length
        ? await tx
            .insert(hypothesesTable)
            .values(inputData.outcomes.map(({ item: _item, ...o }) => ({ ...o, applicantId: applicant.id })))
            .returning()
        : [];
      return { findings, discrepancies, hypotheses };
    });

    // The final decision, from the same rule the dashboard and the CLI use.
    const decision = decide({ claims, findings: saved.findings, hypotheses: saved.hypotheses });
    const { investigatedQueue: queue, investigatedFile } = await getStepResultAsync(resolveStep);
    if (queue && investigatedFile) {
      await writeFile(investigatedFile, JSON.stringify({ ...(queue as object), final_decision: decision }, null, 2)).catch((err) =>
        console.error(`[pipeline] couldn't write ${investigatedFile}: ${errorMessage(err)}`),
      );
    }

    const log = eventLogger(applicant.id, "pipeline");
    await log("verdict", `Final decision: ${decision.routing === "to_lawyer" ? "to lawyer" : "needs more evidence"}. ${decision.summary}`, {
      found: `${decision.routing === "to_lawyer" ? "To lawyer" : "Needs more evidence"} · ${decision.criteriaCounted}/${decision.criteriaNeeded} criteria`,
    });
    const investigated = saved.hypotheses.length ? `, ${saved.hypotheses.length} failure modes investigated` : "";
    await log(
      "status",
      `Vetting complete: ${saved.findings.length} findings${investigated}, ${saved.discrepancies.length} open questions${investigatedFile && queue ? ` (queue: ${investigatedFile})` : ""}`,
      { status: "done", progress: 100 },
    );
    return { applicantId: applicant.id, ...saved, decision };
  },
});

export const o1Pipeline = createWorkflow({
  id: "o1Pipeline",
  description:
    "Verify claims with 5 parallel source agents, reconcile, run the sceptic, investigate its hypotheses with 7 parallel investigators, resolve, and draft one merged list of follow-up questions",
  inputSchema: z.object({ applicantId: z.string().min(1) }),
  outputSchema: PipelineOutputSchema,
})
  .then(loadStep)
  .parallel([...sourceSteps])
  .then(reconcileStep)
  .then(scepticStep)
  .parallel([...investigateSteps])
  .then(resolveStep)
  .then(questionsStep)
  .then(saveStep)
  .commit();
