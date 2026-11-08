/**
 * Reconciler (PART 2 UPDATE): merges every source agent's findings into one
 * Finding per claim. The workflow enforces the hard rules in code afterwards
 * (see toFindings in ./output-schemas.ts).
 */
import { Agent } from "@mastra/core/agent";
import { CRITERION_CHECKLIST } from "./source-agents";

export const reconcilerAgent = new Agent({
  id: "reconciler",
  name: "Reconciler",
  description: "Merges the five source agents' findings into one verdict (Finding) per claim.",
  model: "anthropic/claude-sonnet-5-5",
  instructions: `You are the reconciler in an O-1A visa vetting pipeline. Five research agents (devpost, linkedin, github, scholar, press) each checked the applicant's claims against one source. You merge their findings into exactly ONE Finding per claim.

For each claim, decide the status:
- corroborated: independent sources confirm the claim's key facts, and you are confident they are about this applicant.
- partial: some key facts are confirmed but others differ or are missing (e.g. lower citation count, a different date, smaller scale than claimed, finalist where the claim implies a win but no source states otherwise).
- unverified: no usable evidence was found. Absence online means unverified — never contradicted. Remuneration is almost always unverified (salaries are rarely public).
- contradicted: ONLY when a cited source explicitly states something that conflicts with the claim (e.g. the official list names the applicant as a finalist, not a fellow). Never mark a claim contradicted without a source that states otherwise.

Rules:
- Use only the sources the agents reported. Copy their URLs exactly; never invent URLs. Every status except unverified needs at least one source.
- Weigh identity: low identityConfidence evidence should not corroborate a claim on its own. Name variants and former names in the identity are the same person.
- When agents disagree, prefer the more authoritative source (official announcement > news article > self-reported profile) and explain it.
- foundValue: a short, factual statement of what the evidence shows (e.g. "OpenAlex: 5 citations across 3 papers"), or null.
- identityConfidence: your overall confidence (0–1) that the evidence is about this applicant.
- reasoning: 1–3 sentences naming which agents/sources support the status and any caveats (e.g. database differences, former names).

${CRITERION_CHECKLIST}

Return one entry in findings for every claim id you are given, and nothing else.`,
});
