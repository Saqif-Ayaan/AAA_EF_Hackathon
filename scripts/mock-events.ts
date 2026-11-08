/**
 * Mock event generator for the war-room dashboard at /case/[id].
 *
 * Seeds a fictional demo applicant with 9 claims, then plays ~95 seconds of
 * realistic activity into the `events` table: ~60s of the 5 source agents
 * verifying claims (devpost, linkedin, github, scholar, press), then ~30s of
 * PART 3 investigation (the sceptic's failure modes, measured by the 7
 * investigators incl. patents and wages, then the hypothesis resolver). Along
 * the way it writes what the real pipeline would: reconciled `findings` (the
 * ledger), `hypotheses` (its failure-mode rows) and one merged list of
 * `discrepancies` (the questions panel). Everything is validated against
 * src/lib/schemas.ts before it is written, so the mock can't drift from the
 * real contract.
 *
 * Re-running resets the same applicant id, so a dashboard left open on
 * /case/demo restarts cleanly.
 *
 *   npm run mock                      # /case/demo, real time (~97s)
 *   npm run mock -- --speed 4         # 4x faster
 *   npm run mock -- --id rehearsal-2  # different case id
 *
 * The applicant, outlets and URLs are made up; links may 404.
 */
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../src/db";
import { logEvent } from "../src/lib/event-log";
import {
  applicants,
  cases,
  claims,
  discrepancies,
  events,
  findings,
  hypotheses,
  scores,
} from "../src/db/schema";
import {
  ApplicantInputSchema,
  CRITERION_ENTRY_SCHEMAS,
  FindingSchema,
  HypothesisSchema,
  MeasurementSchema,
  QuestionerOutputSchema,
  SOURCE_AGENT_IDS,
  type AgentId,
  type AgentMode,
  type HypothesisResult,
  type Measurement,
  type QueueStatus,
  type AgentStatus,
  type ClaimPayload,
  type Criterion,
  type EventType,
  type FindingStatus,
  type QuestionerOutput,
  type Source,
} from "../src/lib/schemas";

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    id: { type: "string", default: "demo" },
    speed: { type: "string", default: "1" },
    port: { type: "string", default: process.env.PORT ?? "3000" },
  },
});
const APPLICANT_ID = args.id;
const SPEED = Number(args.speed);
if (!Number.isFinite(SPEED) || SPEED <= 0) {
  console.error(`--speed must be a positive number (got "${args.speed}")`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Demo applicant (fictional) + claims
// ─────────────────────────────────────────────────────────────────────────────

const applicant = ApplicantInputSchema.parse({
  name: "Ada Okafor",
  alternateNames: ["Ada Nwosu"],
  email: "ada.okafor@example.com",
  consentToCall: true,
  field: "Machine learning systems (retrieval & inference)",
  currentRole: "Founding Engineer",
  currentOrganization: "Lumen Labs",
  usWorkPlan: "Lead ML infrastructure at Lumen Labs in San Francisco",
  links: {
    linkedin: "https://www.linkedin.com/in/ada-okafor",
    github: "https://github.com/adaokafor",
    devpost: "https://devpost.com/adaokafor",
    scholar: "https://scholar.google.com/citations?user=adaokafor0",
  },
});

type ClaimKey =
  | "hackathon"
  | "thiel"
  | "pressProfile"
  | "pressSeed"
  | "judging"
  | "tinyrag"
  | "papers"
  | "foundingRole"
  | "salary";

const CLAIMS: Record<ClaimKey, { criterion: Criterion; summary: string; payload: unknown }> = {
  hackathon: {
    criterion: "awards",
    summary: "Grand Prize — Bay Area AI Hackathon 2025",
    payload: {
      awardName: "Grand Prize, Bay Area AI Hackathon 2025",
      issuingOrganization: "Bay Area AI Hackathon (on Devpost)",
      year: 2025,
      whatWasAwarded: "Grand Prize for the project 'tinyrag-live'",
      selectionProcess: "Judged by a panel of industry engineers",
      recipientsOrEntrants: "1 Grand Prize winner",
      url: "https://devpost.com/software/tinyrag-live",
    },
  },
  thiel: {
    criterion: "membership",
    summary: "Thiel Fellow (2024 cohort)",
    payload: {
      associationName: "Thiel Fellowship",
      membershipLevel: "Fellow, 2024 cohort",
      admissionCriteria: "Selected from thousands of applicants",
      evaluatedBy: "Thiel Foundation selection committee",
      url: "https://thielfellowship.org/",
    },
  },
  pressProfile: {
    criterion: "press",
    summary: "Bay Tech Review — “The engineer making retrieval cheap” (Sep 2025)",
    payload: {
      outlet: "Bay Tech Review",
      articleTitle: "The engineer making retrieval cheap",
      publicationDate: "2025-09-14",
      url: "https://www.baytechreview.com/2025/09/ada-okafor-retrieval-infrastructure",
      language: "English",
      focus: "me",
    },
  },
  pressSeed: {
    criterion: "press",
    summary: "SF Business Daily — Lumen Labs $8M seed round (Mar 2025)",
    payload: {
      outlet: "SF Business Daily",
      articleTitle: "Lumen Labs raises $8M seed to shrink inference costs",
      publicationDate: "2025-03-02",
      url: "https://www.sfbusinessdaily.com/2025/03/lumen-labs-raises-8m-seed",
      language: "English",
      focus: "my_company",
    },
  },
  judging: {
    criterion: "judging",
    summary: "Judge, Bay Area AI Hackathon 2026 — 12 projects reviewed",
    payload: {
      eventOrJournal: "Bay Area AI Hackathon 2026",
      dates: "April 2026",
      sessionsCompleted: 12,
      whatWasAssessed: "Final-round hackathon projects",
      proofUrl: "https://bayarea-ai-2026.devpost.com/",
      hasEmailsOrLetters: true,
    },
  },
  tinyrag: {
    criterion: "contributions",
    summary: "Created tinyrag, an open-source retrieval library (4.2k ★)",
    payload: {
      whatYouCreated: "tinyrag — open-source retrieval library",
      individualContribution: "Creator and lead maintainer",
      impactEvidence: "4.2k GitHub stars, 300+ dependent repositories",
      organizationsUsingIt: "Lumen Labs and other startups",
      independentSourceUrls: ["https://github.com/adaokafor/tinyrag"],
    },
  },
  papers: {
    criterion: "scholarly",
    summary: "6 papers, 10 citations (Google Scholar)",
    payload: {
      titles: [
        "Cheap Retrieval: Quantized Indexes for Small Models",
        "Latency-Aware Re-ranking at the Edge",
      ],
      venues: ["arXiv", "MLSys Workshop on Efficient Systems"],
      publicationCount: 6,
      claimedCitationCount: 10,
      citationSource: "google_scholar",
      asOfDate: "2026-10",
    },
  },
  foundingRole: {
    criterion: "critical_role",
    summary: "Founding Engineer, Lumen Labs (Jan 2023 – present)",
    payload: {
      organization: "Lumen Labs",
      position: "Founding Engineer",
      startDate: "2023-01",
      endDate: "present",
      responsibilities: "Built the retrieval and inference stack",
      measurableContributions: "Cut inference cost 4× for the core product",
      organizationReputationEvidence: "$8M seed (2025), press coverage",
    },
  },
  salary: {
    criterion: "remuneration",
    summary: "$210,000 USD total compensation (2025)",
    payload: {
      annualCompensation: 210000,
      currency: "USD",
      year: 2025,
      jobTitle: "Founding Engineer",
      location: "San Francisco, CA",
      breakdown: { base: 185000, equity: 25000 },
    },
  },
};

const claimIds = Object.fromEntries(
  (Object.keys(CLAIMS) as ClaimKey[]).map((k) => [k, randomUUID()]),
) as Record<ClaimKey, string>;

// ─────────────────────────────────────────────────────────────────────────────
// URLs the agents "read"
// ─────────────────────────────────────────────────────────────────────────────

const U = {
  devpostProfile: "https://devpost.com/adaokafor",
  devpostProject: "https://devpost.com/software/tinyrag-live",
  devpostGallery: "https://bayarea-ai-2025.devpost.com/project-gallery",
  devpostJudges: "https://bayarea-ai-2026.devpost.com/#judges",
  ghUser: "https://github.com/adaokafor",
  ghRepos: "https://github.com/adaokafor?tab=repositories",
  ghRepo: "https://github.com/adaokafor/tinyrag",
  ghContributors: "https://github.com/adaokafor/tinyrag/graphs/contributors",
  ghDependents: "https://github.com/adaokafor/tinyrag/network/dependents",
  ghOrg: "https://github.com/lumen-labs",
  oaAuthorSearch: "https://api.openalex.org/authors?search=Ada%20Okafor",
  oaWorksOkafor: "https://api.openalex.org/works?filter=author.id:A5091827364",
  oaAuthorSearchFormer: "https://api.openalex.org/authors?search=Ada%20Nwosu",
  oaWorksNwosu: "https://api.openalex.org/works?filter=author.id:A5012983746",
  pressProfile: "https://www.baytechreview.com/2025/09/ada-okafor-retrieval-infrastructure",
  pressSeed: "https://www.sfbusinessdaily.com/2025/03/lumen-labs-raises-8m-seed",
  pressThielFinalists: "https://www.foundersdigest.com/2024/06/thiel-fellowship-2024-finalists",
  thielOfficial: "https://thielfellowship.org/",
  pressRecap: "https://www.baytechreview.com/2025/05/bay-area-ai-hackathon-recap",
  liProfile: "https://www.linkedin.com/in/ada-okafor",
  liExperience: "https://www.linkedin.com/in/ada-okafor/details/experience/",
  liHonors: "https://www.linkedin.com/in/ada-okafor/details/honors/",
};

// ─────────────────────────────────────────────────────────────────────────────
// Timeline
// ─────────────────────────────────────────────────────────────────────────────

type EventStep = {
  at: number; // seconds from start (at speed 1)
  kind: "event";
  agentId: AgentId;
  type: EventType;
  message: string;
  status?: AgentStatus;
  currentAction?: string;
  progress?: number;
  url?: string;
  found?: string;
  /** Defaults to "verify" for source agents and the reconciler. */
  mode?: AgentMode;
  hypothesisId?: string;
};
type FindingStep = {
  at: number;
  kind: "finding";
  claim: ClaimKey;
  status: FindingStatus;
  foundValue: string | null;
  identityConfidence: number;
  sources: Source[];
  reasoning: string;
};
type DiscrepancyStep = {
  at: number;
  kind: "discrepancy";
  claim: ClaimKey;
  hypothesisId?: string;
} & Omit<QuestionerOutput, "claimId">;
/** PART 3: one investigated failure mode lands in the ledger. */
type HypothesisStep = {
  at: number;
  kind: "hypothesis";
  claim: ClaimKey;
  hypothesisId: string;
  failureMode: string;
  precedent: { caseId: string; quote: string };
  checks: { checkId: string; metric: Measurement["metric"]; target: string; description: string }[];
  clearsIf: string;
  confirmsIf: string;
  questionIfUnresolved: string;
  queueStatusBefore: "applies" | "unknown";
  result: HypothesisResult;
  measurements: Omit<Measurement, "hypothesisId">[];
  reasoning: string;
  sharpenedQuestion: string | null;
};
type Step = EventStep | FindingStep | DiscrepancyStep | HypothesisStep;

const steps: Step[] = [];

/** Events for one agent. Each entry: [at, type, fields]. */
function agent(
  agentId: AgentId,
  entries: [number, EventType, Omit<EventStep, "at" | "kind" | "agentId" | "type">][],
) {
  for (const [at, type, fields] of entries) steps.push({ at, kind: "event", agentId, type, ...fields });
}

const src = (url: string, title: string, excerpt: string): Source => ({ url, title, excerpt });

// ── Pipeline ────────────────────────────────────────────────────────────────
agent("pipeline", [
  [0.0, "status", { message: "Case created — 9 claims across 8 criteria" }],
  [0.6, "handoff", { message: "Fanning out to 5 source agents in parallel" }],
]);

// ── Source agents: queued ───────────────────────────────────────────────────
for (const [i, id] of (["devpost", "linkedin", "github", "scholar", "press"] as const).entries()) {
  agent(id, [
    [
      1.0 + i * 0.15,
      "status",
      { message: "Received 9 claims", status: "queued", currentAction: "Queued — received 9 claims", progress: 0 },
    ],
  ]);
}

// ── devpost ─────────────────────────────────────────────────────────────────
agent("devpost", [
  [2.0, "tool_call", { message: "fetchPage(devpost profile)", status: "searching", currentAction: "Opening Devpost profile from intake links", url: U.devpostProfile, progress: 6 }],
  [4.5, "tool_result", { message: "Profile fetched", status: "reading", currentAction: "Reading Devpost profile", url: U.devpostProfile, progress: 15, found: "Profile matches Ada Okafor — 7 projects, 4 hackathons" }],
  [7.0, "tool_call", { message: "fetchPage(project)", status: "reading", currentAction: "Reading project page “tinyrag-live”", url: U.devpostProject, progress: 24 }],
  [9.5, "finding", { message: "Winner badge found", progress: 33, url: U.devpostProject, found: "🏆 Winner badge: Grand Prize — Bay Area AI Hackathon 2025" }],
  [11.5, "tool_call", { message: "fetchPage(project gallery)", status: "reading", currentAction: "Checking hackathon size on the project gallery", url: U.devpostGallery, progress: 42 }],
  [14.5, "finding", { message: "Field size counted", progress: 52, url: U.devpostGallery, found: "Field size: 31 teams submitted — a small event" }],
  [17.0, "tool_call", { message: "exaSearch(site:devpost.com judge)", status: "searching", currentAction: "Exa: site:devpost.com “Ada Okafor” judge", progress: 60 }],
  [19.5, "tool_result", { message: "2 results, 1 judging panel match", progress: 66 }],
  [21.0, "tool_call", { message: "fetchPage(judges)", status: "reading", currentAction: "Reading judges panel — Bay Area AI Hackathon 2026", url: U.devpostJudges, progress: 72 }],
  [24.0, "finding", { message: "Judge listing found", progress: 82, url: U.devpostJudges, found: "Listed as a judge — Bay Area AI Hackathon 2026" }],
  [26.5, "tool_call", { message: "fetchPage(project team)", status: "reading", currentAction: "Cross-checking the team list on “tinyrag-live”", url: U.devpostProject, progress: 89 }],
  [29.0, "tool_result", { message: "Team list read", progress: 94, url: U.devpostProject, found: "Credited as 1 of 3 team members" }],
  [32.5, "handoff", { message: "devpost → reconciler: 3 source findings (awards, judging, contributions)", status: "done", currentAction: "Done — 3 source findings sent to reconciler", progress: 100 }],
]);

// ── github ──────────────────────────────────────────────────────────────────
agent("github", [
  [2.4, "tool_call", { message: "githubUser(adaokafor)", status: "searching", currentAction: "GitHub API: GET /users/adaokafor", url: U.ghUser, progress: 8 }],
  [4.2, "tool_result", { message: "User found", status: "reading", url: U.ghUser, progress: 18, found: "@adaokafor — 38 public repos, name matches intake" }],
  [6.0, "tool_call", { message: "list repos by stars", status: "reading", currentAction: "Ranking repositories by stars", url: U.ghRepos, progress: 28 }],
  [8.2, "tool_result", { message: "Top repo identified", progress: 40, url: U.ghRepo, found: "Top repo: adaokafor/tinyrag — ★ 4,218" }],
  [10.5, "tool_call", { message: "githubRepo(adaokafor/tinyrag) contributors", status: "reading", currentAction: "Reading contributor stats for tinyrag", url: U.ghContributors, progress: 52 }],
  [13.0, "finding", { message: "Ownership confirmed", progress: 64, url: U.ghContributors, found: "Owner + top contributor: 61% of 1,284 commits" }],
  [15.0, "tool_call", { message: "dependents", status: "reading", currentAction: "Checking dependents and forks", url: U.ghDependents, progress: 72 }],
  [17.5, "finding", { message: "Adoption measured", progress: 82, url: U.ghDependents, found: "312 dependent repos · 401 forks" }],
  [19.5, "tool_call", { message: "org repos", status: "reading", currentAction: "Checking Lumen Labs org repositories", url: U.ghOrg, progress: 88 }],
  [21.5, "finding", { message: "Org role found", progress: 95, url: U.ghOrg, found: "#2 contributor to lumen-labs/inference-gateway" }],
  [23.5, "handoff", { message: "github → reconciler: 2 source findings (contributions, critical_role)", status: "done", currentAction: "Done — 2 source findings sent to reconciler", progress: 100 }],
]);

// ── scholar (OpenAlex) ──────────────────────────────────────────────────────
agent("scholar", [
  [3.0, "tool_call", { message: "openAlexAuthor(Ada Okafor)", status: "searching", currentAction: "OpenAlex: author search “Ada Okafor”", url: U.oaAuthorSearch, progress: 6 }],
  [5.5, "tool_result", { message: "3 candidates", status: "reading", url: U.oaAuthorSearch, progress: 15, found: "3 candidate authors — 1 matches affiliation Lumen Labs" }],
  [8.0, "tool_call", { message: "openAlexWorks(A5091827364)", status: "reading", currentAction: "Fetching works for A. Okafor", url: U.oaWorksOkafor, progress: 26 }],
  [11.0, "finding", { message: "Works counted", progress: 38, url: U.oaWorksOkafor, found: "4 works as “Ada Okafor” — 4 citations" }],
  [13.5, "tool_call", { message: "openAlexAuthor(Ada Nwosu)", status: "searching", currentAction: "OpenAlex: former name “Ada Nwosu”", url: U.oaAuthorSearchFormer, progress: 46 }],
  [16.5, "tool_result", { message: "Identity match", status: "reading", url: U.oaAuthorSearchFormer, progress: 56, found: "Same person: 2 shared co-authors (identity 0.86)" }],
  [19.0, "tool_call", { message: "openAlexWorks(A5012983746)", status: "reading", currentAction: "Fetching works for A. Nwosu", url: U.oaWorksNwosu, progress: 64 }],
  [22.0, "finding", { message: "More works found", progress: 74, url: U.oaWorksNwosu, found: "2 more works as “Ada Nwosu” — 2 citations" }],
  [25.0, "status", { message: "Comparing counts", status: "reading", currentAction: "Comparing claimed 10 citations with OpenAlex", progress: 82 }],
  [28.0, "finding", { message: "Count mismatch", progress: 90, found: "Total 6 works, 6 citations on OpenAlex (claimed 10)" }],
  [30.5, "status", { message: "Reviewer credits", status: "searching", currentAction: "Looking for peer-reviewer credits (judging)", progress: 94 }],
  [33.5, "tool_result", { message: "No reviewer records", progress: 97, found: "No reviewer credits visible — left to other agents" }],
  [36.5, "handoff", { message: "scholar → reconciler: 1 source finding (scholarly)", status: "done", currentAction: "Done — 1 source finding sent to reconciler", progress: 100 }],
]);

// ── press (Exa) ─────────────────────────────────────────────────────────────
agent("press", [
  [3.5, "tool_call", { message: "exaSearch(Ada Okafor Lumen Labs)", status: "searching", currentAction: "Exa: “Ada Okafor” Lumen Labs", progress: 5 }],
  [6.0, "tool_result", { message: "8 results across 5 news domains", progress: 12 }],
  [8.0, "tool_call", { message: "fetchPage(Bay Tech Review)", status: "reading", currentAction: "Opening Bay Tech Review profile article", url: U.pressProfile, progress: 20 }],
  [11.5, "finding", { message: "Article is about her", progress: 30, url: U.pressProfile, found: "Feature ABOUT her: “The engineer making retrieval cheap”" }],
  [13.5, "tool_call", { message: "fetchPage(SF Business Daily)", status: "reading", currentAction: "Opening SF Business Daily funding story", url: U.pressSeed, progress: 38 }],
  [16.5, "finding", { message: "Company story", progress: 47, url: U.pressSeed, found: "Lumen Labs $8M seed — names her founding engineer" }],
  [19.0, "tool_call", { message: "exaSearch(Thiel Fellowship 2024 Okafor)", status: "searching", currentAction: "Exa: “Thiel Fellowship” 2024 “Okafor”", progress: 54 }],
  [22.0, "tool_call", { message: "fetchPage(Founders Digest)", status: "reading", currentAction: "Opening Founders Digest: 2024 Thiel finalists", url: U.pressThielFinalists, progress: 62 }],
  [25.5, "finding", { message: "Finalist, not Fellow", progress: 70, url: U.pressThielFinalists, found: "⚠ Listed among 2024 Thiel finalists — not Fellows" }],
  [28.0, "tool_call", { message: "fetchPage(thielfellowship.org)", status: "reading", currentAction: "Checking the official Thiel Fellowship roster", url: U.thielOfficial, progress: 76 }],
  [31.5, "tool_result", { message: "Roster checked", progress: 82, url: U.thielOfficial, found: "Not on the official 2024 Fellows list" }],
  [34.0, "tool_call", { message: "exaSearch(Bay Area AI Hackathon 2025 winners)", status: "searching", currentAction: "Exa: “Bay Area AI Hackathon” 2025 winners", progress: 86 }],
  [37.0, "tool_call", { message: "fetchPage(recap)", status: "reading", currentAction: "Opening hackathon recap post", url: U.pressRecap, progress: 90 }],
  [40.0, "finding", { message: "Recap confirms win", progress: 95, url: U.pressRecap, found: "Recap confirms Grand Prize (about 30 teams)" }],
  [43.0, "status", { message: "Filtering press releases", status: "reading", currentAction: "Filtering out press releases and brief mentions", progress: 97 }],
  [46.5, "handoff", { message: "press → reconciler: 5 source findings (press ×2, membership, awards, critical_role)", status: "done", currentAction: "Done — 5 source findings sent to reconciler", progress: 100 }],
]);

// ── linkedin (Apify) ────────────────────────────────────────────────────────
const apifyPolls: [number, EventType, Omit<EventStep, "at" | "kind" | "agentId" | "type">][] = [];
for (let i = 1; i <= 6; i++) {
  const at = 6 + i * 5;
  apifyPolls.push([
    at,
    "message",
    { message: `Apify run RUNNING (${at - 4}s)`, currentAction: `Apify run RUNNING — ${at - 4}s elapsed, polling every 5s`, progress: 8 + i * 8 },
  ]);
}
agent("linkedin", [
  [3.0, "tool_call", { message: "apify: LinkedIn profile scraper", status: "searching", currentAction: "Starting Apify LinkedIn profile scraper", url: U.liProfile, progress: 4 }],
  [4.5, "tool_result", { message: "Cache miss — starting a fresh run", progress: 6, url: U.liProfile, found: "Cache miss for this profile URL — fresh Apify run" }],
  [6.0, "message", { message: "Apify run started", currentAction: "Apify run started — waiting for the scraper", progress: 8 }],
  ...apifyPolls,
  [39.0, "tool_result", { message: "Apify run SUCCEEDED", status: "reading", currentAction: "Apify run succeeded — parsing profile", url: U.liProfile, progress: 62, found: "Profile scraped in 35s: 6 roles · 3 honors · 2 schools" }],
  [41.5, "tool_call", { message: "read experience", status: "reading", currentAction: "Reading the experience section", url: U.liExperience, progress: 68 }],
  [44.0, "finding", { message: "Role confirmed", progress: 76, url: U.liExperience, found: "Founding Engineer, Lumen Labs · Jan 2023 – present" }],
  [46.0, "tool_call", { message: "read honors", status: "reading", currentAction: "Reading honors & awards", url: U.liHonors, progress: 82 }],
  [48.5, "finding", { message: "Honor: Thiel finalist", progress: 87, url: U.liHonors, found: "Honors list “Thiel Fellowship Finalist (2024)”" }],
  [50.5, "finding", { message: "Honor: hackathon", progress: 91, url: U.liHonors, found: "Honors list “Grand Prize, Bay Area AI Hackathon 2025”" }],
  [52.0, "status", { message: "Compensation context", status: "searching", currentAction: "Looking for compensation context (title, level, location)", progress: 94 }],
  [54.0, "tool_result", { message: "No salary data", progress: 97, found: "No public salary data — title and SF location only" }],
  [55.5, "handoff", { message: "linkedin → reconciler: 4 source findings (critical_role, membership, awards, remuneration)", status: "done", currentAction: "Done — 4 source findings sent to reconciler", progress: 100 }],
]);

// ── Reasoning agents (reconciler, questioner) ───────────────────────────────
// Each job is "thinking" for a moment, then the agent goes back to waiting,
// unless another job already started (jobs can overlap).
const jobs: { agentId: AgentId; start: number; end: number; idleAction: string }[] = [];
function job(agentId: AgentId, start: number, end: number, idleAction: string) {
  jobs.push({ agentId, start, end, idleAction });
}
/** Run after all jobs are declared: the event closing a job says whether the agent is idle again. */
function settleJobs() {
  for (const j of jobs) {
    const busy = jobs.some((o) => o !== j && o.agentId === j.agentId && o.start <= j.end && o.end > j.end);
    if (busy) continue;
    const closing = steps.find(
      (s): s is EventStep => s.kind === "event" && s.agentId === j.agentId && s.at === j.end,
    );
    if (closing) Object.assign(closing, { status: "queued", currentAction: j.idleAction });
  }
}

// ── reconciler: findings land in the ledger ─────────────────────────────────
function reconcile(at: number, label: string, f: Omit<FindingStep, "at" | "kind">) {
  agent("reconciler", [
    [at - 0.8, "status", { message: `Reconciling ${label}`, status: "thinking", currentAction: `Reconciling ${label}` }],
    [at + 0.05, "finding", { message: `${label} → ${f.status}`, found: f.foundValue ?? undefined }],
  ]);
  job("reconciler", at - 0.8, at + 0.05, "Waiting for more source findings");
  steps.push({ at, kind: "finding", ...f });
}

reconcile(25.0, "Original contributions", {
  claim: "tinyrag",
  status: "corroborated",
  foundValue: "Owner & top contributor (61% of commits) · ★ 4,218 · 312 dependents",
  identityConfidence: 0.97,
  sources: [
    src(U.ghRepo, "adaokafor/tinyrag", "4,218 stars · 401 forks"),
    src(U.ghContributors, "Contributors · adaokafor/tinyrag", "adaokafor — 783 of 1,284 commits"),
    src(U.ghDependents, "Dependents · adaokafor/tinyrag", "312 repositories depend on tinyrag"),
  ],
  reasoning: "Repo is owned by the applicant's verified GitHub account, she authored most commits, and adoption is visible independently.",
});
reconcile(34.0, "Judging", {
  claim: "judging",
  status: "corroborated",
  foundValue: "Listed on the judges panel, Bay Area AI Hackathon 2026",
  identityConfidence: 0.9,
  sources: [src(U.devpostJudges, "Judges · Bay Area AI Hackathon 2026", "Ada Okafor — Founding Engineer, Lumen Labs")],
  reasoning: "Judges panel lists her by name and current role. Number of projects reviewed is self-reported.",
});
reconcile(38.5, "Scholarly articles", {
  claim: "papers",
  status: "partial",
  foundValue: "6 works, 6 citations on OpenAlex (claimed 10) · 2 works under “Ada Nwosu”",
  identityConfidence: 0.86,
  sources: [
    src(U.oaWorksOkafor, "OpenAlex works · Ada Okafor", "4 works, 4 citations"),
    src(U.oaWorksNwosu, "OpenAlex works · Ada Nwosu", "2 works, 2 citations"),
  ],
  reasoning: "Papers exist and are hers (former name linked via co-authors). Citation count is lower than claimed; Google Scholar often counts more sources than OpenAlex.",
});
reconcile(41.5, "Awards", {
  claim: "hackathon",
  status: "partial",
  foundValue: "Grand Prize confirmed — but only 31 teams entered",
  identityConfidence: 0.95,
  sources: [
    src(U.devpostProject, "tinyrag-live · Devpost", "Winner: Grand Prize"),
    src(U.devpostGallery, "Project gallery · Bay Area AI Hackathon 2025", "31 submissions"),
    src(U.pressRecap, "Bay Area AI Hackathon recap · Bay Tech Review", "…about 30 teams competed…"),
  ],
  reasoning: "The win is real, but a ~30-team hackathon is unlikely to count as a nationally recognized prize on its own.",
});
reconcile(47.5, "Press (Bay Tech Review)", {
  claim: "pressProfile",
  status: "corroborated",
  foundValue: "Feature article about her work (Sep 2025)",
  identityConfidence: 0.96,
  sources: [src(U.pressProfile, "The engineer making retrieval cheap · Bay Tech Review", "Okafor, a founding engineer at Lumen Labs, built…")],
  reasoning: "Independent editorial piece whose main subject is the applicant. Not a press release.",
});
reconcile(48.3, "Press (SF Business Daily)", {
  claim: "pressSeed",
  status: "corroborated",
  foundValue: "Funding story names her as founding engineer and quotes her",
  identityConfidence: 0.94,
  sources: [src(U.pressSeed, "Lumen Labs raises $8M seed · SF Business Daily", "“We cut inference cost by 4×,” said founding engineer Ada Okafor")],
  reasoning: "Article is about the company (as claimed) and quotes her directly.",
});
reconcile(56.5, "Membership", {
  claim: "thiel",
  status: "contradicted",
  foundValue: "Listed as a 2024 finalist, not a Fellow",
  identityConfidence: 0.93,
  sources: [
    src(U.pressThielFinalists, "2024 Thiel Fellowship finalists · Founders Digest", "Finalists include… Ada Okafor (Lumen Labs)"),
    src(U.thielOfficial, "Thiel Fellowship", "2024 Fellows roster — applicant not listed"),
    src(U.liHonors, "Honors · Ada Okafor · LinkedIn", "Thiel Fellowship Finalist (2024)"),
  ],
  reasoning: "Two independent sources plus her own LinkedIn say finalist; the official roster does not list her as a Fellow.",
});
reconcile(57.3, "Critical role", {
  claim: "foundingRole",
  status: "corroborated",
  foundValue: "Founding Engineer at Lumen Labs since Jan 2023; company raised $8M",
  identityConfidence: 0.95,
  sources: [
    src(U.liExperience, "Experience · Ada Okafor · LinkedIn", "Founding Engineer · Lumen Labs · Jan 2023 – Present"),
    src(U.pressSeed, "Lumen Labs raises $8M seed · SF Business Daily", "founding engineer Ada Okafor"),
    src(U.ghOrg, "lumen-labs · GitHub", "adaokafor — #2 contributor to inference-gateway"),
  ],
  reasoning: "Title and dates match across LinkedIn and press; GitHub shows substantive engineering work at the org.",
});
reconcile(58.0, "Remuneration", {
  claim: "salary",
  status: "unverified",
  foundValue: "No public salary data (expected) — needs documents",
  identityConfidence: 0.9,
  sources: [],
  reasoning: "Compensation is rarely public. Not a red flag; request an offer letter or W-2.",
});
agent("reconciler", [[58.6, "status", { message: "All 9 claims reconciled", status: "done", currentAction: "All 9 claims reconciled" }]]);

// ── questioner: discrepancies land in the right panel ───────────────────────
function question(at: number, label: string, d: Omit<DiscrepancyStep, "at" | "kind">) {
  agent("questioner", [
    [at - 0.9, "status", { message: `Writing follow-up for ${label}`, status: "thinking", currentAction: `Writing follow-up for ${label}` }],
    [at + 0.05, "message", { message: `Question ready: ${label} (${d.type})` }],
  ]);
  job("questioner", at - 0.9, at + 0.05, "Waiting for findings that need a follow-up");
  steps.push({ at, kind: "discrepancy", ...d });
}

// ── PART 3: sceptic → investigate → hypothesis resolver ─────────────────────
// The precedent quotes are real (AAO decision FEB142024_01D8101, as quoted by
// the sceptic RAG); the applicant and the measurements are made up.
const PRECEDENT = "FEB142024_01D8101";
const H = { salary: "hyp_salary_1", tinyrag: "hyp_tinyrag_1", papers: "hyp_papers_1", role: "hyp_role_1" } as const;
const OFLC = "https://flag.dol.gov/wage-data/wage-data-downloads";

/** Investigate-mode events for one agent (optionally about one hypothesis). */
function inv(agentId: AgentId, hypothesisId: string | undefined, entries: [number, EventType, Omit<EventStep, "at" | "kind" | "agentId" | "type">][]) {
  for (const [at, type, fields] of entries) steps.push({ at, kind: "event", agentId, type, mode: "investigate", hypothesisId, ...fields });
}

agent("pipeline", [[62.0, "handoff", { message: "Reconciler → sceptic: 8 evidence items (the contradicted Thiel claim is left out)" }]]);
inv("sceptic", undefined, [
  [62.3, "status", { message: "Comparing 8 evidence items with past AAO denials", status: "searching", currentAction: "Finding similar AAO decisions", progress: 5 }],
  [63.5, "tool_result", { message: "Stage 2: ranking 93 cards (2015 onwards)", currentAction: "Ranking 93 AAO decisions by shared criteria", progress: 20 }],
  [65.0, "tool_result", { message: "Stage 3: judging 8 evidence items", currentAction: "Judging 8 evidence items against failing precedent", progress: 45 }],
  [67.0, "message", { message: "Wrote out/queue_demo.json: 4 flagged items (2 applies, 2 unknown)", progress: 65, found: "4 failure modes to investigate" }],
]);
inv("sceptic", H.salary, [[67.6, "finding", { message: `Salary mid-range, not high — precedent ${PRECEDENT}`, found: "High remuneration (applies): salary not at the high end for the occupation and area" }]]);
inv("sceptic", H.tinyrag, [[67.9, "finding", { message: `Promise, not impact already achieved — precedent ${PRECEDENT}`, found: "Original contributions (applies): significance claimed without shown adoption" }]]);
inv("sceptic", H.papers, [[68.2, "finding", { message: `Citation counts given without context — precedent ${PRECEDENT}`, found: "Scholarly articles (unknown): low citations without field context" }]]);
inv("sceptic", H.role, [[68.5, "finding", { message: `Critical role asserted, not shown — precedent ${PRECEDENT}`, found: "Critical role (unknown): role's significance stated only by the applicant" }]]);
inv("sceptic", undefined, [[69.0, "status", { message: "Done: 4 hypotheses", status: "done", progress: 100, currentAction: "Done", found: "4 hypotheses, 4 from the judge" }]]);

agent("pipeline", [[69.4, "handoff", { message: "Sceptic → 7 investigators: 4 hypotheses, 7 checks" }]]);

inv("wages", H.salary, [
  [70.0, "status", { message: "Investigating 1 hypothesis", status: "searching", progress: 5, currentAction: "Comparing salary with the OFLC prevailing wage" }],
  [71.0, "finding", { message: "$210,000 is at or above Level 3 (95% of Level 4). Occupation 15-1252 (Software Developers) chosen because the title contains \"engineer\".", url: OFLC, progress: 90, found: "salary vs benchmark: 210000 (benchmark: OFLC Level 4, Software Developers, San Francisco = 221187)" }],
  [71.4, "status", { message: "Investigation done: 1 of 1 check(s) measured", status: "done", progress: 100, currentAction: "Done investigating", found: "1 of 1 check(s) measured" }],
]);
inv("github", H.tinyrag, [
  [70.2, "status", { message: "Investigating: open-source work without shown adoption", status: "searching", progress: 5, currentAction: "Measuring adoption of adaokafor/tinyrag" }],
  [72.0, "tool_call", { message: "Checking GitHub repo adaokafor/tinyrag", status: "searching", currentAction: "Checking GitHub repo adaokafor/tinyrag", url: U.ghRepo, progress: 25 }],
  [74.5, "tool_result", { message: "githubRepo: The repo adaokafor/tinyrag has 4213 stars. adaokafor owns it and made 612 commits (71% of the total).", url: U.ghRepo, progress: 45, found: "The repo adaokafor/tinyrag has 4213 stars. adaokafor owns it and made 612 commits (71% of the total)." }],
  [76.0, "tool_call", { message: "Counting PyPI downloads of tinyrag", status: "searching", currentAction: "Counting downloads of tinyrag", url: "https://pypistats.org/packages/tinyrag", progress: 60 }],
  [78.0, "tool_result", { message: "pypiDownloads: tinyrag was downloaded 182,400 times in the last month.", url: "https://pypistats.org/packages/tinyrag", progress: 80, found: "tinyrag was downloaded 182,400 times in the last month." }],
  [79.0, "finding", { message: "4,213 stars, 287 forks, 41 contributors; 182,400 PyPI downloads last month.", url: U.ghRepo, progress: 92, found: "repo adoption: 4213 · package downloads: 182400" }],
  [79.4, "status", { message: "Investigation done: 2 of 2 check(s) measured", status: "done", progress: 100, currentAction: "Done investigating", found: "2 of 2 check(s) measured" }],
]);
inv("scholar", H.papers, [
  [70.4, "status", { message: "Investigating: low citations without field context", status: "searching", progress: 5, currentAction: "Measuring citation impact of “Cheap Retrieval”" }],
  [72.5, "tool_call", { message: "Checking citations and field-normalised impact", status: "searching", currentAction: "Checking citations and field-normalised impact of “Cheap Retrieval”", progress: 30 }],
  [75.0, "tool_result", { message: "openAlexWork: 4 citations, 81st percentile for its field and year", progress: 60, found: "\"Cheap Retrieval: Quantized Indexes for Small Models\" (2025) has 4 citations on OpenAlex, 81st percentile for its field and year." }],
  [77.0, "finding", { message: "Raw count is low, but the paper sits at the 81st percentile for its field and year (FWCI 1.9).", progress: 92, found: "paper field normalised impact: 81 (benchmark: citation percentile, same field and year = 50)" }],
  [77.4, "status", { message: "Investigation done: 1 of 1 check(s) measured", status: "done", progress: 100, currentAction: "Done investigating", found: "1 of 1 check(s) measured" }],
]);
inv("press", H.role, [
  [70.6, "status", { message: "Investigating: role's significance stated only by the applicant", status: "searching", progress: 5, currentAction: "Checking the reputation of Lumen Labs" }],
  [72.8, "tool_call", { message: "Searching the web for \"Lumen Labs\" seed funding", status: "searching", currentAction: "Searching the web for \"Lumen Labs\" funding and customers", progress: 25 }],
  [76.0, "tool_call", { message: `Reading ${U.pressSeed}`, status: "reading", currentAction: `Reading ${U.pressSeed}`, url: U.pressSeed, progress: 50 }],
  [80.0, "tool_call", { message: "Searching for independent accounts of the applicant's role", status: "searching", currentAction: "Searching for independent accounts of Ada Okafor's role at Lumen Labs", progress: 70 }],
  [84.0, "finding", { message: "Found the $8M seed article (it names her as a founding engineer in one line); found no account of her role from someone at the company.", url: U.pressSeed, progress: 92, found: "org reputation: $8M seed (2025) · role significance: no independent account found" }],
  [84.6, "status", { message: "Investigation done: 1 of 2 check(s) measured", status: "done", progress: 100, currentAction: "Done investigating", found: "1 of 2 check(s) measured" }],
]);
inv("linkedin", H.role, [
  [70.8, "status", { message: "Investigating: role dates for the critical-role hypothesis", status: "searching", progress: 5, currentAction: "Checking the role's title and dates on LinkedIn" }],
  [74.0, "tool_result", { message: "apifyLinkedIn: cached profile", url: U.liExperience, progress: 60, found: "Founding Engineer, Lumen Labs, Jan 2023 – present (self-reported)" }],
  [76.5, "status", { message: "Investigation done: 1 of 1 check(s) measured", status: "done", progress: 100, currentAction: "Done investigating", found: "1 of 1 check(s) measured" }],
]);
for (const id of ["devpost", "patents"] as const) {
  inv(id, undefined, [[70.1, "status", { message: "Investigating: nothing for this source", status: "done", progress: 100, currentAction: "Investigating: nothing to measure" }]]);
}

agent("pipeline", [[85.2, "handoff", { message: "Investigators → hypothesis resolver: 6 measurement(s)" }]]);
inv("hypothesisResolver", undefined, [
  [85.5, "status", { message: "Weighing 6 measurements for 4 hypotheses", status: "thinking", progress: 10, currentAction: "Deciding cleared / confirmed / still unknown" }],
]);

const W4 = 221187;
function resolved(at: number, step: Omit<HypothesisStep, "at" | "kind">) {
  inv("hypothesisResolver", step.hypothesisId, [
    [at, "finding", { message: step.reasoning, found: `${step.result.replace("_", " ")}${step.queueStatusBefore === "applies" && step.result === "cleared" ? " (rescued)" : ""}: ${step.failureMode}` }],
  ]);
  steps.push({ at: at + 0.05, kind: "hypothesis", ...step });
}
resolved(86.5, {
  claim: "salary",
  hypothesisId: H.salary,
  failureMode: "Salary sits in the middle of the range for the occupation and area, not at the high end",
  precedent: { caseId: PRECEDENT, quote: "The Beneficiary's total compensation of $21 7K falls within the average salary data supplied by the Petitioner rather than at the higher end of the spectrum." },
  checks: [{ checkId: "hyp_salary_1_c1", metric: "salary_vs_benchmark", target: "Founding Engineer | San Francisco, CA | 210000", description: "Compare with the OFLC Level 4 prevailing wage" }],
  clearsIf: "Compensation at or above OFLC Level 4 for the occupation and area",
  confirmsIf: "Compensation below OFLC Level 4 for the occupation and area",
  questionIfUnresolved: "Is any other compensation (bonus, equity refreshers) missing from the $210,000?",
  queueStatusBefore: "applies",
  result: "confirmed",
  measurements: [
    {
      checkId: "hyp_salary_1_c1", agentId: "wages", metric: "salary_vs_benchmark", value: 210000,
      benchmark: { description: "OFLC Level 4 prevailing wage, Software Developers, San Francisco-Oakland-Fremont, CA (July 2026 - June 2027)", value: W4 },
      identityConfidence: 1,
      sources: [{ url: OFLC, title: "DOL OFLC prevailing wages July 2026 - June 2027", excerpt: "Software Developers (15-1252), San Francisco-Oakland-Fremont, CA: Level 1 $137,093, Level 2 $165,131, Level 3 $193,149, Level 4 $221,187 per year." }],
      note: "$210,000 is at or above Level 3 (95% of Level 4).",
    },
  ],
  reasoning: "$210,000 is below the $221,187 OFLC Level 4 wage for software developers in San Francisco (95% of Level 4), the benchmark the AAO used.",
  sharpenedQuestion: null,
});
resolved(87.5, {
  claim: "tinyrag",
  hypothesisId: H.tinyrag,
  failureMode: "Work described as significant for its promise, without evidence of impact already achieved",
  precedent: { caseId: PRECEDENT, quote: "While the letters show promise in the Beneficiary's work, they do not establish how his work already qualifies as a contribution ofmajor significance in the field; rather than prospective, potential impacts." },
  checks: [
    { checkId: "hyp_tinyrag_1_c1", metric: "repo_adoption", target: "adaokafor/tinyrag", description: "Stars, forks and contributors" },
    { checkId: "hyp_tinyrag_1_c2", metric: "package_downloads", target: "tinyrag", description: "Monthly PyPI downloads" },
  ],
  clearsIf: "1,000+ stars from many contributors, or 10,000+ monthly downloads",
  confirmsIf: "Under 50 stars and under 500 monthly downloads two or more years after release",
  questionIfUnresolved: "Which companies use tinyrag in production?",
  queueStatusBefore: "applies",
  result: "cleared",
  measurements: [
    { checkId: "hyp_tinyrag_1_c1", agentId: "github", metric: "repo_adoption", value: 4213, benchmark: null, identityConfidence: 0.95, sources: [{ url: U.ghRepo, title: "adaokafor/tinyrag", excerpt: "4.2k stars · 287 forks · 41 contributors" }], note: "Owner and top contributor (71% of commits)." },
    { checkId: "hyp_tinyrag_1_c2", agentId: "github", metric: "package_downloads", value: 182400, benchmark: null, identityConfidence: 0.9, sources: [{ url: "https://pypistats.org/packages/tinyrag", title: "tinyrag on PyPI Stats", excerpt: "Last month: 182,400" }], note: "PyPI package published from the same repository." },
  ],
  reasoning: "4,213 stars from 41 contributors and 182,400 PyPI downloads last month show adoption well beyond the applicant: the sceptic's flag is rescued.",
  sharpenedQuestion: null,
});
resolved(88.5, {
  claim: "papers",
  hypothesisId: H.papers,
  failureMode: "Citation counts given without context for the field",
  precedent: { caseId: PRECEDENT, quote: "The Petitioner did not articulate the significance or relevance of the citation data." },
  checks: [{ checkId: "hyp_papers_1_c1", metric: "paper_field_normalised_impact", target: "Cheap Retrieval: Quantized Indexes for Small Models", description: "OpenAlex citation percentile for the field and year" }],
  clearsIf: "At or above the 75th citation percentile for its field and year",
  confirmsIf: "Below the 25th citation percentile for its field and year, 2+ years after publication",
  questionIfUnresolved: "Have other researchers built on these papers?",
  queueStatusBefore: "unknown",
  result: "cleared",
  measurements: [
    { checkId: "hyp_papers_1_c1", agentId: "scholar", metric: "paper_field_normalised_impact", value: 81, benchmark: { description: "citation percentile, same field and year (median)", value: 50 }, identityConfidence: 0.85, sources: [{ url: U.oaWorksOkafor, title: "OpenAlex works for Ada Okafor", excerpt: "cited_by_count 4 · citation_normalized_percentile 0.81" }], note: "FWCI 1.9." },
  ],
  reasoning: "Only 4 citations, but OpenAlex puts the paper at the 81st percentile for its field and year, so the low raw count is in context.",
  sharpenedQuestion: null,
});
resolved(89.5, {
  claim: "foundingRole",
  hypothesisId: H.role,
  failureMode: "The critical role is stated by the applicant, not shown by someone with personal knowledge of it",
  precedent: { caseId: PRECEDENT, quote: "Here, the Petitioner did not provide a detailed letter\nfrom a person with personal knowledge of the significance of the Beneficiary's role; rather the record\ncontains an RFE response letter from counsel." },
  checks: [
    { checkId: "hyp_role_1_c1", metric: "org_reputation", target: "Lumen Labs", description: "Funding, customers, major press" },
    { checkId: "hyp_role_1_c2", metric: "other", target: "Ada Okafor, Lumen Labs", description: "An independent account of what the applicant's role achieved" },
  ],
  clearsIf: "An independent source, or someone at the company, describes the role's specific impact",
  confirmsIf: "Every account of the role comes from the applicant",
  questionIfUnresolved: "Can someone at Lumen Labs describe your role's impact in a letter?",
  queueStatusBefore: "unknown",
  result: "still_unknown",
  measurements: [
    { checkId: "hyp_role_1_c1", agentId: "press", metric: "org_reputation", value: "$8M seed round (2025)", benchmark: null, identityConfidence: 0.9, sources: [{ url: U.pressSeed, title: "Lumen Labs raises $8M seed", excerpt: "Lumen Labs, the retrieval-infrastructure startup, raised an $8M seed round…" }], note: "Names her as a founding engineer in one line." },
    { checkId: "hyp_role_1_c2", agentId: "press", metric: "other", value: null, benchmark: null, identityConfidence: 0.9, sources: [], note: "Searched news and company pages; no account of her role from someone else." },
  ],
  reasoning: "The $8M seed shows the company has some standing, but no source other than the applicant describes what her role achieved.",
  sharpenedQuestion: "We found Lumen Labs' $8M seed round but no account of your role from anyone else there. Could your CEO or a co-founder describe, in a letter, what your work changed for the company?",
});
inv("hypothesisResolver", undefined, [
  [90.0, "status", { message: "Done: 2 cleared (1 rescued), 1 confirmed, 1 still unknown", status: "done", progress: 100, currentAction: "Done", found: "2 cleared (1 rescued), 1 confirmed, 1 still unknown" }],
]);

// ── questioner: ONE merged list (discrepancies + open failure modes), top 4 ──
agent("pipeline", [[90.4, "handoff", { message: "Reconciler + hypothesis resolver → questioner: 4 finding(s) and 1 hypothesis need follow-up" }]]);
question(91.5, "Critical role (failure mode)", {
  claim: "foundingRole",
  hypothesisId: H.role,
  type: "failure_mode",
  description: `The critical role is stated by the applicant, not shown by someone with personal knowledge of it (as in AAO decision ${PRECEDENT}). The $8M seed shows the company has some standing, but no source other than the applicant describes what her role achieved.`,
  question: "We found Lumen Labs' $8M seed round but no account of your role from anyone else there. Could your CEO or a co-founder describe, in a letter, what your work changed for the company?",
  requestedDocument: null,
});
question(92.5, "Scholarly articles", {
  claim: "papers",
  type: "numerical",
  description: "Claimed 10 citations (Google Scholar); OpenAlex shows 6 across 6 works — 2 of them under the former name “Ada Nwosu”.",
  question: "We found 6 citations on OpenAlex, including two papers under the name Ada Nwosu — could you share your Google Scholar profile so we can confirm the full count?",
  requestedDocument: "Google Scholar profile link",
});
question(93.5, "Membership", {
  claim: "thiel",
  type: "evidence",
  description: "Claimed Thiel Fellow (2024); two sources and her LinkedIn list her as a 2024 finalist, and she is not on the official Fellows roster.",
  question: "We found you listed as a 2024 Thiel Fellowship finalist rather than a Fellow — which best describes your status?",
  requestedDocument: "Fellowship acceptance letter, if you were admitted as a Fellow",
});
question(94.5, "Awards", {
  claim: "hackathon",
  type: "criterion_fit",
  description: "The Grand Prize is real, but the event had about 31 teams — likely too small to count as a nationally recognized award on its own.",
  question: "We confirmed your Grand Prize; was the prize covered by press or judged by recognized experts outside the event?",
  requestedDocument: "Press coverage or judging-panel page for the prize",
});
agent("questioner", [
  [95.3, "status", { message: "Done: 4 question(s); 1 kept as notes (remuneration)", status: "done", currentAction: "4 follow-up questions ready", found: "4 question(s); 1 kept as notes" }],
]);

settleJobs();

agent("pipeline", [
  [96.5, "status", { message: "Vetting complete: 9 findings, 4 failure modes investigated, 4 open questions", status: "done" }],
]);

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const COLORS: Partial<Record<AgentId, string>> = {
  devpost: "\x1b[36m",
  linkedin: "\x1b[34m",
  github: "\x1b[37m",
  scholar: "\x1b[33m",
  press: "\x1b[35m",
  reconciler: "\x1b[32m",
  questioner: "\x1b[31m",
  sceptic: "\x1b[91m",
  patents: "\x1b[93m",
  wages: "\x1b[92m",
  hypothesisResolver: "\x1b[96m",
};

async function reset() {
  const claimRows = await db.select({ id: claims.id }).from(claims).where(eq(claims.applicantId, APPLICANT_ID));
  const ids = claimRows.map((c) => c.id);
  const caseRows = await db.select({ id: cases.id }).from(cases).where(eq(cases.applicantId, APPLICANT_ID));
  // Explicit order instead of relying on ON DELETE CASCADE (SQLite only enforces it with PRAGMA foreign_keys=ON).
  await db.delete(events).where(eq(events.applicantId, APPLICANT_ID));
  if (caseRows.length) await db.delete(scores).where(inArray(scores.caseId, caseRows.map((c) => c.id)));
  await db.delete(cases).where(eq(cases.applicantId, APPLICANT_ID));
  await db.delete(hypotheses).where(eq(hypotheses.applicantId, APPLICANT_ID));
  if (ids.length) {
    await db.delete(discrepancies).where(inArray(discrepancies.claimId, ids));
    await db.delete(findings).where(inArray(findings.claimId, ids));
  }
  await db.delete(claims).where(eq(claims.applicantId, APPLICANT_ID));
  await db.delete(applicants).where(eq(applicants.id, APPLICANT_ID));
}

async function seed() {
  await db.insert(applicants).values({
    id: APPLICANT_ID,
    ...applicant,
    phone: applicant.phone ?? null,
    cvText: null,
    additionalInfo: null,
  });
  await db.insert(claims).values(
    (Object.keys(CLAIMS) as ClaimKey[]).map((key) => {
      const c = CLAIMS[key];
      const payload = CRITERION_ENTRY_SCHEMAS[c.criterion].parse(c.payload) as ClaimPayload;
      return { id: claimIds[key], applicantId: APPLICANT_ID, criterion: c.criterion, summary: c.summary, payload };
    }),
  );
}

async function run(step: Step) {
  if (step.kind === "event") {
    const { agentId, type, message, status, currentAction, progress, url, found, hypothesisId } = step;
    const isVerifier = (SOURCE_AGENT_IDS as readonly string[]).includes(agentId) || agentId === "reconciler";
    await logEvent({
      applicantId: APPLICANT_ID,
      agentId,
      type,
      message,
      status,
      currentAction,
      progress,
      url,
      found,
      mode: step.mode ?? (isVerifier ? "verify" : null),
      hypothesisId: hypothesisId ?? null,
    });
    const color = COLORS[agentId] ?? "\x1b[90m";
    const detail = found ? `✓ ${found}` : (currentAction ?? message);
    console.log(
      `${color}${`T+${step.at.toFixed(1)}s`.padEnd(8)} ${agentId.padEnd(10)}\x1b[0m ${(status ?? "").padEnd(9)} ${type.padEnd(11)}  ${detail}`,
    );
  } else if (step.kind === "finding") {
    const { claim, status, foundValue, identityConfidence, sources, reasoning } = step;
    const finding = FindingSchema.parse({
      claimId: claimIds[claim],
      status,
      foundValue,
      identityConfidence,
      sources,
      reasoning,
    });
    await db.insert(findings).values(finding);
  } else if (step.kind === "hypothesis") {
    const { claim, hypothesisId, queueStatusBefore, result, reasoning, sharpenedQuestion } = step;
    const criterion = CLAIMS[claim].criterion;
    const hypothesis = HypothesisSchema.parse({
      hypothesisId,
      evidenceId: claimIds[claim],
      claimId: claimIds[claim],
      criterion,
      failureMode: step.failureMode,
      precedent: step.precedent,
      checks: step.checks,
      clearsIf: step.clearsIf,
      confirmsIf: step.confirmsIf,
      questionIfUnresolved: step.questionIfUnresolved,
    });
    const measurements = step.measurements.map((m) => MeasurementSchema.parse({ ...m, hypothesisId }));
    const queueStatusAfter: QueueStatus = result === "cleared" ? "does_not_apply" : result === "confirmed" ? "applies" : queueStatusBefore;
    await db.insert(hypotheses).values({
      applicantId: APPLICANT_ID,
      hypothesisId,
      claimId: claimIds[claim],
      criterion,
      failureMode: hypothesis.failureMode,
      hypothesis,
      queueStatusBefore,
      origin: "sceptic",
      result,
      queueStatusAfter,
      measurements,
      reliedOn: measurements.flatMap((m, i) => (m.value !== null && m.sources.length ? [i] : [])),
      reasoning,
      sharpenedQuestion,
    });
  } else {
    const { claim, type, description, question, requestedDocument, hypothesisId } = step;
    const discrepancy = QuestionerOutputSchema.parse({
      claimId: claimIds[claim],
      type,
      description,
      question,
      requestedDocument,
    });
    await db.insert(discrepancies).values({ ...discrepancy, resolution: "open", hypothesisId: hypothesisId ?? null });
  }
}

async function main() {
  // WAL lets the dashboard read while this script writes; busy_timeout rides out brief locks.
  await db.run(sql`PRAGMA journal_mode = WAL`);
  await db.run(sql`PRAGMA busy_timeout = 5000`);

  await reset();
  await seed();

  const url = `http://localhost:${args.port}/case/${encodeURIComponent(APPLICANT_ID)}`;
  const total = Math.max(...steps.map((s) => s.at)) / SPEED;
  console.log(`\nMock run for "${applicant.name}" → ${url}`);
  console.log(`${steps.length} steps over ~${total.toFixed(0)}s (speed ${SPEED}x). Ctrl+C to stop.\n`);

  // Stable sort keeps same-timestamp steps in the order they were declared.
  const ordered = steps.map((s, i) => ({ s, i })).sort((a, b) => a.s.at - b.s.at || a.i - b.i);
  const start = Date.now();
  for (const { s } of ordered) {
    const wait = start + (s.at * 1000) / SPEED - Date.now();
    if (wait > 0) await sleep(wait);
    await run(s);
  }
  console.log(`\nDone in ${((Date.now() - start) / 1000).toFixed(1)}s. Dashboard: ${url}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
