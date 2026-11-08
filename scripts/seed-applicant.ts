/**
 * Insert an applicant and their claims from a JSON file, exactly like the
 * intake form's submit endpoint does (same schema, same buildClaims()).
 *
 *   npm run seed                          uses scripts/applicant.json
 *   npm run seed demo/applicant.local.json
 *
 * Prints the new applicant id; then run `npm run pipeline <applicantId>`.
 */
import { readFile } from "node:fs/promises";

async function main() {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(file);
    } catch {
      // file missing
    }
  }
  const { db } = await import("../src/db");
  const { applicants, claims } = await import("../src/db/schema");
  const { buildClaims } = await import("../src/lib/claims");
  const { ApplicationSubmissionSchema } = await import("../src/lib/schemas");

  const file = process.argv[2] ?? "scripts/applicant.json";
  const parsed = ApplicationSubmissionSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
  if (!parsed.success) {
    console.error(`✗ ${file} doesn't match the application schema:`);
    for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    process.exitCode = 1;
    return;
  }

  const { applicant, criteria } = parsed.data;
  const newClaims = buildClaims(criteria);
  const saved = await db.transaction(async (tx) => {
    const [row] = await tx.insert(applicants).values(applicant).returning({ id: applicants.id });
    const claimRows = newClaims.length
      ? await tx
          .insert(claims)
          .values(newClaims.map((c) => ({ ...c, applicantId: row.id })))
          .returning({ id: claims.id, criterion: claims.criterion, summary: claims.summary })
      : [];
    return { applicantId: row.id, claims: claimRows };
  });

  console.log(`✓ Seeded ${applicant.name} with ${saved.claims.length} claim(s) from ${file}\n`);
  for (const c of saved.claims) console.log(`  ${c.criterion.padEnd(14)} ${c.summary}`);
  console.log(`\napplicantId: ${saved.applicantId}`);
  console.log(`Next: npm run pipeline ${saved.applicantId}`);
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
