/**
 * GET /api/demo-applicant — data for the "Load demo applicant" button.
 * Serves demo/applicant.local.json when present, else the fictional placeholder
 * (see src/lib/demo-source.ts).
 */
import { DemoFileError, loadDemoSubmission } from "@/lib/demo-source";
import type { ApplicationSubmission } from "@/lib/schemas";

export type DemoApplicantResponse = {
  source: "local" | "placeholder";
  submission: ApplicationSubmission;
};

export async function GET() {
  try {
    const body: DemoApplicantResponse = await loadDemoSubmission();
    return Response.json(body);
  } catch (error) {
    if (error instanceof DemoFileError) {
      return Response.json({ error: error.message, issues: error.issues }, { status: 500 });
    }
    throw error;
  }
}
