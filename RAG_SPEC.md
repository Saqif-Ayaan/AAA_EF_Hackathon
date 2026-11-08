# O-1A Sceptic RAG — Build Spec

## What we are building

A "sceptic" system that reviews an O-1A visa applicant's case and flags evidence that is likely to be rejected, using real precedent from published USCIS Administrative Appeals Office (AAO) decisions.

It is a **reject-only** filter. Our data is almost entirely denials, so the system never decides that evidence is good. It only looks for known failure modes. The default is to pass evidence through. We optimise for being lax: wrongly passing a weak case costs a lawyer a few minutes, while wrongly rejecting a strong one loses a client.

### In scope for this build
1. Download and preprocess all published O-1A AAO decisions (about 286).
2. Build a case card for every decision and split each decision into per-criterion sections.
3. Given an applicant case (a hand-written JSON file for now), find relevant precedent and judge which failure modes apply to each piece of the applicant's evidence.
4. Output a queue of flagged items.

### Out of scope for now
- Intake form, case-building agent, web research and verification agent.
- Voice agent. It will run at the end of the pipeline and consume the queue's `unknown` items. Design the queue so it can.
- Final-merits review. A human lawyer does that.

---

## The 8 O-1A criteria

An applicant needs a major internationally recognised award, or at least 3 of these 8 criteria. Regulation: 8 C.F.R. § 214.2(o)(3)(iii)(B)(1)–(8). Use these keys everywhere.

| Key | Criterion | Reg |
|---|---|---|
| `awards` | Nationally or internationally recognised prizes or awards for excellence | (B)(1) |
| `membership` | Membership in associations requiring outstanding achievement, judged by recognised experts | (B)(2) |
| `published_material` | Published material about the beneficiary in professional, major trade or major media publications | (B)(3) |
| `judging` | Participation as a judge of the work of others in the field | (B)(4) |
| `original_contributions` | Original scientific, scholarly or business-related contributions of major significance | (B)(5) |
| `scholarly_articles` | Authorship of scholarly articles in professional journals or major media | (B)(6) |
| `critical_role` | Employment in a critical or essential capacity for organisations with a distinguished reputation | (B)(7) |
| `high_salary` | High salary or other remuneration, shown by contracts or other reliable evidence | (B)(8) |

Older decisions sometimes write the regulation as `214.2(o)(3)(B)(iii)(N)`. Treat both forms as the same criterion.

---

## Stage 0 — Download the decisions

**Source.** USCIS publishes O-1 decisions under the "D8 – Aliens of Extraordinary Ability or Achievement (O-1, O-2, and O-3)" category, grouped by year. Example file:

```
https://www.uscis.gov/sites/default/files/err/D8-Aliens-of-Extraordinary-Ability-or-Achievement_O-1_O-2_and_O-3/Decisions_Issued_in_2024/FEB142024_01D8101.pdf
```

Discover the file list from the USCIS AAO non-precedent decisions search page, filtered to the D8 category, for every year available.

**Notes.**
- USCIS blocks obvious bots. Run the downloader locally with a normal browser User-Agent, a delay of 1–2 seconds between requests, and retries with backoff. If it is still blocked, fall back to downloading manually into `data/raw/`.
- Store each PDF as `data/raw/<filename>.pdf`. The filename (for example `FEB142024_01D8101`) is the **case ID** used everywhere.
- Text extraction: use `pdfplumber` or `pdftotext` first. If a page yields almost no text, it is a scanned image, so run OCR (`pytesseract`). Save text to `data/text/<case_id>.txt`.
- Redactions appear as garbage characters or blank boxes. That is expected.
- If time is short, process 2015 onwards first. Those are cleaner and closer to current policy.

---

## Stage 1 — Preprocess each decision (offline, once)

Run one LLM call per decision, in parallel. Use a fast, cheap model. The call returns this JSON, validated with a schema (for example Pydantic):

```json
{
  "case_id": "FEB142024_01D8101",
  "date": "2024-02-14",
  "visa": "O-1A",
  "outcome": "dismissed | sustained | remanded",
  "procedural_only": false,
  "card": {
    "field": "machine learning for FPGA / EDA software",
    "role": "senior software development engineer",
    "employer_type": "semiconductor manufacturer",
    "location": "California",
    "criteria": {
      "judging": "met_not_reviewed",
      "scholarly_articles": "met_not_reviewed",
      "original_contributions": "not_met",
      "critical_role": "not_met",
      "high_salary": "not_met"
    }
  },
  "sections": [
    {
      "criterion": "original_contributions",
      "status": "not_met",
      "text": "<verbatim AAO text for this criterion's section>"
    }
  ]
}
```

