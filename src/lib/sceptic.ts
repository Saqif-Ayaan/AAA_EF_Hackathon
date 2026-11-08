/**
 * The bridge to the sceptic RAG (rag/ on the feature/rag-development branch,
 * RAG_SPEC.md): applicant JSON in, queue out.
 *
 * 1. toScepticApplicant(): our applicant + verified claims → the RAG's
 *    Applicant JSON. Each claim becomes one evidence item whose id IS the
 *    claim id, so the queue's evidence_id links straight back to the claim.
 *    Contradicted claims are left out (PART 3 §1).
 * 2. runSceptic(): runs `python src/run.py <file>` in the RAG folder and reads
 *    out/queue_<applicant_id>.json. Configure with:
 *      SCEPTIC_RAG_DIR   path to the rag/ folder (default: ./rag when it exists)
 *      SCEPTIC_PYTHON    interpreter (default <rag>/.venv/bin/python, else python3)
 *      SCEPTIC_MODE      run (default) | reuse (use an existing queue file if there is one) | off
 * 3. queueItems(): the queue → one entry per flagged item, with its criterion
 *    mapped to ours, its claim id, and the judge's Hypothesis if it has one
 *    (PART 3 §2). Items without one are drafted by the workflow.
 * 4. investigatedQueue(): the queue with statuses updated after investigation
 *    and the summary recomputed (same rules as rag/src/run.py summarise()).
 *
 * (Relative imports on purpose: this also runs under tsx scripts and `mastra dev`.)
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { HIGH_CONFIDENCE } from "./decision";
import { projectRoot } from "./project-root";
import {
  HypothesisSchema,
  type Applicant,
  type Claim,
  type Criterion,
  type Finding,
  type Hypothesis,
  type QueueStatus,
} from "./schemas";

// ─── Criterion keys: the RAG uses the regulation's names ─────────────────────

export const RAG_CRITERIA = [
  "awards",
  "membership",
  "published_material",
  "judging",
  "original_contributions",
  "scholarly_articles",
  "critical_role",
  "high_salary",
] as const;
export type RagCriterion = (typeof RAG_CRITERIA)[number];

export const TO_RAG: Record<Criterion, RagCriterion> = {
  awards: "awards",
  membership: "membership",
  press: "published_material",
  judging: "judging",
  contributions: "original_contributions",
  scholarly: "scholarly_articles",
  critical_role: "critical_role",
  remuneration: "high_salary",
};
export const FROM_RAG = Object.fromEntries(Object.entries(TO_RAG).map(([ours, rag]) => [rag, ours])) as Record<RagCriterion, Criterion>;

// ─── The RAG's JSON shapes (mirrors rag/src/schemas.py) ──────────────────────

export const ScepticEvidenceSchema = z.object({
  id: z.string(),
  criterion: z.enum(RAG_CRITERIA),
  medium: z.string(),
  description: z.string(),
  details: z.record(z.string(), z.unknown()).default({}),
});
export const ScepticApplicantSchema = z.object({
  applicant_id: z.string(),
  name: z.string(),
  field: z.string(),
  role: z.string(),
  employer: z.string(),
  location: z.string(),
  evidence: z.array(ScepticEvidenceSchema),
});
export type ScepticApplicant = z.infer<typeof ScepticApplicantSchema>;

export const ScepticQueueItemSchema = z.object({
  evidence_id: z.string(),
  evidence_summary: z.string(),
  failure_mode: z.string(),
  status: z.enum(["applies", "unknown"]),
  reasoning: z.string(),
  precedent: z.object({ case_id: z.string(), quote: z.string() }),
  question_for_applicant: z.string().nullable().optional(),
  /** PART 3 §2: the judge's measurable checks. Optional until rag/src/judge.py emits it. */
  hypothesis: z.unknown().optional(),
});
export type ScepticQueueItem = z.infer<typeof ScepticQueueItemSchema>;

