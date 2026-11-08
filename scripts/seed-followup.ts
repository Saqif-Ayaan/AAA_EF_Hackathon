/**
 * npm run seed:followup
 * Creates a test case with open follow-up questions and prints its URLs.
 * Safe to run repeatedly — each run creates a new, separate case.
 */
import { seedFollowupCase } from "./followup-fixture";

async function main() {
  const result = await seedFollowupCase();
  const port = process.env.PORT ?? "3000";
  console.log(`\nSeeded a test case for ${result.applicantName} (${result.source} demo data)`);
  console.log(`Open questions: ${result.questions}`);
  console.log(`Applicant ID:   ${result.applicantId}\n`);
  console.log(`Follow-up chat: http://localhost:${port}/case/${result.applicantId}/followup`);
  console.log(`API:            http://localhost:${port}/api/cases/${result.applicantId}/discrepancies`);
  console.log(`(If npm run dev printed a different port, use that one.)\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
