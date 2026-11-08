/**
 * Process a sceptic queue: hypotheses → 7 investigators → hypothesis resolver
 * → final decision (to_lawyer | needs_more_evidence). Prints every hypothesis
 * with its measurements and verdict, then the decision, and writes
 * <queue>.investigated.json (the updated queue + final_decision) next to the
 * queue.
 *
 * Two ways in:
 *
 *   A RAG applicant file (no database, no dashboard) — for working on the sceptic:
 *     npm run investigate -- --rag-applicant rag/input/applicant_test_01.json
 *         runs rag/src/run.py on it first, then investigates its queue
 *     npm run investigate -- --rag-applicant rag/input/applicant_test_01.json --queue rag/out/queue_test_01.json
 *         investigates an existing queue
 *
 *   An applicant in the app database whose claims were verified (npm run pipeline):
 *     npm run investigate -- <applicantId> [--queue <file>] [--save]
 *         --save also replaces the applicant's hypotheses rows (and the dashboard shows them)
 *
 * Makes real, billed API calls (Claude, Exa, ...).
 */
import { writeFile } from "node:fs/promises";
import type { Applicant, Claim, Finding } from "../src/lib/schemas";

function flag(args: string[], name: string): string | null {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? null) : null;
}

async function main() {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(file);
    } catch {
      // file missing
    }
  }
  const args = process.argv.slice(2);
  const ragApplicantFile = flag(args, "--rag-applicant");
  const queueArg = flag(args, "--queue");
  const save = args.includes("--save");
  const applicantId = args.find((a, i) => !a.startsWith("--") && !["--queue", "--rag-applicant"].includes(args[i - 1]));
  if (!ragApplicantFile && !applicantId) {
    console.error(
      "Usage:\n  npm run investigate -- --rag-applicant <rag/input/applicant.json> [--queue <queue.json>]\n  npm run investigate -- <applicantId> [--queue <queue.json>] [--save]",
    );
    process.exitCode = 1;
    return;
  }
  if (ragApplicantFile) process.env.EVENTS_OFF = "1"; // no database applicant to attach war-room events to

  const { readFile } = await import("node:fs/promises");
  const sceptic = await import("../src/lib/sceptic");
  const { decide } = await import("../src/lib/decision");
  const { CRITERION_LABELS } = await import("../src/lib/labels");
  const { INVESTIGATOR_IDS } = await import("../src/lib/schemas");
  const { mastra } = await import("../src/mastra");
  const { draftHypotheses, investigateWith, resolveAll } = await import("../src/mastra/workflows/investigation");

  // ── Who, and their evidence ──
  let applicant: Applicant;
  let claims: Claim[];
  let findings: Finding[] = [];
  let ragInput: import("../src/lib/sceptic").ScepticApplicant | null = null;

  if (ragApplicantFile) {
    ragInput = sceptic.ScepticApplicantSchema.parse(JSON.parse(await readFile(ragApplicantFile, "utf8")));
    const now = new Date().toISOString();
    applicant = {
      id: ragInput.applicant_id,
      name: ragInput.name,
      alternateNames: [],
      email: "applicant@example.com",
      phone: null,
      consentToCall: false,
      field: ragInput.field,
      currentRole: ragInput.role,
      currentOrganization: ragInput.employer,
      usWorkPlan: "",
      links: {},
      cvText: null,
      additionalInfo: `Location: ${ragInput.location}`,
      createdAt: now,
    };
    // Each RAG evidence item stands in for a claim (same id), so queue items link back to it.
    claims = ragInput.evidence.map(
      (e) =>
        ({
          id: e.id,
          applicantId: applicant.id,
          criterion: sceptic.FROM_RAG[e.criterion],
          summary: e.description,
          payload: { medium: e.medium, ...e.details },
          createdAt: now,
        }) as unknown as Claim,
    );
  } else {
    const { eq } = await import("drizzle-orm");
    const { db } = await import("../src/db");
    const { applicants, claims: claimsTable } = await import("../src/db/schema");
    const { latestFindings, listClaimsAndFindings } = await import("../src/lib/case-data");
    const { ApplicantSchema, ClaimSchema } = await import("../src/lib/schemas");
    const [row] = await db.select().from(applicants).where(eq(applicants.id, applicantId!));
    if (!row) throw new Error(`No applicant with id "${applicantId}"`);
    applicant = ApplicantSchema.parse(row);
    claims = (await db.select().from(claimsTable).where(eq(claimsTable.applicantId, applicant.id))).map((c) => ClaimSchema.parse(c)) as Claim[];
    findings = latestFindings((await listClaimsAndFindings(applicant.id)).findings) as Finding[];
  }
  console.log(`${applicant.name}: ${claims.length} evidence item(s), ${findings.length} verification finding(s)`);

  // ── The queue ──
  const started = Date.now();
  let queue: import("../src/lib/sceptic").ScepticQueue;
  let queueFile: string;
  if (queueArg) {
    queue = await sceptic.readQueue(queueArg);
    queueFile = queueArg;
    console.log(`Using queue ${queueArg}`);
  } else {
    const config = sceptic.scepticConfig();
    if (config.mode === "off") throw new Error(`Sceptic is off (${config.reason}). Pass --queue <file> instead.`);
    const input = ragInput ?? sceptic.toScepticApplicant(applicant, claims, findings);
    console.log(`Running the sceptic on ${input.evidence.length} evidence item(s) in ${config.ragDir} ...`);
    const res = await sceptic.runSceptic(config, input, { onLine: (l) => console.log(`  [sceptic] ${l}`) });
    queue = res.queue;
    queueFile = res.file;
  }

  // ── Investigate ──
  const { items, skipped } = sceptic.queueItems(queue, claims);
  for (const s of skipped) console.log(`  skipped: ${s}`);
  const queued = await draftHypotheses(mastra, applicant, claims, items);
  console.log(
    `\n${queued.length} hypotheses (${queued.filter((q) => q.origin === "sceptic").length} from the judge, ${queued.filter((q) => q.origin === "drafted").length} drafted). Investigating with ${INVESTIGATOR_IDS.join(", ")} ...`,
  );
  const results = await Promise.all(INVESTIGATOR_IDS.map((agentId) => investigateWith(agentId, { mastra, applicant, claims, hypotheses: queued })));
  for (const r of results) if (r.error) console.log(`  ${r.agentId} errors: ${r.error.slice(0, 200)}`);
  const outcomes = await resolveAll(mastra, applicant, queued, results.flatMap((r) => r.measurements));

  for (const o of outcomes) {
    const moved = o.queueStatusBefore === o.queueStatusAfter ? o.queueStatusAfter : `${o.queueStatusBefore} → ${o.queueStatusAfter}`;
    console.log(`\n${"═".repeat(80)}\n[${o.result.toUpperCase()}] ${CRITERION_LABELS[o.criterion]} · ${o.failureMode}\n  queue: ${moved} · precedent ${o.hypothesis.precedent.caseId} · ${o.origin}`);
    for (const c of o.hypothesis.checks) console.log(`  check ${c.checkId} ${c.metric} → ${c.target}`);
    for (const [i, m] of o.measurements.entries()) {
      const bench = m.benchmark ? ` vs ${m.benchmark.description} = ${m.benchmark.value}` : "";
      console.log(`  ${o.reliedOn.includes(i) ? "★" : "·"} ${m.agentId}: ${m.metric} = ${m.value}${bench} (identity ${m.identityConfidence})${m.sources[0] ? ` <${m.sources[0].url}>` : ""}`);
    }
    console.log(`  why: ${o.reasoning}`);
    if (o.sharpenedQuestion) console.log(`  Q: ${o.sharpenedQuestion}`);
  }

  // ── Final decision ──
  const decision = decide({ claims, findings, hypotheses: outcomes });
  console.log(`\n${"═".repeat(80)}\nFINAL DECISION: ${decision.routing === "to_lawyer" ? "TO LAWYER" : "NEEDS MORE EVIDENCE"} (${decision.criteriaCounted}/${decision.criteriaNeeded} criteria)\n${decision.summary}`);
  for (const c of decision.criteria) {
    console.log(`\n  ${c.status.toUpperCase().padEnd(8)} ${CRITERION_LABELS[c.criterion]}`);
    for (const r of c.reasons) console.log(`           ${r}`);
  }

  const updated = sceptic.investigatedQueue(
    queue,
    outcomes.map((o) => ({ hypothesisId: o.hypothesisId, item: o.item, criterion: o.criterion, statusAfter: o.queueStatusAfter, question: o.sharpenedQuestion, reasoning: o.reasoning })),
    ragInput ? sceptic.evidenceIdsByCriterion(ragInput) : undefined,
  );
  const out = queueFile.replace(/\.json$/, ".investigated.json");
  await writeFile(out, JSON.stringify({ ...updated, final_decision: decision, hypotheses: outcomes.map(({ item: _item, ...o }) => o) }, null, 2));
  console.log(`\nWrote ${out}`);

  if (save && !ragApplicantFile) {
    const { eq } = await import("drizzle-orm");
    const { db } = await import("../src/db");
    const { hypotheses } = await import("../src/db/schema");
    await db.transaction(async (tx) => {
      await tx.delete(hypotheses).where(eq(hypotheses.applicantId, applicant.id));
      if (outcomes.length) await tx.insert(hypotheses).values(outcomes.map(({ item: _item, ...o }) => ({ ...o, applicantId: applicant.id })));
    });
    console.log(`Saved ${outcomes.length} hypotheses.`);
  }
  console.log(`\n✓ Done in ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? (err.stack ?? err.message) : err}`);
  process.exitCode = 1;
});