**Status values.**
- `met`: the AAO found it met and discussed why.
- `met_not_reviewed`: the Director found it met and it was not disputed, so the AAO gave no reasoning.
- `not_met`: the AAO found it not met. **These are the sections the sceptic uses.**
- `not_reached`: the AAO declined to decide it, usually because three criteria were already impossible.
- `waived`: claimed earlier but not raised on appeal.
- Omit criteria that were never claimed.

**Rules for the preprocessing prompt.**
- `sections[].text` must be **verbatim** from the decision. Do not summarise. The judge needs the AAO's exact reasoning.
- Set `procedural_only: true` when the decision has no evidence analysis at all: untimely appeals, moot cases, summary dismissals, or rejections for a missing advisory opinion only. Exclude these from runtime.
- Keep only O-1A (sciences, education, business, athletics). Drop O-1B (arts, film, TV) and O-2/O-3 decisions.

**Splitting help.** Each criterion section usually starts with the regulation's wording (for example "Evidence of the alien's original scientific, scholarly, or business-related contributions…") followed by its citation `8 C.F.R. § 214.2(o)(3)(iii)(B)(5)`. A regex on these citations can pre-split the text before the LLM call, and can be used to check its output.

**Storage.** One SQLite database or JSON file, `data/cases.json`. Also write `data/cards.json`, containing only `case_id` plus `card` for each non-procedural case. That is the input to Stage 2.

---

## Stage 2 — Case filter (runtime)

**Input:** the applicant case (see schema below) and all case cards.

One LLM call ranks every case card for relevance to the applicant and returns the **top 40** case IDs, each with a one-line reason. Relevance means similar field, similar role, similar employer type, and overlapping claimed criteria. All ~286 cards fit in a single prompt. If needed, split into a few parallel batches and merge.

Use **prompt caching** on the card list, because it is identical for every applicant.

> **Revised (7 Nov 2026): rank on criteria overlap only, in code, with no model call.** The corpus is mostly athletes and coaches (about half of the 216 usable O-1A cards; only 14 are software/AI). Most failure modes don't depend on field, so field, role and employer are no longer used for ranking. Each card is scored by, highest first:
> 1. the number of criteria both the applicant and the case claimed;
> 2. tie-break: how many of those shared criteria the AAO found `not_met` (only these give the judge reasoning);
> 3. tie-break: most recent decision first.
>
> Cases with no `not_met` criterion in common with the applicant are skipped. The top 40 go to Stage 3. Implemented in `src/filter.py`.

> **Revised (7 Nov 2026): only decisions issued in 2015 or later are used at runtime** (93 of the 216 usable O-1A cards). Older decisions often apply criterion-stage tests that USCIS has since dropped, such as discounting scholarly articles for low citation counts or treating peer review as "routine". In testing these produced false `applies` flags. All 641 decisions stay preprocessed in `data/cases.json`. The cut-off is applied in the filter and can be changed with `RAG_MIN_YEAR`.

---

## Stage 3 — Per-criterion judge (runtime)

For each criterion the applicant claims:

1. From the 40 selected cases, collect every section where `criterion` matches and `status == "not_met"`.
2. If there are none, the criterion **passes by default** ("no precedent"). Record that and move on.
3. For each piece of the applicant's evidence under that criterion, send one call to a strong model with:
   - The applicant's evidence item, plus the applicant's field, role, location and employer.
   - All the collected failing sections for that criterion, each labelled with its case ID and that case's card.

**The judge must:**
- Extract the failure mode the AAO gave in each relevant section.
- Decide, for each failure mode it considers relevant, whether it applies to this applicant's evidence. It returns one of three statuses:
  - `applies`: the applicant's evidence clearly has the same weakness.
  - `does_not_apply`: it clearly does not. These are not saved.
  - `unknown`: it might, but the applicant's information is not enough to tell. Include the **question** that would resolve it.
