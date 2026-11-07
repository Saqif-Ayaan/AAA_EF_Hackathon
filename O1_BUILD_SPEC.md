# O-1A Intake → Vetting → Case Builder — Build Spec

> Hand this whole file to Claude Code. Build in the slices at the bottom, one at a time, and stop after each slice so a human can review.

## Product in one line
A structured O-1A intake that independently verifies an applicant's achievements online (with sources), surfaces discrepancies and follow-up questions, and assembles the strongest evidence-backed O-1A case — handed off to a separate scoring agent that estimates approval likelihood.

## Demo flow (what must work on stage)
1. Click **"Load demo applicant"** → form pre-fills (3 scripted discrepancies) → Submit.
2. War-room screen: vetting agent visibly works claim by claim (status, tool calls, sources).
3. Discrepancy panel lists issues + generated follow-up questions.
4. Follow-up resolves them (voice call if time, otherwise in-app chat).
5. Case builder produces the case dossier with cited exhibits.
6. Scoring agent (teammate's) returns approval likelihood → shown on screen.

---

## Stack
| Layer | Choice | Notes |
|---|---|---|
| App | Next.js (App Router) + TypeScript | Single app, run locally for the demo |
| UI | Tailwind + shadcn/ui | Multi-step form, war-room panels |
| Agents / orchestration | Mastra (`@mastra/core`) | Agents + one workflow; zod structured outputs |
| Models | `@ai-sdk/anthropic` | `claude-haiku-5-5` (search/extraction), `claude-sonnet-5-5` (vetting, questions), `claude-opus-5-5` (case builder) |
| Web search + page text | Exa (`exa-js`, `searchAndContents`) | Every finding must carry a source URL |
| Scholarly | OpenAlex REST API (free, no key; add `mailto=` param) | Authors, works, `cited_by_count` |
| Code | GitHub REST API | Repo owner, stars, contributor stats |
| DB | SQLite + Drizzle | Tables below |
| Voice (optional, last) | Vapi web SDK (`@vapi-ai/web`) | Browser call → no phone number setup |
| Validation | zod | Shared schemas = the handoff contract |

| LinkedIn | Apify (`apify-client`) | LinkedIn profile scraper actor; cache results |

Env vars: `ANTHROPIC_API_KEY`, `EXA_API_KEY`, `APIFY_TOKEN`, `GITHUB_TOKEN` (optional), `VAPI_PUBLIC_KEY` (optional), `OPENALEX_MAILTO`.

## Parallel build plan (3 terminals)
1. **Terminal 1, first ~10 min:** create `src/lib/schemas.ts` (all zod schemas incl. events with agentId/status/currentAction/progress/url/found), Drizzle tables, project scaffold. Commit. Everything else depends on this.
2. Then create worktrees: `git worktree add ../o1-ui -b ui` and `git worktree add ../o1-agents -b agents`; run `npm install` in each.
3. **T1 (main):** intake form + demo seed → later questions/follow-up + dossier.
4. **T2 (`../o1-ui`, port 3001):** dashboard agent grid against `scripts/mock-events.ts`. Do not edit schemas.
5. **T3 (`../o1-agents`):** tools (Exa, Apify, GitHub, OpenAlex, Devpost fetch) each with a CLI test (`npm run try <tool> <input>`), then source agents + reconciler + workflow. Do not edit UI files.
6. Merge into main in order: `agents`, then `ui`. Only T1 may change `schemas.ts`; if another terminal needs a change, make it in main and `git merge main` into the worktree.

---

## Data model (Drizzle tables)
- `applicants` — id, name, email, phone, field, currentRole, usWorkPlan, links (json: linkedin, github, scholar, website), cvText, consentToCall (bool), createdAt
- `claims` — id, applicantId, criterion (enum below), payload (json: the raw form entry), summary (string), createdAt
- `findings` — id, claimId, status (`corroborated|partial|unverified|contradicted`), foundValue (string|null), identityConfidence (0–1), sources (json: [{url, title, excerpt}]), reasoning, createdAt
- `discrepancies` — id, claimId, type (`numerical|identity|evidence|insufficient_proof|criterion_fit`), description, question, requestedDocument, resolution (`open|amended|substantiated|reframed|escalated`), applicantResponse, resolvedAt
- `cases` — id, applicantId, caseJson (json, see schema), markdown, createdAt
- `scores` — id, caseId, approvalLikelihood (0–100), rfeRisk (0–100), reasoning, createdAt
- `events` — id, applicantId, agent, type (`status|tool_call|tool_result|message|handoff|finding|verdict`), message, createdAt  ← drives the live UI

Criterion enum: `awards | membership | press | judging | contributions | scholarly | critical_role | remuneration`

---

## PART 1 — Intake form

Route: `/apply` — 10 steps: About you → 8 criteria → Anything else → Review & submit.

**Step: About you**
Full professional name · former/alternate names (maiden name, transliterations) · email · phone (optional) · consent to an AI follow-up call (checkbox, with disclosure that the caller is AI and an email alternative) · field of expertise · current role & organisation · planned US work · profile links (LinkedIn, GitHub, Google Scholar, ORCID, website) · CV upload (PDF → extract text server-side; `pdf-parse`).

**Each criterion step:** "Does this apply to you?" Yes/No. If Yes, a repeatable entry list ("+ Add another"). Fields per entry:

1. **Awards** — award name · issuing organisation · year · what was awarded · how winners were selected · number of recipients/entrants (if known) · announcement/certificate URL
2. **Membership** — association name · membership level · admission criteria · who evaluated the application · membership/association URL
3. **Press** — outlet · article title · publication date · URL · language · does the article focus on you or your work? (me / my company / brief mention)
4. **Judging** — journal/event · dates · number of reviews/judging sessions completed · what was assessed · proof URL or "I have emails/letters"
5. **Original contributions** — what you created · your individual contribution · evidence of impact (users, adoption, revenue, stars) · organisations using it · related patents/publications · independent source URLs
6. **Scholarly** — titles · venues · DOI links · publication count · claimed citation count · citation data source (Google Scholar/Semantic Scholar/other) · as-of date
7. **Critical role** — organisation · position · dates · responsibilities · measurable individual contributions · evidence of organisation's reputation (funding, press, rankings)
8. **Remuneration** — annual compensation · currency · year · job title · location · breakdown (base/bonus/equity) · benchmark source if known. Show note: "Salary is rarely public — we may ask for documents later."

**Final step: Anything else** — "Is there anything significant about your work that might not appear on your CV?" (free text)

**Submit:** `POST /api/applications` → insert applicant → convert each criterion entry into one `claims` row **in code** (no LLM needed; build `summary` from fields) → start workflow → redirect to `/case/[applicantId]` (war room).

**Demo seed:** "Load demo applicant" button fills the form with a realistic profile containing:
- Membership: "Thiel Fellow" (truth: finalist only) → agent should flag contradicted → applicant amends
- Scholarly: 10 citations claimed via Google Scholar; OpenAlex shows fewer; some papers under a former name → applicant substantiates
- Awards: hackathon win that is real but small (≈30 teams) → criterion_fit → reframed
Use a real public person ONLY with their consent (e.g. a teammate); otherwise use a teammate's real profile so verification hits real data.

---

## PART 2 UPDATE — Parallel source agents (supersedes the single verifier in 2a)

Instead of one verifier, run **one research agent per source, in parallel**, each visible as its own card on the dashboard:

| Agent id | Source | How it searches | Claims it mainly covers |
|---|---|---|---|
| `devpost` | Devpost | Fetch applicant's Devpost profile URL if given; else Exa search `site:devpost.com "<name>"`; read project pages for winner/finalist badges & hackathon size | awards, judging, contributions |
| `linkedin` | LinkedIn via **Apify** | `apify-client`: run a LinkedIn profile scraper actor from the Apify Store (one that takes a profile URL and needs no login cookies) on the applicant's LinkedIn URL → read experience, titles, dates, education, honors. Runs take ~20–60s: emit progress events while polling, and **cache the result per URL** (re-runs during rehearsal must be instant). Fallback if Apify fails: Exa search restricted to linkedin.com, then CV text | critical_role, membership, awards (honors section), remuneration context |
| `github` | GitHub API | User repos, stars, owner vs contributor, commit share | contributions, critical_role |
| `scholar` | OpenAlex API | Author search incl. former names → works, citation counts | scholarly, judging (as reviewer if visible) |
| `press` | Exa web search | Name + company + claimed outlet; open each article and check it is ABOUT the applicant | press, awards, membership |

Flow: `createClaims` → **fan out to the 5 source agents in parallel** (each receives ALL claims + applicant identity incl. alternate names, and decides which claims it can check) → each emits `sourceFindings[]` `{claimId, agentId, foundValue, sources[], identityConfidence, note}` → **`reconciler` agent** (Sonnet) merges per claim into the `Finding` schema → questioner.

Each source agent emits events with: `agentId`, `status` (`queued|searching|reading|done|error`), `currentAction` (e.g. `"Searching Devpost for 'Safiq …'"`), `progress` (0–100), `url` (page being read), `found` (short result). Add these columns to `events`.

**Dashboard (`/case/[id]`) — agent grid:** one card per source agent showing logo/name, status pill (pulsing while active), progress bar, current action line, the URL currently being read (clickable), and a scrolling mini-log of finds with links. Below the grid: the reconciled 8-criterion evidence ledger. Right: discrepancies/questions. Build the UI first against a **mock event generator** (`scripts/mock-events.ts` emitting realistic events for all 5 agents over ~60s) so UI and backend can be built in parallel.

Stretch (only if everything works): embed a live cloud-browser view for one agent so viewers literally watch it browse.

## PART 2 — Vetting agent (verify online + discrepancies + questions)

### 2a. Verifier (per claim, run in parallel, concurrency 4)
Mastra agent `verifier` (Sonnet). Tools:
- `exaSearch(query, numResults)` → [{url, title, text excerpt}]
- `fetchPage(url)` → page text (Exa contents)
- `openAlexAuthor(name)` / `openAlexWorks(authorId)` → works, citation counts
- `githubRepo(owner/repo)` / `githubUser(username)` → stars, owner, contributors
- `logEvent(agent, type, message)` (auto-called by tool wrapper — see Visibility)

Per-criterion checklist injected into the prompt:
- awards: award exists · applicant listed as recipient (not finalist/bounty) · scale/selectivity · issuer credibility
- membership: applicant is a member (not applicant/finalist) · admission is achievement-based, not paid
- press: open the article · it is about the applicant (not only the company/brief mention) · not a press release · outlet standing
- judging: actually completed judging/review (not only invited/mentored)
- contributions: applicant authored it (owner/top contributor) · independent evidence of impact
- scholarly: papers exist on OpenAlex · applicant is an author · compare claimed vs found citations, note database differences and former names
- critical_role: applicant held the role in the stated dates · role substance · organisation distinguished
- remuneration: do NOT mark false for lack of public data; mark `unverified` and request documents; optionally find a public benchmark

Output schema `Finding` (zod):
```ts
{ claimId: string,
  status: "corroborated" | "partial" | "unverified" | "contradicted",
  foundValue: string | null,          // e.g. "5 citations on OpenAlex"
  identityConfidence: number,         // 0–1: is this the same person?
  sources: { url: string; title: string; excerpt: string }[],  // REQUIRED unless unverified
  reasoning: string }
```
Rules: absence online ≠ false (→ `unverified`). `contradicted` only with a source that states otherwise. Always check identity (name variants, affiliation) before attributing anything.

### 2b. Discrepancy & question generator
Mastra agent `questioner` (Sonnet). Input: claim + finding. Runs only when status ≠ corroborated. Output schema:
```ts
{ claimId: string,
  type: "numerical" | "identity" | "evidence" | "insufficient_proof" | "criterion_fit",
  description: string,          // "Claimed 10 citations; OpenAlex shows 5"
  question: string,             // neutral, specific, one question
  requestedDocument: string | null }  // "Google Scholar profile link"
```
Tone rules: "We found…/We couldn't find…", never "you're wrong". One question per discrepancy. No sensitive docs requested over voice.

### 2c. Follow-up resolution
- Default (build first): in-app chat at `/case/[id]/followup` — agent asks each open question; applicant replies; `resolver` agent (Sonnet) classifies the reply → `amended | substantiated | reframed | escalated`, updates the claim/finding (e.g. amended claim text, new source URL) and writes `applicantResponse`.
- Optional (only if time): Vapi web call using the same open questions as the assistant's script; on call end, transcript → `resolver`. Must disclose it's an AI and only call if `consentToCall`.

---

## PART 3 — Case builder agent

Mastra agent `caseBuilder` (Opus). Input: applicant + all claims + findings + resolved discrepancies.
Rules:
- Use ONLY `corroborated`, or `substantiated` (by applicant document) facts. Never invent achievements. List anything else under gaps.
- Pick the strongest 3–5 criteria (need ≥3 of 8). Prefer quality over count.
- For each chosen criterion: legal-style argument paragraph, cited exhibits (source URLs), weaknesses and how to address them.
- Suggest recommendation-letter writers by role (e.g. "hackathon organiser who selected you as judge"), not invented names.

Output schema `Case` (zod) — **this is the handoff contract**:
```ts
{ applicantId: string,
  summary: string,                       // 3–4 sentence case theory
  criteriaArgued: {
    criterion: Criterion,
    strength: "strong" | "moderate" | "weak",
    argument: string,
    exhibits: { label: string; url: string; status: "corroborated" | "substantiated" }[],
    weaknesses: string[] }[],
  criteriaNotArgued: { criterion: Criterion; reason: string }[],
  unresolvedIssues: string[],
  suggestedLetterWriters: { role: string; reason: string }[],
  evidenceStats: { totalClaims: number; corroborated: number; substantiated: number;
                   unverified: number; contradicted: number } }
```
Also render a markdown dossier (`cases.markdown`) for display/download.

---

## HANDOFF — teammate's scoring agent
- `GET /api/cases/[id]/bundle` → `{ applicant, claims, findings, discrepancies, case }` (all zod-validated JSON). Language-agnostic: the scorer can be Python or TS.
- `POST /api/cases/[id]/score` ← `{ approvalLikelihood: 0–100, rfeRisk: 0–100, reasoning: string }` → stored in `scores`, shown as the final verdict card.
- Put the zod schemas in `src/lib/schemas.ts` and also export JSON Schema (`zod-to-json-schema`) to `schemas/case-bundle.json` for the teammate.

---

## Orchestration (Mastra workflow `o1Pipeline`)
```
submit → createClaims (code)
       → verifyClaims   (parallel verifier per claim)
       → generateQuestions (questioner per non-corroborated finding)
       → [pause: follow-up resolution]   ← human/applicant in the loop
       → buildCase      (caseBuilder)
       → notifyScorer   (case bundle ready; scorer POSTs back)
```
Steps 1–3 run automatically on submit. `buildCase` triggers via a "Build case" button (or automatically once no discrepancies are `open`).

---

## Visibility (war room UI at `/case/[id]`)
- Wrap every tool so `tool_call` / `tool_result` events auto-log; each workflow step logs `status` ("Verifier is checking: Thiel Fellowship"), `handoff`, and `finding`.
- UI polls `GET /api/cases/[id]/events` every 500ms.
- Layout:
  - Top: agent roster (Verifier · Questioner · Resolver · Case Builder · Scorer) with live status pills (idle/thinking/searching/done).
  - Left: 8-criterion evidence ledger — each claim row turns green/amber/grey/red with source links.
  - Centre: live activity feed (tool calls like "🔎 OpenAlex: works by J. Doe → 5 citations").
  - Right: discrepancies + questions → resolution badges; later the case dossier and score card.
- Big fonts. Add `?replay=1` mode that replays saved events on a timer (demo fallback).

---

## Agent system prompts (starting points)
- **verifier:** "You verify one O-1A claim using only the tools provided. Follow the checklist for the claim's criterion. Confirm identity before attributing evidence. Cite every source. If you cannot find evidence, return `unverified` — absence is not proof of falsehood. Return only the Finding JSON."
- **questioner:** "Given a claim and a verification finding, classify the discrepancy and write one neutral, specific question an applicant can answer in one sentence, plus the document that would resolve it."
- **resolver:** "Given the question and the applicant's reply, decide: amended (applicant corrects the claim), substantiated (applicant gives a credible explanation/document), reframed (fact true but fits another criterion or is only supporting evidence), or escalated (needs an attorney). Output the updated claim fields."
- **caseBuilder:** "You are an experienced O-1A paralegal. Build the strongest honest case from verified evidence only. Never fabricate. Argue the best 3–5 criteria with cited exhibits and flag weaknesses."

---

## Build slices (stop after each for review)
1. **Intake + DB + seed** (~45 min): schemas, Drizzle tables, `/apply` multi-step form, demo seed button, submit → claims created. Test: submitting the seed creates the expected claims.
2. **Verifier + war room** (~75 min): tools (Exa, OpenAlex, GitHub), verifier agent, parallel run, events + war-room UI with live ledger. Test: Finding schema validation; contradicted requires a source.
3. **Questions + in-app follow-up** (~30 min): questioner, resolver, follow-up chat, resolutions update ledger.
4. **Case builder + handoff** (~30 min): caseBuilder, dossier view, `/bundle` and `/score` endpoints, score card.
5. **Optional:** Vapi voice follow-up, replay mode, polish.
