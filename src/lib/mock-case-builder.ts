/**
 * STUB case builder + scorer, used by POST /api/cases/[id]/build until the
 * real Mastra `caseBuilder` (Opus) and the teammate's scoring agent are wired
 * in. Deterministic and template-based — no LLM — but it follows the spec's
 * rules: only corroborated (or applicant-substantiated) evidence is argued,
 * the strongest 3–5 criteria are picked, everything else is listed with a
 * reason, and nothing is invented beyond what the findings say.
 *
 * Output is validated against CaseSchema / ScoreInputSchema, so the UI is
 * built against the real handoff contract.
 */
import {
  CRITERIA,
  CaseSchema,
  ScoreInputSchema,
  type Case,
  type Criterion,
  type Discrepancy,
  type FindingRecord,
  type ScoreInput,
} from "./schemas";
import type { WarRoomApplicant, WarRoomClaim } from "./war-room";

const LABEL: Record<Criterion, string> = {
  awards: "Awards",
  membership: "Membership",
  press: "Published material (press)",
  judging: "Judging",
  contributions: "Original contributions",
  scholarly: "Scholarly articles",
  critical_role: "Critical role",
  remuneration: "High remuneration",
};

const LEAD: Record<Criterion, string> = {
  awards: "The applicant has received nationally or internationally recognized prizes for excellence in the field:",
  membership: "The applicant is a member of associations that require outstanding achievement, judged by recognized experts:",
  press: "Published material in professional or major media is about the applicant and the applicant's work:",
  judging: "The applicant has participated as a judge of the work of others in the field:",
  contributions: "The applicant has made original contributions of major significance to the field:",
  scholarly: "The applicant has authored scholarly articles in professional journals or other major media:",
  critical_role:
    "The applicant has been employed in a critical or essential capacity for an organization with a distinguished reputation:",
  remuneration: "The applicant commands a high salary in relation to others in the field:",
};

const CAVEAT: Record<Criterion, string> = {
  awards: "Show the award's national recognition: selection criteria, field size and press coverage.",
  membership: "Document that admission was decided by recognized experts on outstanding achievement.",
  press: "Lead with coverage about the applicant personally; company-focused pieces are supporting evidence.",
  judging: "One judging engagement is thin on its own — add the invitation and any other review work.",
  contributions: "Show significance beyond usage metrics with letters from organisations that depend on the work.",
  scholarly: "Citation counts differ by database; cite the source and date for every figure.",
  critical_role: "Show the organisation's distinguished reputation (investors, press, rankings), not just the title.",
  remuneration: "Needs an offer letter or W-2 plus a public salary benchmark for the role and location.",
};

const LETTER_WRITER: Record<Criterion, { role: string; reason: string }> = {
  awards: { role: "Member of the award's judging panel", reason: "Can explain the selection criteria and how competitive it was." },
  membership: { role: "Association officer involved in admissions", reason: "Can confirm admission was based on achievement." },
  press: { role: "Senior practitioner who knows the covered work", reason: "Can put the coverage in the context of the field." },
  judging: { role: "Organiser who selected the applicant as a judge", reason: "Confirms the invitation was based on expertise." },
  contributions: {
    role: "Engineering lead at an organisation that relies on the applicant's work",
    reason: "Independent view of the contribution's significance from outside the employer.",
  },
  scholarly: { role: "Researcher who has cited the applicant's papers", reason: "Independent view of the work's academic impact." },
  critical_role: {
    role: "Co-founder or lead investor at the applicant's company",
    reason: "Can attest to the applicant's essential role and the company's standing.",
  },
  remuneration: { role: "HR or finance lead at the employer", reason: "Confirms compensation relative to peers." },
};

const STRENGTH_RANK = { strong: 0, moderate: 1, weak: 2 } as const;

export type CaseInput = {
  applicant: WarRoomApplicant;
  claims: WarRoomClaim[];
  /** All findings for the claims, oldest first; the latest per claim wins. */
  findings: FindingRecord[];
  discrepancies: Discrepancy[];
};

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

