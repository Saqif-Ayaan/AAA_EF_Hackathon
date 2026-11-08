/**
 * Run the o1Pipeline workflow for one applicant, streaming the war-room events
 * to the terminal, then print the findings and discrepancies.
 *
 *   npm run pipeline <applicantId>
 *
 * Seed an applicant first with `npm run seed`.
 */
import type { FinalDecision } from "../src/lib/decision";
import type { AgentEvent, Claim, Discrepancy, FindingRecord, HypothesisRecord } from "../src/lib/schemas";

const ICONS: Record<string, string> = {
  status: "●",
  tool_call: "→",
  tool_result: "←",
  finding: "✓",
  handoff: "⇢",
  message: "?",
  verdict: "★",
};

function formatEvent(e: AgentEvent): string {
  const time = e.createdAt.slice(11, 19);
  const agent = `[${e.agentId}]`.padEnd(13);
  const status = e.type === "status" && e.status ? `${e.status}${e.progress !== null ? ` ${e.progress}%` : ""} — ` : "";
  const url = e.type === "tool_call" && e.url ? `  (${e.url})` : "";
  return `${time} ${agent} ${ICONS[e.type] ?? "·"} ${status}${e.message}${url}`;
}

async function main() {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(file);
    } catch {
      // file missing
    }
  }
  const applicantId = process.argv[2];
  if (!applicantId) {
    console.error("Usage: npm run pipeline <applicantId>   (create one with `npm run seed`)");
    process.exitCode = 1;
    return;
  }

  const { and, desc, eq, gt } = await import("drizzle-orm");
  const { db } = await import("../src/db");
  const { applicants, claims, events } = await import("../src/db/schema");
  const { mastra } = await import("../src/mastra");

  const [applicant] = await db.select().from(applicants).where(eq(applicants.id, applicantId));
  if (!applicant) {
    const recent = await db.select({ id: applicants.id, name: applicants.name }).from(applicants).orderBy(desc(applicants.createdAt)).limit(5);
    console.error(`✗ No applicant with id "${applicantId}".`);
    if (recent.length) console.error(`Recent applicants:\n${recent.map((a) => `  ${a.id}  ${a.name}`).join("\n")}`);
    process.exitCode = 1;
    return;
  }
  const claimRows = (await db.select().from(claims).where(eq(claims.applicantId, applicantId))) as Claim[];
  console.log(`Vetting ${applicant.name}: ${claimRows.length} claim(s)\n`);

  // Print new events as they arrive (the same feed the war room polls).
  let lastId = (await db.select({ id: events.id }).from(events).orderBy(desc(events.id)).limit(1))[0]?.id ?? 0;
  const printNewEvents = async () => {
    const rows = (await db
      .select()
      .from(events)
      .where(and(eq(events.applicantId, applicantId), gt(events.id, lastId)))
      .orderBy(events.id)) as AgentEvent[];
    for (const e of rows) {
      console.log(formatEvent(e));
      lastId = e.id;
    }
  };
  const poller = setInterval(() => void printNewEvents().catch(() => {}), 500);

  const started = Date.now();
  const run = await mastra.getWorkflow("o1Pipeline").createRun();
  const result = await run.start({ inputData: { applicantId } });
  clearInterval(poller);
  await printNewEvents();
  const secs = ((Date.now() - started) / 1000).toFixed(0);

  if (result.status !== "success") {
    const error = "error" in result ? result.error : undefined;
    console.error(`\n✗ Pipeline ${result.status} after ${secs}s${error ? `: ${error instanceof Error ? error.message : JSON.stringify(error)}` : ""}`);
    process.exitCode = 1;
    return;
  }

  const { findings, discrepancies, hypotheses, decision } = result.result as {
    findings: FindingRecord[];
    discrepancies: Discrepancy[];
    hypotheses: HypothesisRecord[];
    decision: FinalDecision;
  };
  const claimById = new Map(claimRows.map((c) => [c.id, c]));
  const label = (claimId: string) => {
    const c = claimById.get(claimId);
    return c ? `${c.criterion} — ${c.summary}` : claimId;
  };

  console.log(`\n${"═".repeat(80)}\nFINDINGS (${findings.length})\n${"═".repeat(80)}`);
  for (const f of findings) {
    console.log(`\n[${f.status.toUpperCase()}] ${label(f.claimId)}`);
    console.log(`  found:    ${f.foundValue ?? "—"}`);
    console.log(`  identity: ${f.identityConfidence.toFixed(2)}`);
    console.log(`  why:      ${f.reasoning}`);
    for (const s of f.sources) console.log(`  source:   ${s.url}${s.title ? `  (${s.title})` : ""}`);
  }

  if (hypotheses.length) {
    console.log(`\n${"═".repeat(80)}\nFAILURE MODES (${hypotheses.length}, from the sceptic, investigated)\n${"═".repeat(80)}`);
    for (const h of hypotheses) {
      const moved = h.queueStatusBefore === h.queueStatusAfter ? h.queueStatusAfter : `${h.queueStatusBefore} → ${h.queueStatusAfter}`;
      console.log(`\n[${h.result.toUpperCase()}] ${label(h.claimId)}\n  ${h.failureMode} (${h.hypothesis.precedent.caseId}; queue: ${moved})`);
      for (const m of h.reliedOn.map((i) => h.measurements[i])) {
        console.log(`  ★ ${m.agentId}: ${m.metric} = ${m.value}${m.benchmark ? ` vs ${m.benchmark.description} = ${m.benchmark.value}` : ""}`);
      }
      console.log(`  why: ${h.reasoning}`);
    }
  }

  console.log(`\n${"═".repeat(80)}\nQUESTIONS (${discrepancies.length}, most impactful first)\n${"═".repeat(80)}`);
  for (const [i, d] of discrepancies.entries()) {
    console.log(`\nQ${i + 1} [${d.type}] ${label(d.claimId)}`);
    console.log(`  ${d.description}`);
    console.log(`  Q: ${d.question}`);
    if (d.requestedDocument) console.log(`  Requested document: ${d.requestedDocument}`);
  }

  console.log(
    `\n${"═".repeat(80)}\nFINAL DECISION: ${decision.routing === "to_lawyer" ? "TO LAWYER" : "NEEDS MORE EVIDENCE"} (${decision.criteriaCounted}/${decision.criteriaNeeded} criteria)\n${"═".repeat(80)}\n${decision.summary}`,
  );
  for (const c of decision.criteria) console.log(`  ${c.status.toUpperCase().padEnd(8)} ${c.criterion}: ${c.reasons.join(" ")}`);

  const counts = findings.reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.status]: (acc[f.status] ?? 0) + 1 }), {});
  console.log(
    `\n✓ Done in ${secs}s — ${Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(", ")}; ${discrepancies.length} open question(s), lower-impact issues kept as notes on their findings. Saved to the database.`,
  );
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.stack ?? err.message : err}`);
  process.exitCode = 1;
});
