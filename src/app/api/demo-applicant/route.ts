/**
 * GET /api/demo-applicant — data for the "Load demo applicant" button.
 *
 * Uses demo/applicant.local.json if it exists (a real person's details, so it is
 * gitignored and never committed — this repo is public). Otherwise falls back to
 * the fictional placeholder in src/lib/demo-applicant.ts.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DEMO_SUBMISSION } from "@/lib/demo-applicant";
import { ApplicationSubmissionSchema, type ApplicationSubmission } from "@/lib/schemas";

const LOCAL_DEMO_FILE = path.join(process.cwd(), "demo", "applicant.local.json");

export type DemoApplicantResponse = {
  source: "local" | "placeholder";
  submission: ApplicationSubmission;
};

export async function GET() {
  let raw: string;
  try {
    raw = await readFile(LOCAL_DEMO_FILE, "utf8");
  } catch {
    const body: DemoApplicantResponse = { source: "placeholder", submission: DEMO_SUBMISSION };
    return Response.json(body);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return Response.json({ error: "demo/applicant.local.json is not valid JSON" }, { status: 500 });
  }

  // Unknown keys such as "_notes" are stripped by the schema.
  const parsed = ApplicationSubmissionSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      {
        error: "demo/applicant.local.json doesn't match the application schema",
        issues: parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
      },
      { status: 500 },
    );
  }

  const body: DemoApplicantResponse = { source: "local", submission: parsed.data };
  return Response.json(body);
}