- **Ignore procedural failures**, such as evidence filed after the petition date or submitted only on appeal. They say nothing about evidence quality.
- ~~Treat **corroboration failures** (a claim with no supporting document) as `unknown` with a question asking for the document, unless the applicant's case explicitly says no such document exists.~~
- **Revised (7 Nov 2026): the judge checks substance, not proof.** It takes the applicant's description as true and something they can document. It asks only whether what the applicant did is substantively the same kind of evidence the AAO rejected, for the same reason. **Corroboration and verification failures are ignored**, like procedural ones: no supporting document, uncorroborated claims, missing certificates, missing article title/date/author, missing circulation figures. `unknown` means the description leaves out a fact about what the applicant did that decides the question. The question asks for that fact, never for a document. Exception: when the evidence itself is the weakness (it *is* only counsel's statement, a self-published profile or an employer's marketing page), that is substance and is judged.
- Return only failure modes that are relevant. Returning none is allowed and expected.
- For every saved item, include the case ID and a **verbatim quote** of at most a few sentences from the AAO text supporting it.

**Citation check (in code, not the LLM).** After each judge call, verify that each quote appears in that case's section text, after normalising whitespace and case. Drop any item whose quote cannot be found, and log it.

---

## Output — the queue

Write `out/queue_<applicant_id>.json`:

```json
{
  "applicant_id": "test_01",
  "criteria": {
    "original_contributions": {
      "precedent_found": true,
      "items": [
        {
          "evidence_id": "ev_3",
          "evidence_summary": "Recommendation letters from two professors",
          "failure_mode": "Letters predict future impact rather than showing impact already achieved",
          "status": "applies",
          "reasoning": "Both letters describe what the work 'will' do for the industry; neither cites adoption.",
          "precedent": {
            "case_id": "FEB142024_01D8101",
            "quote": "they do not establish how his work already qualifies as a contribution of major significance in the field"
          },
          "question_for_applicant": null
        },
        {
          "evidence_id": "ev_4",
          "evidence_summary": "Granted patent on chip-placement method",
          "failure_mode": "Patent filed or granted, but no evidence of commercial use or adoption",
          "status": "unknown",
          "reasoning": "The case does not say whether the patent is licensed or used in a product.",
          "precedent": { "case_id": "...", "quote": "..." },
          "question_for_applicant": "Has your patent been licensed, or is it used in any product?"
        }
      ]
    },
    "high_salary": { "precedent_found": false, "items": [] }
  }
}
```

**Summary at the end of the file:**
- For each criterion: `flagged` (has at least one `applies` item and no surviving evidence), `open` (only `unknown` items), or `clear`.
- A criterion is still met if **at least one** of its evidence items has no `applies` failures. Count criteria that are `clear` or `open`.
- Routing: 3 or more criteria `clear`/`open` → `to_lawyer`. Fewer → `needs_more_evidence`. Do not phrase anything as legal advice.
- `questions_for_call`: all `unknown` questions, deduplicated, ordered by criterion.

---

## Applicant case input (manual for now)

> **Revised (7 Nov 2026):** `description` and `details` record **what the evidence is and what it shows**: who gave the award, to whom, how many competed, who wrote the article and what it is about, the numbers. They never record document-collection status (`"certificate": "not yet obtained"`, `"letter": false`). The judge assumes everything described can be documented. Leave out a fact you don't know rather than marking it missing; the judge will ask about it if it matters.

`input/applicant_<id>.json`:

```json
{
  "applicant_id": "test_01",
  "name": "Test Applicant",
  "field": "machine learning for chip design",
  "role": "senior ML engineer",
  "employer": "mid-size semiconductor company",
  "location": "San Jose, California",
  "evidence": [
    {
      "id": "ev_1",
      "criterion": "scholarly_articles",
      "medium": "conference paper",
      "description": "3 first-author papers at DAC and ICCAD",
      "details": { "citations": [12, 7, 3] }
    },
    {
      "id": "ev_2",
      "criterion": "original_contributions",
      "medium": "expert letter",
      "description": "Two letters from professors saying the method 'will transform EDA tooling'",
      "details": {}
    },
    {
      "id": "ev_3",
      "criterion": "high_salary",
      "medium": "offer letter",
      "description": "Total compensation $210K",
      "details": { "base": 160000, "comparison_data": "levels.fyi range for 'software engineer'" }
    }
  ]
}
```

---