export function buildMockCase({ applicant, claims, findings, discrepancies }: CaseInput): {
  caseJson: Case;
  markdown: string;
} {
  const latest = new Map(findings.map((f) => [f.claimId, f]));
  const substantiated = new Set(discrepancies.filter((d) => d.resolution === "substantiated").map((d) => d.claimId));
  const openByClaim = new Set(discrepancies.filter((d) => d.resolution === "open").map((d) => d.claimId));

  const argued: Case["criteriaArgued"] = [];
  const notArgued: Case["criteriaNotArgued"] = [];

  for (const criterion of CRITERIA) {
    const rows = claims
      .filter((c) => c.criterion === criterion)
      .map((claim) => ({ claim, finding: latest.get(claim.id), substantiated: substantiated.has(claim.id) }));
    const usable = rows.filter((r) => r.finding?.status === "corroborated" || r.substantiated);

    if (usable.length === 0) {
      const r = rows[0];
      const open = rows.some((x) => openByClaim.has(x.claim.id)) ? " A follow-up question is open." : "";
      const found = r?.finding?.foundValue ? ` — ${lowerFirst(r.finding.foundValue)}` : "";
      const reason = !r
        ? "Not claimed in the intake."
        : r.finding?.status === "contradicted"
          ? `Contradicted by sources${found}.`
          : r.finding?.status === "partial"
            ? `Only partially verified${found}.`
            : r.finding?.status === "unverified"
              ? `No public evidence yet${found}.`
              : "Not yet verified.";
      notArgued.push({ criterion, reason: reason + open });
      continue;
    }

    const rich = usable.some(
      (r) => (r.finding?.sources.length ?? 0) >= 3 && (r.finding?.identityConfidence ?? 0) >= 0.95,
    );
    const strength = usable.length >= 2 || rich ? "strong" : "moderate";

    const seen = new Set<string>();
    const exhibits = usable.flatMap((r) =>
      (r.finding?.sources ?? [])
        .filter((s) => !seen.has(s.url) && seen.add(s.url))
        .map((s) => ({
          label: s.title,
          url: s.url,
          status: r.finding?.status === "corroborated" ? ("corroborated" as const) : ("substantiated" as const),
        })),
    );

    const points = usable
      .map((r) => `${r.claim.summary}${r.finding?.foundValue ? ` (verified: ${r.finding.foundValue})` : ""}`)
      .join("; ");

    const weaknesses = [
      ...rows
        .filter((r) => !usable.includes(r))
        .map((r) => `“${r.claim.summary}” is left out — ${r.finding?.status ?? "not yet verified"}.`),
      CAVEAT[criterion],
    ];

    argued.push({
      criterion,
      strength,
      argument: `${LEAD[criterion]} ${points}. Each point is backed by an independently sourced exhibit.`,
      exhibits,
      weaknesses,
    });
  }

  argued.sort((a, b) => STRENGTH_RANK[a.strength] - STRENGTH_RANK[b.strength] || b.exhibits.length - a.exhibits.length);
  const chosen = argued.slice(0, 5);
  for (const extra of argued.slice(5)) {
    notArgued.push({ criterion: extra.criterion, reason: "Supported, but weaker than the five criteria argued." });
  }
  notArgued.sort((a, b) => CRITERIA.indexOf(a.criterion) - CRITERIA.indexOf(b.criterion));

  const unresolvedIssues = discrepancies
    .filter((d) => d.resolution === "open")
    .map((d) => {
      const claim = claims.find((c) => c.id === d.claimId);
      return `${claim ? `${LABEL[claim.criterion]}: ` : ""}${d.description}`;
    });
  if (chosen.length < 3) {
    unresolvedIssues.unshift(`Only ${plural(chosen.length, "criterion", "criteria")} supported — O-1A needs at least 3.`);
  }

  const statuses = claims.map((c) => latest.get(c.id)?.status);
  const exhibitCount = chosen.reduce((n, c) => n + c.exhibits.length, 0);
  const open = discrepancies.filter((d) => d.resolution === "open").length;

  const summary = [
    `${applicant.name} works in ${lowerFirst(applicant.field)} as ${applicant.currentRole} at ${applicant.currentOrganization}.`,
    chosen.length
      ? `This case argues ${chosen.length} of the 8 O-1A criteria — ${chosen.map((c) => LABEL[c.criterion]).join(", ")} — using only evidence corroborated online, with ${plural(exhibitCount, "cited exhibit")}.`
      : "No criterion is supported by corroborated evidence yet.",
    chosen.length ? `The strongest criterion is ${LABEL[chosen[0].criterion].toLowerCase()}.` : "",
    open
      ? `${plural(open, "follow-up question")} ${open === 1 ? "is" : "are"} still open; those claims stay out of the argument until resolved.`
      : "All follow-up questions are resolved.",
  ]
    .filter(Boolean)
    .join(" ");

  const caseJson = CaseSchema.parse({
    applicantId: applicant.id,
    summary,
    criteriaArgued: chosen,
    criteriaNotArgued: notArgued,
    unresolvedIssues,
    suggestedLetterWriters: chosen.slice(0, 4).map((c) => LETTER_WRITER[c.criterion]),
    evidenceStats: {
      totalClaims: claims.length,
      corroborated: statuses.filter((s) => s === "corroborated").length,
      substantiated: substantiated.size,
      unverified: statuses.filter((s) => s === "unverified").length,
      contradicted: statuses.filter((s) => s === "contradicted").length,
    },
  });

  return { caseJson, markdown: caseMarkdown(applicant.name, caseJson) };
}

