/**
 * Template case builder used by "Build case" (POST /api/cases/[id]/build) until
 * the real Mastra caseBuilder agent (Opus) exists. Deterministic, no LLM, but it
 * follows the spec rules: corroborated or applicant-substantiated evidence (plus partially
 * verified claims, capped at moderate and flagged)
 * is argued, the strongest 3–5 criteria are picked, everything else is listed
 * with a reason, and nothing is invented beyond what the findings say.
 *
 * Output is validated against CaseSchema (the handoff contract). Scoring is NOT
 * done here — that is the scoring agent in src/scorer/index.ts.
 */
import {
  CRITERIA,
  CaseSchema,
  type Case,
  type Criterion,
  type Discrepancy,
  type FindingRecord,
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

export function buildTemplateCase({ applicant, claims, findings, discrepancies }: CaseInput): {
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
    // Corroborated and applicant-substantiated claims are solid; partially verified claims are
    // argued too, but only ever as moderate evidence and with their gaps spelled out.
    const isSolid = (r: (typeof rows)[number]) => r.finding?.status === "corroborated" || r.substantiated;
    const isPartial = (r: (typeof rows)[number]) => !isSolid(r) && r.finding?.status === "partial";
    const usable = rows.filter((r) => isSolid(r) || isPartial(r));

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

    // Strong needs solid evidence: two solid claims, or one with 3+ sources and near-certain identity.
    const solid = usable.filter(isSolid);
    const rich = solid.some(
      (r) => (r.finding?.sources.length ?? 0) >= 3 && (r.finding?.identityConfidence ?? 0) >= 0.95,
    );
    const strength = solid.length >= 2 || rich ? "strong" : "moderate";

    const seen = new Set<string>();
    const exhibits = usable.flatMap((r) =>
      (r.finding?.sources ?? [])
        .filter((s) => !seen.has(s.url) && seen.add(s.url))
        .map((s) => ({
          // Exhibit status only has corroborated | substantiated (schemas.ts), so partially
          // verified sources are marked in the label instead.
          label: isPartial(r) ? `${s.title} (partially verified)` : s.title,
          url: s.url,
          status: r.finding?.status === "corroborated" ? ("corroborated" as const) : ("substantiated" as const),
        })),
    );

    const points = usable
      .map((r) =>
        isPartial(r) ? `${r.claim.summary} (partially verified${r.finding?.foundValue ? `: ${lowerFirst(r.finding.foundValue)}` : ""})` : r.claim.summary,
      )
      .join("; ");

    const weaknesses = [
      ...usable
        .filter(isPartial)
        .map((r) => `“${r.claim.summary}” is only partially verified${r.finding?.reasoning ? ` — ${lowerFirst(r.finding.reasoning)}` : "."}`),
      ...rows
        .filter((r) => !usable.includes(r))
        .map((r) => `“${r.claim.summary}” is left out — ${r.finding?.status ?? "not yet verified"}.`),
      CAVEAT[criterion],
    ];

    argued.push({
      criterion,
      strength,
      argument: `${LEAD[criterion]} ${points}.`,
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
    chosen.length
      ? `${applicant.name} has evidence for ${chosen.length} of the 8 O-1A criteria (${plural(exhibitCount, "exhibit")}), led by ${LABEL[chosen[0].criterion].toLowerCase()}. ${chosen.filter((c) => c.strength === "strong").length} rated strong, ${chosen.filter((c) => c.strength === "moderate").length} moderate (moderate means a single corroborated source set, or evidence that is only partially verified).`
      : `No criterion is supported by verified evidence yet for ${applicant.name}.`,
    open ? `${plural(open, "open question")} ${open === 1 ? "stays" : "stay"} out of the case until resolved.` : "",
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