export const ScepticQueueSchema = z
  .object({
    applicant_id: z.string(),
    criteria: z.record(z.string(), z.object({ precedent_found: z.boolean(), items: z.array(ScepticQueueItemSchema).default([]) })),
    summary: z
      .object({
        criteria_status: z.record(z.string(), z.enum(["flagged", "open", "clear"])),
        criteria_counted: z.number(),
        routing: z.enum(["to_lawyer", "needs_more_evidence"]),
        questions_for_call: z.array(z.object({ criterion: z.string(), evidence_id: z.string(), question: z.string() })),
      })
      .passthrough(),
  })
  .passthrough();
export type ScepticQueue = z.infer<typeof ScepticQueueSchema>;

// ─── 1. Export ───────────────────────────────────────────────────────────────

const MEDIUM: Record<Criterion, string> = {
  awards: "award",
  membership: "membership",
  press: "published article",
  judging: "judging / peer review record",
  contributions: "description of original work",
  scholarly: "scholarly publications",
  critical_role: "employment role",
  remuneration: "compensation",
};

/** Our applicant + claims (+ verification findings) → the RAG's Applicant JSON. */
export function toScepticApplicant(applicant: Applicant, claims: Claim[], findings: Finding[]): ScepticApplicant {
  const findingOf = new Map(findings.map((f) => [f.claimId, f]));
  const salary = claims.find((c) => c.criterion === "remuneration");
  const location = (salary?.criterion === "remuneration" && salary.payload.location) || "United States";
  return ScepticApplicantSchema.parse({
    applicant_id: applicant.id,
    name: applicant.name,
    field: applicant.field,
    role: applicant.currentRole,
    employer: applicant.currentOrganization,
    location,
    evidence: claims
      // Lax: only claims contradicted with high confidence are left out; the rest get judged.
      .filter((c) => {
        const f = findingOf.get(c.id);
        return !(f?.status === "contradicted" && f.identityConfidence >= HIGH_CONFIDENCE);
      })
      .map((c) => {
        const f = findingOf.get(c.id);
        return {
          id: c.id,
          criterion: TO_RAG[c.criterion],
          medium: MEDIUM[c.criterion],
          description: c.summary,
          details: {
            ...c.payload,
            ...(f ? { our_verification: { status: f.status, found: f.foundValue } } : {}),
          },
        };
      }),
  });
}

// ─── 2. Run ──────────────────────────────────────────────────────────────────

export type ScepticConfig = { ragDir: string; python: string; mode: "run" | "reuse" } | { mode: "off"; reason: string };

export function scepticConfig(): ScepticConfig {
  const mode = (process.env.SCEPTIC_MODE ?? "run").trim().toLowerCase();
  if (mode === "off") return { mode: "off", reason: "SCEPTIC_MODE is off" };
  // Default: the rag/ folder in this repo (it lives next to src/ on feature/rag-development).
  const dir = process.env.SCEPTIC_RAG_DIR?.trim() || (existsSync(path.join(projectRoot(), "rag", "src", "run.py")) ? "rag" : "");
  if (!dir) return { mode: "off", reason: "no rag/ folder and SCEPTIC_RAG_DIR is not set" };
  const ragDir = path.resolve(projectRoot(), dir);
  if (!existsSync(path.join(ragDir, "src", "run.py"))) return { mode: "off", reason: `no src/run.py in ${ragDir}` };
  const venv = path.join(ragDir, ".venv", "bin", "python");
  return {
    ragDir,
    python: process.env.SCEPTIC_PYTHON?.trim() || (existsSync(venv) ? venv : "python3"),
    mode: mode === "reuse" ? "reuse" : "run",
  };
}

export const queuePath = (ragDir: string, applicantId: string) => path.join(ragDir, "out", `queue_${applicantId}.json`);

export async function readQueue(file: string): Promise<ScepticQueue> {
  return ScepticQueueSchema.parse(JSON.parse(await readFile(file, "utf8")));
}

const SCEPTIC_TIMEOUT_MS = 20 * 60_000;

/**
 * Run the sceptic for one applicant and return its queue. `onLine` gets each
 * line the RAG prints (for the war room). The applicant JSON is written to our
 * .cache/ (it holds a real person's details), not into the RAG folder.
 */
