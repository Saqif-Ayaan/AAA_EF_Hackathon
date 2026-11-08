/**
 * POST /api/applications
 * Body: ApplicationSubmission (see src/lib/schemas.ts)
 *
 * 1. Validates the submission with zod.
 * 2. Saves the applicant.
 * 3. Creates one claim per criterion entry (summary built in code, no LLM).
 * All inside one transaction, so a failure never leaves half an application.
 */
import { db } from "@/db";
import { applicants, claims } from "@/db/schema";
import { buildClaims } from "@/lib/claims";
import { ApplicationSubmissionSchema } from "@/lib/schemas";

export type SubmitApplicationResponse = {
  applicantId: string;
  claims: { id: string; criterion: string; summary: string }[];
};

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const parsed = ApplicationSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Some answers are missing or invalid",
        issues: parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
      },
      { status: 400 },
    );
  }

  const { applicant, criteria } = parsed.data;
  const newClaims = buildClaims(criteria);

  const result: SubmitApplicationResponse = await db.transaction(async (tx) => {
    const [saved] = await tx.insert(applicants).values(applicant).returning({ id: applicants.id });
    const savedClaims =
      newClaims.length > 0
        ? await tx
            .insert(claims)
            .values(newClaims.map((c) => ({ ...c, applicantId: saved.id })))
            .returning({ id: claims.id, criterion: claims.criterion, summary: claims.summary })
        : [];
    return { applicantId: saved.id, claims: savedClaims };
  });

  // TODO(agents branch): start the o1Pipeline workflow here (verify → questions).

  return Response.json(result, { status: 201 });
}
