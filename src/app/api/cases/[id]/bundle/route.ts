/**
 * GET /api/cases/[id]/bundle            the CaseBundle as JSON
 * GET /api/cases/[id]/bundle?download=1 same, as a file download
 * [id] = applicant ID. The scorer handoff (CaseBundleSchema in src/lib/schemas.ts):
 * applicant, claims, latest findings, discrepancies with resolutions, and the
 * latest built case. 409 until "Build case" has run.
 */
import { CaseBundleError, loadCaseBundle } from "@/lib/case-bundle";

export async function GET(request: Request, ctx: RouteContext<"/api/cases/[id]/bundle">) {
  const { id } = await ctx.params;
  try {
    const bundle = await loadCaseBundle(id);
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(JSON.stringify(bundle, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...(download ? { "Content-Disposition": `attachment; filename="case-bundle-${id}.json"` } : {}),
      },
    });
  } catch (err) {
    if (err instanceof CaseBundleError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
