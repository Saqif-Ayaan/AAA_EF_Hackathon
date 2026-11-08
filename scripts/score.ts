/**
 * Run the scoring agent (src/scorer/index.ts) on a case's latest CaseBundle and
 * save the score, exactly like "Build case" does. For developing the scorer.
 *
 *   npm run score <applicantId>
 *
 * The case must have been built first ("Build case" on the dashboard).
 */
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
    console.error("Usage: npm run score <applicantId>");
    process.exitCode = 1;
    return;
  }

  const { CaseBundleError, loadCaseBundle } = await import("../src/lib/case-bundle");
  const { scoreAndSave } = await import("../src/lib/scoring");

  let bundle;
  try {
    bundle = await loadCaseBundle(applicantId);
  } catch (err) {
    if (err instanceof CaseBundleError) {
      console.error(`✗ ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const open = bundle.discrepancies.filter((d) => d.resolution === "open").length;
  console.log(`Scoring ${bundle.applicant.name}`);
  console.log(
    `  ${bundle.claims.length} claims · ${bundle.findings.length} findings · ${bundle.discrepancies.length} discrepancies (${open} open)`,
  );
  console.log(`  case ${bundle.case.id}: ${bundle.case.caseJson.criteriaArgued.length} criteria argued\n`);

  const result = await scoreAndSave(bundle);
  if (result.status === "saved") {
    const s = result.score;
    console.log(`✓ Saved: approval likelihood ${s.approvalLikelihood}/100 · RFE risk ${s.rfeRisk}/100`);
    console.log(`  ${s.reasoning}`);
  } else if (result.status === "awaiting") {
    console.log("· scoreCase() returned null — nothing saved; the dashboard shows “Awaiting score”.");
    console.log("  Implement the scorer in src/scorer/index.ts (see SCORER.md).");
  } else {
    console.error(`✗ ${result.message}`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(`✗ ${err instanceof Error ? (err.stack ?? err.message) : err}`);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(), 50));
