# Scoring agent — handoff

**You edit one file: [`src/scorer/index.ts`](src/scorer/index.ts).** It exports

```ts
export async function scoreCase(bundle: CaseBundle): Promise<ScoreInput | null>
```

It ships with a **default scorer built on the sceptic RAG + the investigation**: it computes the final routing decision (`decide()` in [`src/lib/decision.ts`](src/lib/decision.ts)) and turns it into `approvalLikelihood`, `rfeRisk` and a plain-English `reasoning`. It's deterministic, makes no API calls, and keeps its weights in one `WEIGHTS` table. Tune it or replace the body with your own agent; nothing else in the app needs to change.

**The lax rule** (keep it if you replace the scorer): evidence is dropped only on high-confidence proof that it is invalid (a contradicted finding with `identityConfidence ≥ 0.8`, or a failure mode the investigation *confirmed* with a sourced measurement at `≥ 0.8`). Everything doubtful but unconfirmed still counts; it only raises the RFE risk.

## When it runs

1. Vetting finishes (5 source agents verify → reconciler → sceptic RAG over past AAO denials → 7 investigators measure its failure modes → hypothesis resolver → one merged list of questions) and the applicant answers the follow-up questions.
2. Someone clicks **Build case** on the dashboard (`/case/<applicantId>`). The app writes the dossier, saves the case, builds the `CaseBundle` and calls `scoreCase(bundle)`.
3. Whatever you return is validated, saved to the `scores` table and shown on the dashboard's score card.
4. **Last step:** the lawyer's PDF (`/case/<applicantId>/dossier`, "Save as PDF") opens with the score, the routing decision and the precedent check.

You can also run it by hand at any time (handy while developing): `npm run score <applicantId>`.

## Input: `CaseBundle`

Defined in [`src/lib/schemas.ts`](src/lib/schemas.ts) as `CaseBundleSchema` — that file is the source of truth for every field.

| Field | What it is |
|---|---|
| `applicant` | Who they are: `name`, `alternateNames`, `field`, `currentRole`, `currentOrganization`, `usWorkPlan`, profile `links`, `cvText`, `additionalInfo`. |
| `claims[]` | One per achievement from the intake form: `criterion` (one of the 8 O-1A criteria: `awards`, `membership`, `press`, `judging`, `contributions`, `scholarly`, `critical_role`, `remuneration`), a one-line `summary`, and the raw form entry in `payload`. |
| `findings[]` | The latest verification verdict per claim: `status` = `corroborated` · `partial` · `unverified` · `contradicted`, plus `foundValue`, `identityConfidence` (0–1), `sources` (URLs with excerpts) and `reasoning`. Notes from follow-up answers are appended to `reasoning`. |
| `discrepancies[]` | Questions raised during vetting: `type`, `description`, `question`, and how each was settled — `resolution` = `open` · `amended` · `substantiated` · `reframed` · `escalated`, with the applicant's `applicantResponse`. |
| `hypotheses[]` | Failure modes the sceptic found from past AAO denials, each investigated: `failureMode`, `precedent` (AAO case id + verbatim quote, inside `hypothesis`), `measurements[]` (value, benchmark, sources, `identityConfidence`), `result` = `cleared` · `confirmed` · `still_unknown`, and `queueStatusBefore` / `queueStatusAfter`. Empty if the sceptic didn't run. |
| `case` | The built case: `caseJson` (`summary`, `criteriaArgued[]` with `strength` strong/moderate/weak, `exhibits` and `weaknesses`; `criteriaNotArgued[]`; `unresolvedIssues[]`; `suggestedLetterWriters[]`; `evidenceStats`) and the dossier as `markdown`. |

To see a real one: click **Download case bundle** on the dashboard, or open `GET /api/cases/<applicantId>/bundle`.

## Output: `ScoreInput` (or `null`)

```ts
{
  approvalLikelihood: number; // 0–100
  rfeRisk: number;            // 0–100, risk of a Request for Evidence
  reasoning: string;          // shown on the score card
}
```

- Return `null` if you can't score yet — nothing is saved and the card keeps saying "Awaiting score".
- Out-of-range numbers or a thrown error are caught: nothing is saved and the scorer shows an error on the dashboard (details in the server log).
- **Why `ScoreInput` and not `Score`?** In `schemas.ts`, `Score` is `ScoreInput` plus `id`, `caseId` and `createdAt`. The app fills those in when it saves your result, so you only return the three fields above.

The score card colours `approvalLikelihood` ≥ 70 as "Strong case" and ≥ 45 as "Borderline"; `rfeRisk` < 34 is "Low" and < 60 "Elevated".

## Development loop

```bash
npm install
cp .env.example .env            # add ANTHROPIC_API_KEY if your scorer calls Claude
npm run db:push

npm run seed:followup           # a test case with findings + open questions — no paid API calls
npm run dev                     # open the printed /case/<id>/followup link, answer the questions,
                                # then go to /case/<id> and click "Build case"
npm run score <applicantId>     # re-run just your scorer on that case's latest bundle
```

Each `npm run score` saves a new score; the dashboard always shows the latest one.

## One way to write it

```ts
import { Agent } from "@mastra/core/agent";
import { ScoreInputSchema, type CaseBundle, type ScoreInput } from "../lib/schemas";

const scorer = new Agent({
  id: "scorer",
  name: "Scorer",
  model: "anthropic/claude-opus-5-5",
  instructions: "You are an experienced O-1A attorney. Estimate approval likelihood and RFE risk from the case bundle…",
});

export async function scoreCase(bundle: CaseBundle): Promise<ScoreInput | null> {
  const result = await scorer.generate(JSON.stringify(bundle), { structuredOutput: { schema: ScoreInputSchema } });
  return result.object;
}
```

Prefer Python? Keep the scorer as its own service and make `scoreCase` `fetch()` it with the bundle as JSON — the bundle is plain JSON and the reply only needs the three fields above.
