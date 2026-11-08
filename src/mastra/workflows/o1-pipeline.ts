/**
 * o1Pipeline: load claims → 5 source agents in parallel → reconciler →
 * questioner → save findings + discrepancies.
 *
 * Every step logs war-room events (status, progress, tool calls, findings,
 * handoffs). A failing source agent logs an error and returns no findings
 * instead of failing the run. Saving replaces earlier results for the
 * applicant, so the pipeline can be re-run.
 */
import { RequestContext } from "@mastra/core/request-context";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { applicants, claims as claimsTable, discrepancies as discrepanciesTable, findings as findingsTable } from "../../db/schema";
import {
  ApplicantSchema,
  ClaimSchema,
  DiscrepancySchema,
  FindingRecordSchema,
  FindingSchema,
  QuestionerOutputSchema,
  SOURCE_AGENT_IDS,
  SourceAgentIdSchema,
  SourceFindingSchema,
  type Applicant,
  type Claim,
  type Finding,
  type SourceAgentId,
  type SourceFinding,
} from "../../lib/schemas";
import {
  QuestionerModelOutput,
  ReconcilerModelOutput,
  SourceAgentModelOutput,
  toDiscrepancy,
  toFindings,
  toSourceFindings,
} from "../agents/output-schemas";
import { eventLogger, toolEventHooks } from "../events";

const SOURCE_MAX_STEPS = 14;
const QUESTIONER_CONCURRENCY = 4;
const CV_EXCERPT_CHARS = 4_000;

const truncate = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

// ─── Prompt building ─────────────────────────────────────────────────────────

function identityOf(applicant: Applicant) {
  return {
    name: applicant.name,
    alternateNames: applicant.alternateNames,
    field: applicant.field,
    currentRole: applicant.currentRole,
    currentOrganization: applicant.currentOrganization,
    profileLinks: applicant.links,
    additionalInfo: applicant.additionalInfo,
    cvExcerpt: applicant.cvText ? applicant.cvText.slice(0, CV_EXCERPT_CHARS) : null,
  };
}

const claimForPrompt = (c: Claim) => ({ id: c.id, criterion: c.criterion, summary: c.summary, details: c.payload });
const json = (v: unknown) => JSON.stringify(v, null, 2);

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

function questionerPrompt(applicant: Applicant, claim: Claim, finding: Finding) {
  return `Applicant: ${applicant.name}${applicant.alternateNames.length ? ` (also known as ${applicant.alternateNames.join(", ")})` : ""}

Claim (${claim.criterion}):
${json(claimForPrompt(claim))}

Verification finding:
${json(finding)}`;
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ─── Steps ───────────────────────────────────────────────────────────────────

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
      await eventLogger(applicantId, agentId)("status", "Queued", { status: "queued", progress: 0, currentAction: "Waiting to start" });
    }
    return loaded;
  },
});

const SourceStepOutput = z.object({
  agentId: SourceAgentIdSchema,
  sourceFindings: z.array(SourceFindingSchema),
  error: z.string().nullable(),
});