export function caseMarkdown(name: string, c: Case): string {
  const lines = [`# O-1A case dossier — ${name}`, "", c.summary, "", "## Criteria argued", ""];
  for (const a of c.criteriaArgued) {
    lines.push(`### ${LABEL[a.criterion]} — ${a.strength}`, "", a.argument, "", "**Exhibits**", "");
    a.exhibits.forEach((e, i) => lines.push(`${i + 1}. [${e.label}](${e.url}) — ${e.status}`));
    lines.push("", "**Weaknesses**", "", ...a.weaknesses.map((w) => `- ${w}`), "");
  }
  lines.push("## Not argued", "", ...c.criteriaNotArgued.map((n) => `- **${LABEL[n.criterion]}:** ${n.reason}`), "");
  if (c.unresolvedIssues.length) lines.push("## Unresolved issues", "", ...c.unresolvedIssues.map((u) => `- ${u}`), "");
  lines.push("## Suggested letter writers", "", ...c.suggestedLetterWriters.map((l) => `- **${l.role}** — ${l.reason}`), "");
  const s = c.evidenceStats;
  lines.push(
    "## Evidence",
    "",
    `${s.totalClaims} claims · ${s.corroborated} corroborated · ${s.substantiated} substantiated · ${s.unverified} unverified · ${s.contradicted} contradicted`,
  );
  return lines.join("\n");
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

/** STUB scorer — stands in for the teammate's scoring agent (which will POST /api/cases/[id]/score). */
export function scoreMockCase(c: Case, discrepancies: Discrepancy[]): ScoreInput {
  const by = (s: "strong" | "moderate" | "weak") => c.criteriaArgued.filter((a) => a.strength === s);
  const [strong, moderate, weak] = [by("strong"), by("moderate"), by("weak")];
  const argued = c.criteriaArgued.length;
  const open = discrepancies.filter((d) => d.resolution === "open").length;
  const contradicted = c.evidenceStats.contradicted;

  const approvalLikelihood = clamp(
    30 + 14 * strong.length + 8 * moderate.length + 3 * weak.length - 5 * contradicted - 2 * open + (argued >= 3 ? 8 : -20),
    3,
    97,
  );
  const rfeRisk = clamp(
    18 + 6 * open + 7 * contradicted + 6 * weak.length + 4 * moderate.length + (argued < 4 ? 12 : 0),
    3,
    97,
  );

  const names = (xs: Case["criteriaArgued"]) => xs.map((x) => LABEL[x.criterion].toLowerCase()).join(", ");
  const reasoning = [
    `${plural(argued, "criterion", "criteria")} argued (${strong.length} strong, ${moderate.length} moderate${weak.length ? `, ${weak.length} weak` : ""}), so the three-criterion minimum is ${argued >= 3 ? "met" : "not met"}.`,
    strong.length ? `The case rests on ${names(strong)}.` : "",
    open || contradicted || moderate.length
      ? `RFE risk comes from ${[
          open ? plural(open, "open follow-up question") : "",
          contradicted ? plural(contradicted, "contradicted claim") : "",
          moderate.length ? `thin evidence for ${names(moderate)}` : "",
        ]
          .filter(Boolean)
          .join(", ")}.`
      : "No open issues add RFE risk.",
    open ? "Resolving the open questions should lower the risk." : "",
  ]
    .filter(Boolean)
    .join(" ");

  return ScoreInputSchema.parse({ approvalLikelihood, rfeRisk, reasoning });
}
