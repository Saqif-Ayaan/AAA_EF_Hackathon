/**
 * Runs the o1Pipeline workflow (5 source agents → reconciler → questioner →
 * save) for one applicant. It takes a few minutes and makes real, billed API
 * calls (Claude, Exa, Apify, GitHub, OpenAlex), so call it once per submission,
 * in the background — never from tests.
 *
 * Never throws: a failure is logged as a pipeline error event for the war room.
 */
import { mastra } from "../mastra";
import { logEvent } from "./event-log";

export async function runPipeline(applicantId: string): Promise<boolean> {
  try {
    const run = await mastra.getWorkflow("o1Pipeline").createRun();
    const result = await run.start({ inputData: { applicantId } });
    if (result.status === "success") return true;

    const error: unknown = "error" in result ? result.error : undefined;
    const reason =
      error && typeof error === "object" && "message" in error
        ? String(error.message) // Error, or an Error serialized by the workflow engine
        : error
          ? String(error)
          : result.status;
    await logEvent({ applicantId, agentId: "pipeline", type: "status", status: "error", message: `Vetting stopped: ${reason}` });
  } catch (err) {
    console.error(`[pipeline] ${applicantId} failed`, err);
    await logEvent({
      applicantId,
      agentId: "pipeline",
      type: "status",
      status: "error",
      message: `Vetting failed: ${err instanceof Error ? err.message : String(err)}`,
    }).catch(() => {});
  }
  return false;
}
