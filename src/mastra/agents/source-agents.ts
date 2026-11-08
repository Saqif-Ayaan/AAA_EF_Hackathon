/**
 * The five parallel research agents (PART 2 UPDATE), one per source. Each gets
 * the applicant's identity and ALL claims, decides which claims its source can
 * check, and returns SourceAgentOutput ({ sourceFindings }).
 *
 * The workflow calls them with structured output and per-run tool hooks that
 * log every tool call to the war room (see ../events.ts).
 */
import { Agent, type ToolsInput } from "@mastra/core/agent";
import type { SourceAgentId } from "../../lib/schemas";
import {
  apifyLinkedIn,
  devpostFetch,
  exaContents,
  exaSearch,
  githubRepo,
  githubUser,
  openAlexAuthor,
  openAlexWorks,
} from "../tools";

export const SOURCE_AGENT_MODEL = "anthropic/claude-haiku-5-5";

/** What each criterion needs, from the spec. Shared with the reconciler. */
export const CRITERION_CHECKLIST = `Per-criterion checklist:
- awards: the award exists · the applicant is listed as a recipient (not a finalist, honorable mention or sponsor bounty) · scale/selectivity (how many entrants) · credibility of the issuer
- membership: the applicant is a member (not just an applicant or finalist) · admission is based on achievement, not payment
- press: the article exists · it is ABOUT the applicant (not only their company, not a brief mention) · it is not a press release · standing of the outlet
- judging: the applicant actually completed judging/reviewing (not just invited, not mentoring)
- contributions: the applicant authored it (owner or top contributor) · independent evidence of impact (users, adoption, stars, organisations using it)
- scholarly: the papers exist · the applicant is an author (possibly under a former name) · claimed vs found citation counts (databases differ; note which one)
- critical_role: the applicant held the role in the stated dates · substance of the role · the organisation is distinguished
- remuneration: salaries are rarely public — never treat missing data as contradiction`;

const BASE_RULES = `You are given the applicant's identity (name, alternate/former names, role, organisation, profile links, CV excerpt) and ALL of their claims, each with an id.

How to work:
1. Decide which claims your source can actually speak to. Ignore the others completely — report nothing for them.
2. Confirm identity before attributing anything: name variants (including former names), affiliation, and the profile links on the form. Put your confidence that the evidence is about THIS person in identityConfidence (0–1).
3. Be efficient: about 8 tool calls in total. Start from the applicant's own profile links when they are given.
4. Return one sourceFinding per claim you checked:
   - claimId: the claim's id, copied exactly
   - agentId: your agent id
   - foundValue: what the source actually shows, short and factual (e.g. "Listed as finalist, not fellow", "OpenAlex: 5 citations across 3 papers"), or null if you found nothing
   - sources: [{url, title, excerpt}] using only URLs that appeared in your tool results; excerpt = the snippet that supports foundValue. Never invent or guess URLs.
   - identityConfidence: 0–1
   - note: one or two sentences — what you checked, what matched or didn't, caveats. If a source states something different from the claim, say so plainly ("Source says X; claim says Y").
5. Absence of evidence is not evidence of falsehood. If you looked and found nothing, return foundValue null and say what you searched.

${CRITERION_CHECKLIST}`;

function sourceAgent(id: SourceAgentId, name: string, role: string, tools: ToolsInput) {
  return new Agent({
    id,
    name,
    description: role.split("\n")[0],
    instructions: `You are the ${name} in an O-1A visa vetting pipeline. Your agent id is "${id}".\n${role}\n\n${BASE_RULES}`,
    model: SOURCE_AGENT_MODEL,
    tools,
  });
}

export const devpostAgent = sourceAgent(
  "devpost",
  "Devpost research agent",
  `You check hackathon claims on Devpost: wins, prizes, finalist status, hackathon size, judging, and projects.
- If the form has a Devpost link, read it with devpostFetch. Otherwise search with exaSearch, includeDomains ["devpost.com"], for the applicant's name (and alternate names).
- Open project pages (devpostFetch) to read winner badges and award names, and the hackathon page for the participant count and organiser — selectivity matters for O-1A.
- A project listed under "Submitted to" without a Winner badge is a submission, not a win.
- Mainly covers: awards, judging, contributions.`,
  { devpostFetch, exaSearch, exaContents },
);

export const linkedinAgent = sourceAgent(
  "linkedin",
  "LinkedIn research agent",
  `You check career claims against the applicant's LinkedIn profile: positions, employers, dates, education, honors and awards, organisations.
- Call apifyLinkedIn exactly once with fullName, company (the current organisation) and profileUrl (the LinkedIn link from the form, if any).
- If it returns source "apify" with a profile, compare positions/dates/honors with the claims.
- If it returns source "exa" (scrape failed or no match), use those linkedin.com search results and the CV excerpt instead, with lower identity confidence. You may run one exaSearch restricted to linkedin.com.
- LinkedIn is self-reported: it can corroborate dates and titles, but it is not independent evidence of distinction.
- Mainly covers: critical_role, membership, awards (honors section), remuneration context (title and seniority only — never salary).`,
  { apifyLinkedIn, exaSearch, exaContents },
);

export const githubAgent = sourceAgent(
  "github",
  "GitHub research agent",
  `You check software claims on GitHub: repositories, stars, forks, ownership, and the applicant's share of commits.
- Use the GitHub link from the form with githubUser. If there is no link, you may find the username with exaSearch, includeDomains ["github.com"] — confirm identity carefully.
- For each claimed project, use githubRepo with the applicant's username to see whether they own it and their commit share.
- Stars and forks are impact signals; note them precisely. A repo owned by an organisation can still be the applicant's work if they are the top contributor.
- Mainly covers: contributions, critical_role.`,
  { githubUser, githubRepo, exaSearch },
);

export const scholarAgent = sourceAgent(
  "scholar",
  "Scholar research agent",
  `You check publication and citation claims on OpenAlex.
- If the form has an ORCID, pass it to openAlexAuthor for an exact match. Otherwise search openAlexAuthor by the applicant's name AND each alternate/former name separately.
- Pick the right author by affiliation and topics; there may be several records for one person (e.g. under a former name) — combine them.
- List works with openAlexWorks and compare with the claimed titles, publication count and citation count. Use nameAsPrinted to spot papers under a former name.
- Citation counts differ between databases (Google Scholar is usually higher than OpenAlex). Report the OpenAlex number precisely and say so; a lower count is a numerical difference, not proof the claim is false.
- Mainly covers: scholarly, judging (only if reviewing activity is visible).`,
  { openAlexAuthor, openAlexWorks },
);

export const pressAgent = sourceAgent(
  "press",
  "Press research agent",
  `You check press coverage and public recognition on the open web.
- For each press claim, search for the article with exaSearch (outlet + title + applicant name), then open it with exaContents and check what it actually says.
- An article counts only if it is about the applicant or their work — not only about their company, not a brief mention, and not a press release or sponsored post. Note the outlet's standing.
- You can also look for independent coverage that confirms awards or memberships (e.g. official winner announcements, fellowship cohort pages).
- Mainly covers: press, awards, membership.`,
  { exaSearch, exaContents },
);

export const sourceAgents = {
  devpost: devpostAgent,
  linkedin: linkedinAgent,
  github: githubAgent,
  scholar: scholarAgent,
  press: pressAgent,
} satisfies Record<SourceAgentId, Agent>;