function sourceStep<const Id extends string>(agentId: SourceAgentId, id: Id) {
  return createStep({
    id,
    description: `Run the ${agentId} research agent over all claims`,
    inputSchema: LoadedSchema,
    outputSchema: SourceStepOutput,
    execute: async ({ inputData, mastra, abortSignal }) => {
      const { applicant, claims } = inputData;
      const log = eventLogger(applicant.id, agentId);
      const hooks = toolEventHooks(applicant.id, agentId);
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
          const found = truncate(f.foundValue ?? "Nothing found");
          await log("finding", `${claim.criterion}: ${found}`, {
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
    const log = eventLogger(applicant.id, "reconciler");

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

const QuestionsSchema = z.object({ findings: z.array(FindingSchema), discrepancies: z.array(QuestionerOutputSchema) });

const questionsStep = createStep({
  id: "generate-questions",
  description: "Create a discrepancy with one neutral question for every finding that isn't corroborated",
  inputSchema: FindingsSchema,
  outputSchema: QuestionsSchema,
  execute: async ({ inputData, getStepResultAsync, mastra, abortSignal }) => {
    const { applicant, claims } = await getStepResultAsync(loadStep);
    const open = inputData.findings.filter((f) => f.status !== "corroborated");
    const log = eventLogger(applicant.id, "questioner");

    await eventLogger(applicant.id, "pipeline")("handoff", `Reconciler → questioner: ${open.length} finding(s) need follow-up`);
    await log("status", `Drafting questions for ${open.length} finding(s)`, {
      status: open.length ? "thinking" : "done",
      progress: open.length ? 10 : 100,
      currentAction: open.length ? "Classifying discrepancies" : "Nothing to ask",
    });

    let completed = 0;
    const drafted = await mapLimit(open, QUESTIONER_CONCURRENCY, async (finding) => {
      const claim = claims.find((c) => c.id === finding.claimId)!;
      try {
        const result = await mastra.getAgent("questioner").generate(questionerPrompt(applicant, claim, finding), {
          structuredOutput: { schema: QuestionerModelOutput },
          abortSignal,
          modelSettings: { maxOutputTokens: 8_000 },
        });
        const discrepancy = toDiscrepancy(result.object, claim.id);
        completed++;
        await log("message", `${claim.criterion} (${discrepancy.type}): ${discrepancy.question}`, {
          found: truncate(discrepancy.description),
          progress: 10 + (80 * completed) / open.length,
          currentAction: `Question ${completed} of ${open.length}`,
        });
        return discrepancy;
      } catch (err) {
        completed++;
        await log("status", `Couldn't draft a question for ${claim.criterion}: ${truncate(errorMessage(err), 200)}`, {
          status: "error",
          progress: 10 + (80 * completed) / open.length,
        });
        return null;
      }
    });
    const discrepancies = drafted.filter((d) => d !== null);
    if (open.length) {
      await log("status", `Done: ${discrepancies.length} question(s)`, {
        status: "done",
        progress: 100,
        currentAction: "Done",
        found: `${discrepancies.length} question(s)`,
      });
    }
    return { findings: inputData.findings, discrepancies };
  },
});

const PipelineOutputSchema = z.object({
  applicantId: z.string(),
  findings: z.array(FindingRecordSchema),
  discrepancies: z.array(DiscrepancySchema),
});

const saveStep = createStep({
  id: "save-results",
  description: "Save findings and discrepancies (replacing earlier results for this applicant)",
  inputSchema: QuestionsSchema,
  outputSchema: PipelineOutputSchema,
  execute: async ({ inputData, getStepResultAsync }) => {
    const { applicant, claims } = await getStepResultAsync(loadStep);
    const claimIds = claims.map((c) => c.id);

    const saved = await db.transaction(async (tx) => {
      await tx.delete(discrepanciesTable).where(inArray(discrepanciesTable.claimId, claimIds));
      await tx.delete(findingsTable).where(inArray(findingsTable.claimId, claimIds));
      const findings = inputData.findings.length ? await tx.insert(findingsTable).values(inputData.findings).returning() : [];
      const discrepancies = inputData.discrepancies.length
        ? await tx
            .insert(discrepanciesTable)
            .values(inputData.discrepancies.map((d) => ({ ...d, resolution: "open" as const })))
            .returning()
        : [];
      return { findings, discrepancies };
    });

    await eventLogger(applicant.id, "pipeline")(
      "status",
      `Vetting complete: ${saved.findings.length} findings, ${saved.discrepancies.length} open questions`,
      { status: "done", progress: 100 },
    );
    return { applicantId: applicant.id, ...saved };
  },
});

export const o1Pipeline = createWorkflow({
  id: "o1Pipeline",
  description: "Verify an applicant's claims with 5 parallel source agents, reconcile, and draft follow-up questions",
  inputSchema: z.object({ applicantId: z.string().min(1) }),
  outputSchema: PipelineOutputSchema,
})
  .then(loadStep)
  .parallel([...sourceSteps])
  .then(reconcileStep)
  .then(questionsStep)
  .then(saveStep)
  .commit();