## Suggested structure

```
data/raw/          PDFs
data/text/         extracted text
data/cases.json    full preprocessed decisions
data/cards.json    case cards only
input/             applicant JSON files
out/               queues
src/download.py
src/extract_text.py
src/preprocess.py  Stage 1
src/filter.py      Stage 2
src/judge.py       Stage 3 + citation check
src/run.py         applicant JSON in, queue out
src/schemas.py     Pydantic models for everything above
```

**Models.** A fast model (for example `claude-haiku-5-5`) for preprocessing and the case filter. A strong model (for example `claude-opus-5-5` or `claude-sonnet-5-5`) for the judge. Run preprocessing calls concurrently with a sensible concurrency limit.

> **Revised (7 Nov 2026): model calls go through `claude -p`, not the API.** See [How we call models](#how-we-call-models-revised) below. This replaces the direct Anthropic API / SDK usage above.

---

## How we call models (revised)

We do **not** call the Anthropic API directly or need an `ANTHROPIC_API_KEY`. Every model call is a headless Claude Code invocation (`claude -p`), using the developer's existing Claude Code login. All of this lives in one wrapper, `src/llm.py`. No other file knows how models are called.

**One call =**

```bash
claude -p \
  --model <model> --effort <low|medium|high> \
  --system-prompt-file <tmp file with the stage's instructions + large stable context> \
  --json-schema '<JSON Schema generated from the Pydantic model>' \
  --output-format json \
  --tools "" --strict-mcp-config --no-session-persistence \
  < user_message.txt
```

- **Structured output.** `--json-schema` is generated from the stage's Pydantic model. The CLI returns `structured_output` in its JSON result, and we validate it again with Pydantic before using it.
- **No tools, no agent loop.** `--tools ""` and `--strict-mcp-config` make each call a plain prompt → JSON call. It also runs from an empty scratch directory, so no project `CLAUDE.md`, hooks or MCP servers leak into the prompt.
- **Large context goes in the system prompt file.** That covers the card list in Stage 2 and the failing precedent sections in Stage 3. Passing it as a file avoids argv size limits. It also keeps the prefix identical between calls, so Claude Code's automatic prompt caching applies. The per-call part (applicant, evidence item, decision text) goes on stdin.
- **Errors.** If the process exits non-zero, returns `is_error: true` or has no `structured_output`, the call is retried with backoff (3 attempts) and then logged as a failure. One bad call never stops a batch.
- **Concurrency.** Calls are separate processes run from a thread pool (default 6 workers). Subscription rate limits are the real ceiling, so the worker count is a flag.
- **Usage.** `total_cost_usd` and per-model token counts from each result are summed and printed at the end of every stage.

**Model and effort per stage** (overridable by environment variable):

| Stage | Default model | Effort | Env override |
|---|---|---|---|
| 1 Preprocess (per decision) | `claude-haiku-5-5` | medium | `RAG_FAST_MODEL`, `RAG_FAST_EFFORT` |
| 2 Case filter | `claude-haiku-5-5` | medium | `RAG_FAST_MODEL`, `RAG_FAST_EFFORT` |
| 3 Judge (per evidence item) | `claude-opus-5` | medium | `RAG_STRONG_MODEL`, `RAG_STRONG_EFFORT` |

**Trade-offs we accept.** Each call carries Claude Code process start-up (about 1–2 s) and a small system-prompt overhead. Throughput is bounded by the subscription's rate limits rather than API tiers. Neither matters at our scale (about 650 preprocessing calls once, then a few dozen judge calls per applicant). Moving to the API later only means changing `src/llm.py`.

---

## Acceptance test

Write an applicant JSON that mirrors decision `FEB142024_01D8101`: a senior software engineer in ML for FPGA design tools, with papers whose top citations are 7 and 4, letters that only predict future impact, a critical-role claim made only by counsel, and $217K total pay that sits mid-range in its own comparison data.

Expected result:
- `FEB142024_01D8101` appears in the top 40 from the case filter.
- `original_contributions`, `critical_role` and `high_salary` each get at least one `applies` item citing that case, with quotes that pass the citation check.
- The final routing is `needs_more_evidence`.

Then write a deliberately strong applicant (for example a widely adopted open-source project, press about the person, and a top-of-band salary) and confirm it routes `to_lawyer` with few or no `applies` items.
