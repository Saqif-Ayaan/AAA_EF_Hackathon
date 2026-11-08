/**
 * POST /api/cases/[id]/build — "Build case".
 * [id] = applicant ID. Checks the case is ready, responds 202 immediately, then
 * (via after()) writes the dossier with the template case builder, saves the
 * case, assembles the CaseBundle and hands it to the scoring agent
 * (src/scorer/index.ts). Progress shows up as caseBuilder / scorer events.
 */
import { after } from "next/server";
import { assertBuildable, buildCase, BuildCaseError } from "@/lib/build-case";

export async function POST(_req: Request, ctx: RouteContext<"/api/cases/[id]/build">) {
  const { id } = await ctx.params;
  try {
    await assertBuildable(id);
  } catch (err) {
    if (err instanceof BuildCaseError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
  after(() => buildCase(id).catch(() => {})); // failures are logged as caseBuilder error events
  return Response.json({ status: "building" }, { status: 202 });
}
