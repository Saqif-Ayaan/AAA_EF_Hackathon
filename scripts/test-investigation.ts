/**
 * Offline checks for the PART 3 investigation logic (no API calls, no database):
 *
 *   npm run test:investigation [path/to/queue.json]
 *
 * Uses a sceptic queue written by rag/src/run.py (default: SCEPTIC_RAG_DIR's
 * out/queue_test_01.json) and covers the spec's resolver rules and acceptance
 * tests with stub measurements.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { mergeQuestions } from "../src/mastra/agents/merge-questions";
import { queueStatusAfter, toHypothesisFinding } from "../src/mastra/agents/investigation-schemas";
import { benchmarkSalary } from "../src/mastra/tools/wages";
import { normalizePatentNumber } from "../src/mastra/tools/patents";
import { decide } from "../src/lib/decision";
import { investigatedQueue, queueItems, readQueue, type QueuedItem } from "../src/lib/sceptic";
import type { Claim, Hypothesis, Measurement } from "../src/lib/schemas";

let passed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(
    () => {
      passed++;
      console.log(`✓ ${name}`);
    },
    (err) => {
      console.error(`✗ ${name}\n  ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    },
  );
}

const hyp = (over: Partial<Hypothesis> = {}): Hypothesis => ({
  hypothesisId: "hyp_ev4_1",
  evidenceId: "ev_4",
  claimId: "claim_patent",
  criterion: "contributions",
  failureMode: "Patent granted but no evidence of commercial use or adoption",
  precedent: { caseId: "FEB142024_01D8101", quote: "..." },
  checks: [{ checkId: "c1", metric: "patent_forward_citations", target: "US 9,000,000", description: "Forward citations" }],
  clearsIf: "10 or more forward citations, or any licence/product",
  confirmsIf: "0 forward citations 3 or more years after grant",
  questionIfUnresolved: "Has your patent been licensed or used in a product?",
  ...over,
});

const m = (over: Partial<Measurement> = {}): Measurement => ({
  hypothesisId: "hyp_ev4_1",
  checkId: "c1",
  agentId: "patents",
  metric: "patent_forward_citations",
  value: 0,
  benchmark: { description: "years since grant", value: 4.2 },
  identityConfidence: 0.9,
  sources: [{ url: "https://patents.google.com/patent/US9000000B2/en", title: "Google Patents", excerpt: "Cited By (0)" }],
  note: "",
  ...over,
});

async function main() {
  // ── Resolver rules (spec §5) ──
  await test("1. patent with no impact: a measured zero confirms → applies", () => {
    const { finding } = toHypothesisFinding({ result: "confirmed", reliedOn: [1], reasoning: "0 citing patents 4.2 years after grant.", sharpenedQuestion: null }, hyp(), [m()]);
    assert.equal(finding.result, "confirmed");
    assert.equal(finding.sharpenedQuestion, null);
    assert.equal(queueStatusAfter("unknown", finding.result), "applies");
  });
  await test("2. rescue: cleared moves an `applies` item to does_not_apply", () => {
    const { finding } = toHypothesisFinding({ result: "cleared", reliedOn: [1], reasoning: "48 citing patents.", sharpenedQuestion: null }, hyp(), [m({ value: 48 })]);
    assert.equal(finding.result, "cleared");
    assert.equal(queueStatusAfter("applies", finding.result), "does_not_apply");
  });
  await test("\"found nothing\" never confirms: a null value is kept open with a question", () => {
    const { finding } = toHypothesisFinding({ result: "confirmed", reliedOn: [1], reasoning: "Nothing online.", sharpenedQuestion: null }, hyp(), [m({ value: null })]);
    assert.equal(finding.result, "still_unknown");
    assert.ok(finding.sharpenedQuestion);
  });
  await test("confirmed without a source is kept open", () => {
    const { finding } = toHypothesisFinding({ result: "confirmed", reliedOn: [1], reasoning: "x", sharpenedQuestion: null }, hyp(), [m({ sources: [] })]);
    assert.equal(finding.result, "still_unknown");
  });
  await test("5. identity: measurements below 0.7 are ignored", () => {
    const { finding, reliedOn } = toHypothesisFinding({ result: "cleared", reliedOn: [1], reasoning: "x", sharpenedQuestion: null }, hyp(), [m({ value: 300, identityConfidence: 0.4 })]);
    assert.equal(finding.result, "still_unknown");
    assert.deepEqual(reliedOn, []);
  });
  await test("4. unresolvable: still_unknown keeps queue status and gets the sharpened question", () => {
    const { finding } = toHypothesisFinding(
      { result: "still_unknown", reliedOn: [], reasoning: "x", sharpenedQuestion: "We found your patent but no citing patents. Has it been licensed privately?" },
      hyp(),
      [m({ value: null })],
    );
    assert.equal(queueStatusAfter("unknown", finding.result), "unknown");
    assert.match(finding.sharpenedQuestion!, /licensed privately/);
  });

  // ── Merged questions (spec §6) ──
  await test("merged list: sceptic questions on needed criteria first, one per claim, cap 4", () => {
    const issue = (claimId: string, type: "numerical" | "evidence", impact: "high" | "medium" | "low") => ({
      claimId, type, description: "d", question: `q-${claimId}`, requestedDocument: null, impact, impactReason: "",
    });
    const { questions, notAskedIssues } = mergeQuestions({
      issues: [issue("a", "evidence", "high"), issue("b", "numerical", "low"), issue("c", "evidence", "medium"), issue("d", "evidence", "low")],
      sceptic: [
        { hypothesisId: "h1", claimId: "e", criterion: "contributions", failureMode: "f", precedentCaseId: "X", reasoning: "r", question: "q-h1" },
        { hypothesisId: "h2", claimId: "a", criterion: "judging", failureMode: "f", precedentCaseId: "X", reasoning: "r", question: "q-h2" },
      ],
      clearCriteria: new Set(["awards"]),
      max: 4,
    });
    assert.deepEqual(questions.map((q) => q.question), ["q-h1", "q-h2", "q-b", "q-c"]);
    assert.equal(questions[0].type, "failure_mode");
    assert.equal(questions[0].hypothesisId, "h1");
    assert.deepEqual(notAskedIssues.map((i) => i.claimId).sort(), ["a", "d"]); // "a" deduped by claim
  });

  // ── Final decision ──
  const dClaims = [
    { id: "a", criterion: "awards" as const, summary: "Grand prize" },
    { id: "m", criterion: "membership" as const, summary: "Fellow" },
    { id: "c", criterion: "contributions" as const, summary: "Library" },
    { id: "s", criterion: "remuneration" as const, summary: "$210K" },
    { id: "r", criterion: "critical_role" as const, summary: "Founding engineer" },
  ];
  const dh = (claimId: string, criterion: Hypothesis["criterion"], before: "applies" | "unknown", result: "cleared" | "confirmed" | "still_unknown") => ({
    hypothesisId: `h_${claimId}`, claimId, criterion, failureMode: "fm", result, queueStatusBefore: before,
    queueStatusAfter: queueStatusAfter(before, result), hypothesis: { precedent: { caseId: "X" } },
  });
  await test("decision: contradicted and confirmed evidence stop counting; a rescue counts", () => {
    const d = decide({
      claims: dClaims,
      findings: [{ claimId: "m", status: "contradicted" }, { claimId: "a", status: "corroborated" }],
      hypotheses: [dh("s", "remuneration", "applies", "confirmed"), dh("c", "contributions", "applies", "cleared"), dh("r", "critical_role", "unknown", "still_unknown")],
    });
    const by = Object.fromEntries(d.criteria.map((c) => [c.criterion, c.status]));
    assert.deepEqual(by, { awards: "clear", membership: "flagged", contributions: "clear", critical_role: "open", remuneration: "flagged" });
    assert.equal(d.criteriaCounted, 3);
    assert.equal(d.routing, "to_lawyer");
    assert.equal(d.rescued, 1);
  });
  await test("decision: fewer than 3 criteria → needs_more_evidence", () => {
    const d = decide({ claims: dClaims.slice(0, 3), findings: [{ claimId: "m", status: "contradicted" }], hypotheses: [] });
    assert.equal(d.criteriaCounted, 2);
    assert.equal(d.routing, "needs_more_evidence");
  });

  // ── Tools that need no network ──
  await test("wages: $217K senior SWE in Palo Alto sits below San Jose Level 4", () => {
    const r = benchmarkSalary({ jobTitle: "Senior Software Engineer", location: "Palo Alto, CA", salary: 217000 });
    assert.ok(!("error" in r));
    assert.equal(r.areaName, "San Jose-Sunnyvale-Santa Clara, CA");
    assert.equal(r.socCode, "15-1252");
    assert.ok(r.salary! < r.levels.level4);
  });
  await test("wages: 'Seattle, Washington' maps to Seattle, not DC", () => {
    const r = benchmarkSalary({ jobTitle: "ML Engineer", location: "Seattle, Washington", salary: 1 });
    assert.ok(!("error" in r) && r.areaName.startsWith("Seattle"));
  });
  await test("patent numbers normalise", () => {
    assert.equal(normalizePatentNumber("US 11,234,567"), "US11234567");
    assert.equal(normalizePatentNumber("us11234567b2"), "US11234567B2");
    assert.equal(normalizePatentNumber("9000000"), "US9000000");
  });

  // ── The real sceptic queue (rag/out) ──
  const ragDir = process.env.SCEPTIC_RAG_DIR ?? "../AAA_EF_Hackathon/rag";
  const file = process.argv[2] ?? path.join(ragDir, "out", "queue_test_01.json");
  await test(`real queue ${file}: items map to claims and the summary recomputes`, async () => {
    const queue = await readQueue(file);
    // A hand-written applicant (ev_1...) has no claim ids, so items fall back to the first claim with the criterion.
    const claims = [
      { id: "c_sch", criterion: "scholarly" },
      { id: "c_jud", criterion: "judging" },
      { id: "c_con", criterion: "contributions" },
      { id: "c_role", criterion: "critical_role" },
      { id: "c_sal", criterion: "remuneration" },
    ] as Pick<Claim, "id" | "criterion">[];
    const { items, skipped } = queueItems(queue, claims);
    const total = Object.values(queue.criteria).reduce((n, c) => n + c.items.length, 0);
    assert.equal(items.length + skipped.filter((s) => s.includes("no matching claim")).length, total);
    assert.ok(items.every((i: QueuedItem) => i.hypothesis === null), "today's queue has no hypotheses: all are drafted");
    assert.equal(new Set(items.map((i) => i.hypothesisId)).size, items.length, "hypothesis ids are unique");

    // Clear every high_salary item: it should stop being flagged.
    const salaryItems = items.filter((i) => i.criterion === "remuneration");
    const updated = investigatedQueue(
      queue,
      salaryItems.map((i) => ({ hypothesisId: i.hypothesisId, item: structuredClone(i.item), criterion: i.criterion, statusAfter: "does_not_apply", question: null, reasoning: "test" })),
    );
    assert.equal(queue.summary.criteria_status.high_salary, "flagged");
    assert.notEqual(updated.summary.criteria_status.high_salary, "flagged");
    assert.equal(updated.criteria.high_salary.items.length, 0);
    assert.equal(updated.criteria.high_salary.rescued.length, salaryItems.length);
    console.log(`  ${items.length} items; before: ${JSON.stringify(queue.summary.criteria_status)} → after clearing salary: ${JSON.stringify(updated.summary.criteria_status)} (${updated.summary.routing})`);
  });

  console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
}

main();
