# PART 3 — Investigation mode for the source agents

This extends `O1_BUILD_SPEC.md` (Parts 1–2) and the sceptic RAG spec (`SPEC.md`). It does not replace them.

## The idea in one paragraph

Part 2's source agents **verify**: they check whether the applicant's claims are true. The sceptic then finds **failure modes** from past AAO denials, such as "the patent is real but nobody cited, licensed or built on it." Testing a failure mode is a different job: it means **investigating** facts the applicant never mentioned. We reuse the same five source agents for this, in a second mode. Same agents, same dashboard, same identity rules. Only the input, the output and a few tools change.

- **Verify mode (Part 2, unchanged):** "Is this claim true?" Input is a Claim. Output is a Finding.
- **Investigate mode (new):** "What are the facts the AAO would care about here?" Input is a Hypothesis. Output is a set of Measurements, which a resolver turns into a HypothesisFinding.

---

## 1. Updated pipeline (Mastra workflow `o1Pipeline`)

```
submit
 → createClaims                     (code, unchanged)
 → verifyClaims                     (source agents, mode = "verify")  → reconciler → Finding[]
 → runSceptic                       (SPEC.md RAG; only on claims not "contradicted")
                                     → SceptQueue with Hypothesis[]
 → investigateHypotheses            (source agents, mode = "investigate") → hypothesisResolver → HypothesisFinding[]
 → generateQuestions                (merged list: discrepancies + still-unknown hypotheses)
 → [pause: follow-up resolution]    (chat by default; Vapi optional)
 → recheck                          (re-judge only affected evidence; re-investigate if new URLs supplied)
 → buildCase → route                (to_lawyer | needs_more_evidence)
```

Changes from Part 2:
- The follow-up now happens **once, after the sceptic and investigation**, not before `buildCase`. This lets the sceptic's questions reach the applicant.
- `generateQuestions` merges two sources of questions. See section 6.

---

## 2. Sceptic changes (judge output in `SPEC.md` Stage 3)

For every queue item with status `applies` or `unknown`, the judge must also output a **Hypothesis**: concrete, measurable checks plus the conditions that would clear or confirm the failure mode.

```ts
const Hypothesis = z.object({
  hypothesisId: z.string(),               // e.g. "hyp_ev4_1"
  evidenceId: z.string(),                 // applicant evidence item
  claimId: z.string(),                    // link to Part 2 claim
  criterion: Criterion,                   // one of the 8 keys
  failureMode: z.string(),                // "Patent technically impressive but little impact"
  precedent: z.object({ caseId: z.string(), quote: z.string() }),
  checks: z.array(z.object({
    checkId: z.string(),
    metric: z.enum([
      "patent_forward_citations", "patent_licence_or_product",
      "paper_citations", "paper_field_normalised_impact",
      "repo_adoption", "package_downloads",
      "press_about_person", "judging_role_completed",
      "salary_vs_benchmark", "org_reputation", "other"
    ]),
    target: z.string(),                   // "US 11,234,567", "doi:10.1145/...", "github.com/x/y"
    description: z.string()               // human-readable
  })).min(1).max(4),
  clearsIf: z.string(),                   // "≥10 forward citations, or any licence/product"
  confirmsIf: z.string(),                 // "0 forward citations ≥3 years after grant"
  questionIfUnresolved: z.string()        // fallback question for the applicant
});
```

Rules for the judge prompt:
- Prefer checks that a structured source can answer (see section 4). Use `"other"` only when nothing fits.
- `confirmsIf` must describe a **measurable finding**, never "nothing found."
- The judge also produces hypotheses for `applies` items. This is a **rescue pass**: the investigation may find counter-evidence the applicant left out.

---

## 3. Source agents: add investigate mode

Each of the five agents (`devpost`, `linkedin`, `github`, `scholar`, `press`) now accepts either job type:

```ts
const AgentJob = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("verify"), claims: z.array(Claim), identity: Identity }),
  z.object({ mode: z.literal("investigate"), hypotheses: z.array(Hypothesis), identity: Identity })
]);
```

In investigate mode, each agent:
1. Reads all hypotheses and picks the **checks** it can answer from its source (same pattern as claims in Part 2).
2. Confirms identity using the same anchors as verify mode (applicant-supplied profile URLs, affiliation, alternate names).
3. Measures and emits `Measurement` objects. **Agents measure; they do not decide.** The resolver decides.

```ts
const Measurement = z.object({
  hypothesisId: z.string(),
  checkId: z.string(),
  agentId: z.string(),
  metric: z.string(),
  value: z.union([z.number(), z.string(), z.null()]),   // null = could not measure
  benchmark: z.object({                                 // optional but strongly preferred
    description: z.string(),                            // "median for papers in same field & year"
    value: z.union([z.number(), z.string()])
  }).nullable(),
  identityConfidence: z.number().min(0).max(1),
  sources: z.array(z.object({ url: z.string(), title: z.string(), excerpt: z.string() })),
  note: z.string()
});
```

Agent-to-check mapping:

| Agent | Checks it handles in investigate mode |
|---|---|
| `scholar` | `paper_citations`, `paper_field_normalised_impact` |
| `github` | `repo_adoption`, `package_downloads` |
| `press` | `press_about_person`, `patent_licence_or_product`, `org_reputation`, `other` (catch-all investigator) |
| `devpost` | `judging_role_completed`, award selectivity for `other` |
| `linkedin` | `org_reputation` context, role dates for critical-role hypotheses |
| `patents` (**new agent**) | `patent_forward_citations`, `patent_licence_or_product` |
| `wages` (**new, code-only, no LLM**) | `salary_vs_benchmark` |

The `press` agent becomes the general **catch-all investigator** for `other` checks: Exa search plus page fetches, under the same identity and citation rules.