export async function runSceptic(
  config: Extract<ScepticConfig, { ragDir: string }>,
  input: ScepticApplicant,
  opts: { onLine?: (line: string) => void; signal?: AbortSignal } = {},
): Promise<{ queue: ScepticQueue; file: string; reused: boolean }> {
  const out = queuePath(config.ragDir, input.applicant_id);
  if (config.mode === "reuse" && existsSync(out)) return { queue: await readQueue(out), file: out, reused: true };

  const dir = path.join(projectRoot(), ".cache", "sceptic");
  await mkdir(dir, { recursive: true });
  const inputFile = path.join(dir, `applicant_${input.applicant_id}.json`);
  await writeFile(inputFile, JSON.stringify(input, null, 2));
  const startedAt = Date.now();

  await new Promise<void>((resolve, reject) => {
    const child = spawn(config.python, ["src/run.py", inputFile], {
      cwd: config.ragDir,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      signal: opts.signal,
      timeout: SCEPTIC_TIMEOUT_MS,
    });
    const tail: string[] = [];
    const onData = (buf: Buffer) => {
      for (const line of buf.toString().split("\n").map((l) => l.trimEnd()).filter(Boolean)) {
        tail.push(line);
        if (tail.length > 20) tail.shift();
        opts.onLine?.(line);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`sceptic exited with code ${code}: ${tail.slice(-5).join(" | ")}`)),
    );
  });

  if (!existsSync(out) || (await stat(out)).mtimeMs < startedAt - 1000) throw new Error(`sceptic finished but wrote no ${out}`);
  return { queue: await readQueue(out), file: out, reused: false };
}

// ─── 3. Queue → items to investigate ─────────────────────────────────────────

export type QueuedItem = {
  hypothesisId: string;
  claimId: string;
  criterion: Criterion;
  item: ScepticQueueItem;
  /** The judge's Hypothesis (PART 3 §2), when the queue has one and it is valid. */
  hypothesis: Hypothesis | null;
};

/**
 * Every applies/unknown item in the queue, linked to a claim. Our exporter
 * uses claim ids as evidence ids; for a hand-written queue (ev_1, ...) the
 * item falls back to the first claim with the same criterion, and items with
 * no matching claim are skipped (returned in `skipped`).
 */
export function queueItems(queue: ScepticQueue, claims: Pick<Claim, "id" | "criterion">[]): { items: QueuedItem[]; skipped: string[] } {
  const items: QueuedItem[] = [];
  const skipped: string[] = [];
  const perEvidence = new Map<string, number>();
  for (const [ragCriterion, q] of Object.entries(queue.criteria)) {
    const criterion = FROM_RAG[ragCriterion as RagCriterion];
    if (!criterion) {
      skipped.push(`unknown criterion "${ragCriterion}"`);
      continue;
    }
    for (const item of q.items) {
      const claim = claims.find((c) => c.id === item.evidence_id) ?? claims.find((c) => c.criterion === criterion);
      if (!claim) {
        skipped.push(`${item.evidence_id} (${ragCriterion}): no matching claim`);
        continue;
      }
      const n = (perEvidence.get(item.evidence_id) ?? 0) + 1;
      perEvidence.set(item.evidence_id, n);
      const parsed = item.hypothesis === undefined ? null : HypothesisSchema.safeParse(item.hypothesis);
      const hypothesis = parsed?.success ? { ...parsed.data, claimId: claim.id, criterion } : null;
      if (parsed && !parsed.success) skipped.push(`${item.evidence_id}: invalid hypothesis from the judge (${parsed.error.issues[0]?.message}); drafting one instead`);
      items.push({
        hypothesisId: hypothesis?.hypothesisId ?? `hyp_${item.evidence_id.slice(0, 12)}_${n}`,
        claimId: claim.id,
        criterion,
        item,
        hypothesis,
      });
    }
  }
  return { items, skipped };
}

// ─── 4. Queue after investigation ────────────────────────────────────────────

