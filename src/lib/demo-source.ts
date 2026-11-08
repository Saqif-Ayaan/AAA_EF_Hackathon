/**
 * Where the demo applicant comes from (server-side only — reads the filesystem).
 *
 * demo/applicant.local.json holds a real person's details, so it is gitignored
 * and never committed (this repo is public). Without it we fall back to the
 * fictional placeholder in src/lib/demo-applicant.ts.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DEMO_SUBMISSION } from "./demo-applicant";
import { ApplicationSubmissionSchema, type ApplicationSubmission } from "./schemas";

export const LOCAL_DEMO_FILE = path.join(process.cwd(), "demo", "applicant.local.json");

export class DemoFileError extends Error {
  constructor(
    message: string,
    public issues: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

export async function loadDemoSubmission(): Promise<{ source: "local" | "placeholder"; submission: ApplicationSubmission }> {
  let raw: string;
  try {
    raw = await readFile(LOCAL_DEMO_FILE, "utf8");
  } catch {
    return { source: "placeholder", submission: DEMO_SUBMISSION };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new DemoFileError("demo/applicant.local.json is not valid JSON");
  }

  // Unknown keys such as "_notes" are stripped by the schema.
  const parsed = ApplicationSubmissionSchema.safeParse(json);
  if (!parsed.success) {
    throw new DemoFileError(
      "demo/applicant.local.json doesn't match the application schema",
      parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
    );
  }
  return { source: "local", submission: parsed.data };
}