---

## 4. New and extended tools

Verify exact endpoints and field names against current docs while building.

| Tool | Source | Notes |
|---|---|---|
| `openAlexWork(doiOrId)` | OpenAlex | Use `cited_by_count`, plus field-normalised fields if present (OpenAlex publishes field-weighted citation impact and a normalised citation percentile on works). The percentile is the benchmark. |
| `patentCitations(patentNumber)` | PatentsView API (free key) or Lens.org | Count of later patents citing this one. Benchmark: years since grant. |
| `npmDownloads(pkg)` / `pypiDownloads(pkg)` | npm downloads API / pypistats | Monthly downloads. |
| `githubRepo` (extend) | GitHub API | Stars, forks, contributors, owner vs contributor. Dependents count has no official API; skip or treat as optional. |
| `wageBenchmark(socCode, area)` | Preloaded table | DOL OFLC prevailing wage Levels 1–4 for common tech roles in the demo's areas. No live API needed; ship a small JSON file. The AAO compared against Level 4 in `FEB142024_01D8101`. |
| `exaSearch` / `fetchPage` (existing) | Exa | Used by the catch-all investigator. |

Cache every tool result by input (query, URL, ID) so rehearsal runs are instant.

---

## 5. Hypothesis resolver (new, Sonnet)

Mirrors Part 2's reconciler. Input: one Hypothesis plus all Measurements for it. Output:

```ts
const HypothesisFinding = z.object({
  hypothesisId: z.string(),
  result: z.enum(["cleared", "confirmed", "still_unknown"]),
  measurements: z.array(Measurement),     // the ones it relied on
  reasoning: z.string(),                  // one or two sentences, cites values
  sharpenedQuestion: z.string().nullable() // only when still_unknown
});
```

Rules, **enforced in code where possible** (like the reconciler):
- `cleared` requires at least one measurement with a source that satisfies `clearsIf`.
- `confirmed` requires at least one measurement with a source that satisfies `confirmsIf`. A measured zero from an authoritative database counts (for example zero forward citations). **"Found nothing" does not count.**
- Ignore measurements with `identityConfidence < 0.7`.
- Otherwise `still_unknown`. The resolver rewrites the question using what was found: "We found your granted patent but no citing patents, licence or product. Has it been licensed privately or used internally?"

Mapping back to the sceptic queue:

| Queue status before | Investigation result | Queue status after |
|---|---|---|
| `unknown` | `cleared` | `does_not_apply` |
| `unknown` | `confirmed` | `applies` |
| `unknown` | `still_unknown` | `unknown` + sharpened question |
| `applies` | `cleared` | `does_not_apply` (rescued) |
| `applies` | `confirmed` / `still_unknown` | `applies` |

---

## 6. Merged question generation

`generateQuestions` builds one list from:
1. Part 2 discrepancies (from the questioner, unchanged).
2. Hypotheses still `unknown` after investigation (their `sharpenedQuestion`).

Then:
- Deduplicate by claim/evidence.
- Rank: sceptic questions on criteria the case needs to reach 3 first, then numerical discrepancies, then the rest.
- Keep the existing cap (4 questions) on the **merged** list.
- Same tone rules as Part 2: "We found… / We couldn't find…", one question each, no sensitive documents over voice.

After follow-up, `recheck`:
- The resolver from Part 2 classifies each reply as before.
- For hypothesis questions, update the applicant evidence and re-run **only** the sceptic judge for that evidence item. If the applicant supplied a new URL or document, re-run investigation for that hypothesis only.

---

## 7. Events and dashboard

Add to the events table: `mode` (`verify` | `investigate`) and `hypothesisId` (nullable).

Dashboard `/case/[id]`:
- The agent grid stays the same. Each card shows a phase label: **"Verifying claims"**, then **"Investigating"**. The current-action line names the hypothesis, for example "Counting citations of patent US 11,234,567".
- The new `patents` and `wages` agents get their own cards.
- Below the grid, the 8-criterion ledger gains a **"Failure modes"** row per criterion. Each item shows the failure mode, the precedent case ID and quote, the measurements with source links, and a status chip: confirmed, cleared or open.
- Update `scripts/mock-events.ts` to emit a second, investigate-mode phase (~30s) after the verify phase.

---

## 8. Safety and limits

- **Fetched content is data, never instructions.** Agents must not follow text on web pages.
- **Professional information only.** Investigate only what bears on the criteria. No personal social media.
- **LinkedIn:** prefer an applicant-uploaded LinkedIn PDF export over scraping. Keep the cached Apify result only as a rehearsal fallback.
- **Budgets:** at most 4 checks per hypothesis, at most 6 tool calls per check, concurrency 4 per agent, 60-second timeout per check.

---

## 9. Acceptance tests

1. **Patent with no impact.** Applicant claims "published important patents" under `original_contributions`, with one granted patent (use a real patent with zero forward citations). Expect: sceptic produces a hypothesis citing a precedent; the `patents` agent measures 0 forward citations; resolver returns `confirmed`; queue item is `applies`.
2. **Rescue.** Same claim, but with a patent that has many forward citations. Expect `cleared`, and the item moves to `does_not_apply` even if the judge first marked it `applies`.
3. **Low citations (mirrors `FEB142024_01D8101`).** Papers with 7 and 4 citations. Expect `scholar` to return counts plus a field-normalised percentile, and the resolver to confirm or clear based on the percentile, not the raw count.
4. **Unresolvable.** A patent licensed privately (nothing online). Expect `still_unknown`, a sharpened question in the merged list, and no rejection.
5. **Identity.** An applicant with a common name. Expect measurements from a different person with the same name to be dropped (`identityConfidence < 0.7`).