export type InvestigationOutcome = {
  hypothesisId: string;
  item: ScepticQueueItem;
  criterion: Criterion;
  statusAfter: QueueStatus;
  question: string | null;
  reasoning: string;
};

/**
 * The queue with each item's status updated (cleared items move to
 * does_not_apply and leave the list) and the summary recomputed with the same
 * rules as rag/src/run.py: a criterion survives if at least one evidence item
 * has no `applies` failure; 3+ surviving criteria → to_lawyer.
 */
/** Identifies a queue item across serialization (workflow steps pass copies, not the same object). */
export const queueItemKey = (i: Pick<ScepticQueueItem, "evidence_id" | "failure_mode" | "precedent">) =>
  `${i.evidence_id}|${i.precedent.case_id}|${i.failure_mode}`;

export function investigatedQueue(queue: ScepticQueue, outcomes: InvestigationOutcome[], evidenceIds?: Record<string, string[]>) {
  const byKey = new Map(outcomes.map((o) => [queueItemKey(o.item), o]));
  const criteria: Record<string, { precedent_found: boolean; items: (ScepticQueueItem & { investigation?: object })[]; rescued: object[] }> = {};
  for (const [crit, q] of Object.entries(queue.criteria)) {
    const items: (ScepticQueueItem & { investigation?: object })[] = [];
    const rescued: object[] = [];
    for (const item of q.items) {
      const o = byKey.get(queueItemKey(item));
      if (!o) {
        items.push(item);
        continue;
      }
      const investigation = { hypothesisId: o.hypothesisId, reasoning: o.reasoning, statusBefore: item.status };
      if (o.statusAfter === "does_not_apply") rescued.push({ ...item, status: "does_not_apply", investigation });
      else items.push({ ...item, status: o.statusAfter, question_for_applicant: o.question ?? item.question_for_applicant ?? null, investigation });
    }
    criteria[crit] = { precedent_found: q.precedent_found, items, rescued };
  }

  const status: Record<string, "flagged" | "open" | "clear"> = {};
  for (const [crit, q] of Object.entries(criteria)) {
    const ids = evidenceIds?.[crit] ?? [...new Set([...q.items, ...(q.rescued as ScepticQueueItem[])].map((i) => i.evidence_id))];
    const applies = new Set(q.items.filter((i) => i.status === "applies").map((i) => i.evidence_id));
    const unknown = new Set(q.items.filter((i) => i.status === "unknown").map((i) => i.evidence_id));
    const surviving = ids.filter((e) => !applies.has(e));
    status[crit] = surviving.length === 0 ? (ids.length ? "flagged" : queue.summary.criteria_status[crit] ?? "clear") : surviving.some((e) => !unknown.has(e)) ? "clear" : "open";
  }
  const counted = Object.values(status).filter((s) => s !== "flagged").length;
  const seen = new Set<string>();
  const questions = Object.entries(criteria).flatMap(([crit, q]) =>
    q.items
      .filter((i) => i.status === "unknown" && i.question_for_applicant)
      .filter((i) => {
        const key = i.question_for_applicant!.toLowerCase().replace(/\W+/g, " ").trim();
        return seen.has(key) ? false : (seen.add(key), true);
      })
      .map((i) => ({ criterion: crit, evidence_id: i.evidence_id, question: i.question_for_applicant! })),
  );
  return {
    ...queue,
    criteria,
    summary: {
      criteria_status: status,
      criteria_counted: counted,
      routing: counted >= 3 ? ("to_lawyer" as const) : ("needs_more_evidence" as const),
      questions_for_call: questions,
    },
    investigated_at: new Date().toISOString(),
  };
}

/** Evidence ids per RAG criterion, from the applicant JSON we sent (so criteria with no flagged items still count). */
export const evidenceIdsByCriterion = (input: ScepticApplicant) =>
  input.evidence.reduce<Record<string, string[]>>((acc, e) => ({ ...acc, [e.criterion]: [...(acc[e.criterion] ?? []), e.id] }), {});
