import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { CaseBundleError, loadCaseBundle } from "@/lib/case-bundle";
import { getLatestCaseAndScore } from "@/lib/case-data";
import { decide } from "@/lib/decision";
import { CRITERION_LABELS, RESOLUTION_LABELS } from "@/lib/labels";
import type { CaseBundle, FindingStatus, HypothesisResult } from "@/lib/schemas";

export const metadata: Metadata = { title: "O-1A case dossier" };

/** The dossier is a document: always light, whatever theme the app is in. */
const LIGHT = {
  "--color-white": "#ffffff",
  "--color-neutral-50": "#fafafa",
  "--color-neutral-100": "#f5f5f5",
  "--color-neutral-200": "#e5e5e5",
  "--color-neutral-300": "#d4d4d4",
  "--color-neutral-400": "#a3a3a3",
  "--color-neutral-500": "#737373",
  "--color-neutral-600": "#525252",
  "--color-neutral-700": "#404040",
  "--color-neutral-800": "#262626",
  "--color-neutral-900": "#171717",
} as CSSProperties;

const STRENGTH = { strong: "Strong", moderate: "Moderate", weak: "Weak" } as const;
const STATUS: Record<FindingStatus, string> = {
  corroborated: "Corroborated",
  partial: "Partially verified",
  unverified: "Unverified",
  contradicted: "Contradicted",
};

const RESULT: Record<HypothesisResult, string> = {
  confirmed: "Confirmed: applies",
  cleared: "Cleared: does not apply",
  still_unknown: "Open: could not be settled",
};
const ROUTING = { to_lawyer: "Ready for attorney review", needs_more_evidence: "Needs more evidence before filing" } as const;
const POSITION = { clear: "Counts", open: "Counts, with open points", flagged: "Does not count" } as const;

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="border-b border-neutral-300 pb-2 text-lg font-semibold tracking-tight">
        {n}. {title}
      </h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default async function DossierPage(props: PageProps<"/case/[id]/dossier">) {
  const { id } = await props.params;

  let bundle: CaseBundle;
  try {
    bundle = await loadCaseBundle(id);
  } catch (err) {
    if (err instanceof CaseBundleError && err.status === 404) notFound();
    if (err instanceof CaseBundleError) {
      return (
        <main style={LIGHT} className="min-h-screen bg-white px-6 py-24 text-neutral-900">
          <div className="mx-auto max-w-xl">
            <h1 className="text-xl font-semibold">The dossier isn&apos;t ready yet</h1>
            <p className="mt-2 text-neutral-600">{err.message}</p>
            <Link href={`/case/${id}`} className="mt-5 inline-block text-sm font-medium underline">
              Back to the case
            </Link>
          </div>
        </main>
      );
    }
    throw err;
  }

  const { applicant, claims, findings, discrepancies, hypotheses, case: caseRow } = bundle;
  const c = caseRow.caseJson;
  // The dossier is the last step: it reports the scorer's result and the routing decision.
  const { score } = await getLatestCaseAndScore(id);
  const decision = decide({ claims, findings, hypotheses });
  let sectionNo = 0;
  const n = () => ++sectionNo;
  const findingOf = new Map(findings.map((f) => [f.claimId, f]));
  const claimOf = new Map(claims.map((x) => [x.id, x]));

  // One exhibit number per distinct URL, in order of first citation.
  const exhibitNo = new Map<string, number>();
  for (const a of c.criteriaArgued) for (const e of a.exhibits) if (!exhibitNo.has(e.url)) exhibitNo.set(e.url, exhibitNo.size + 1);
  const answered = discrepancies.filter((d) => d.resolution !== "open" && d.applicantResponse);
  const links = Object.values(applicant.links).filter((url): url is string => Boolean(url));

  return (
    <div style={LIGHT} className="min-h-screen bg-white text-neutral-900">
      <div className="border-b border-neutral-200 print:hidden">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
          <Link href={`/case/${id}`} className="text-sm text-neutral-600 hover:text-neutral-900">
            ← Back to the case
          </Link>
          <PrintButton />
        </div>
      </div>

      <article className="mx-auto max-w-3xl px-6 py-14 text-[0.95rem] leading-relaxed print:py-0">
        <header>
          <p className="text-xs font-medium tracking-wide text-neutral-500">PRIVILEGED &amp; CONFIDENTIAL · DRAFT FOR ATTORNEY REVIEW</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">O-1A evidence dossier</h1>
          <p className="mt-1 text-xl text-neutral-700">{applicant.name}</p>

          <dl className="mt-6 grid grid-cols-[9rem_1fr] gap-x-6 gap-y-1.5 text-sm">
            <dt className="text-neutral-500">Field</dt>
            <dd>{applicant.field}</dd>
            <dt className="text-neutral-500">Current role</dt>
            <dd>
              {applicant.currentRole}, {applicant.currentOrganization}
            </dd>
            <dt className="text-neutral-500">Planned US work</dt>
            <dd>{applicant.usWorkPlan}</dd>
            {applicant.alternateNames.length > 0 && (
              <>
                <dt className="text-neutral-500">Also known as</dt>
                <dd>{applicant.alternateNames.join(", ")}</dd>
              </>
            )}
            {links.length > 0 && (
              <>
                <dt className="text-neutral-500">Profiles</dt>
                <dd className="break-all">{links.join(" · ")}</dd>
              </>
            )}
            <dt className="text-neutral-500">Prepared</dt>
            <dd>{fmtDate(caseRow.createdAt)}</dd>
          </dl>
        </header>

        <Section n={n()} title="Case summary">
          <p>{c.summary}</p>
          <p className="mt-3 text-sm text-neutral-600">
            Of {c.evidenceStats.totalClaims} claims checked against public sources: {c.evidenceStats.corroborated} corroborated,{" "}
            {c.evidenceStats.substantiated} substantiated by the applicant, {c.evidenceStats.unverified} unverified,{" "}
            {c.evidenceStats.contradicted} contradicted.
          </p>
        </Section>

        <Section n={n()} title="Readiness and routing">
          <dl className="grid grid-cols-[11rem_1fr] gap-x-6 gap-y-1.5 text-sm">
            <dt className="text-neutral-500">Routing</dt>
            <dd className="font-medium">
              {ROUTING[decision.routing]} · {decision.criteriaCounted} of {decision.criteriaNeeded} required criteria count
            </dd>
            {score ? (
              <>
                <dt className="text-neutral-500">Approval likelihood</dt>
                <dd>{Math.round(score.approvalLikelihood)} / 100</dd>
                <dt className="text-neutral-500">Risk of an RFE</dt>
                <dd>{Math.round(score.rfeRisk)} / 100</dd>
              </>
            ) : (
              <>
                <dt className="text-neutral-500">Score</dt>
                <dd className="text-neutral-600">Not scored yet</dd>
              </>
            )}
          </dl>
          {score && <p className="mt-4 text-sm text-neutral-700">{score.reasoning}</p>}
          <table className="mt-5 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-300 text-left text-neutral-500">
                <th className="py-2 pr-4 font-medium">Criterion</th>
                <th className="py-2 pr-4 font-medium">After vetting</th>
                <th className="py-2 font-medium">Why</th>
              </tr>
            </thead>
            <tbody>
              {decision.criteria.map((d) => (
                <tr key={d.criterion} className="break-inside-avoid border-b border-neutral-200 align-top">
                  <td className="py-2 pr-4 font-medium">{CRITERION_LABELS[d.criterion]}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{POSITION[d.status]}</td>
                  <td className="py-2 text-neutral-600">{d.reasons.join(" ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-neutral-500">
            Evidence is set aside only on high-confidence proof that it is invalid. Anything doubtful but unconfirmed still counts and is
            listed as an open point.
          </p>
        </Section>

        <Section n={n()} title="Criteria at a glance">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-300 text-left text-neutral-500">
                <th className="py-2 pr-4 font-medium">Criterion</th>
                <th className="py-2 pr-4 font-medium">Position</th>
                <th className="py-2 font-medium">Basis</th>
              </tr>
            </thead>
            <tbody>
              {c.criteriaArgued.map((a) => (
                <tr key={a.criterion} className="break-inside-avoid border-b border-neutral-200 align-top">
                  <td className="py-2 pr-4 font-medium">{CRITERION_LABELS[a.criterion]}</td>
                  <td className="py-2 pr-4">Argued · {STRENGTH[a.strength]}</td>
                  <td className="py-2 text-neutral-600">
                    {a.exhibits.length} exhibit{a.exhibits.length === 1 ? "" : "s"}
                  </td>
                </tr>
              ))}
              {c.criteriaNotArgued.map((n) => (
                <tr key={n.criterion} className="break-inside-avoid border-b border-neutral-200 align-top text-neutral-500">
                  <td className="py-2 pr-4">{CRITERION_LABELS[n.criterion]}</td>
                  <td className="py-2 pr-4">Not argued</td>
                  <td className="py-2">{n.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section n={n()} title="Argument by criterion">
          <div className="space-y-9">
            {c.criteriaArgued.map((a) => (
              <div key={a.criterion} className="break-inside-avoid">
                <h3 className="text-base font-semibold">
                  {CRITERION_LABELS[a.criterion]}{" "}
                  <span className="ml-2 text-sm font-normal text-neutral-500">{STRENGTH[a.strength]}</span>
                </h3>
                <p className="mt-2">{a.argument}</p>
                {a.exhibits.length > 0 && (
                  <>
                    <p className="mt-4 text-xs font-medium text-neutral-500">EXHIBITS</p>
                    <ul className="mt-1 space-y-0.5 text-sm">
                      {a.exhibits.map((e) => (
                        <li key={e.url}>
                          <span className="font-medium">Exhibit {exhibitNo.get(e.url)}</span> · {e.label}{" "}
                          <span className="text-neutral-500">({host(e.url)})</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {a.weaknesses.length > 0 && (
                  <>
                    <p className="mt-4 text-xs font-medium text-neutral-500">WEAKNESSES AND HOW TO ADDRESS THEM</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-neutral-700">
                      {a.weaknesses.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            ))}
          </div>
        </Section>

        <Section n={n()} title="Claim-by-claim verification">
          <p className="mb-4 text-sm text-neutral-600">
            Every claim from the intake form and what independent sources showed, including claims that were not argued.
          </p>
          <ul className="space-y-5">
            {claims.map((claim) => {
              const f = findingOf.get(claim.id);
              return (
                <li key={claim.id} className="break-inside-avoid text-sm">
                  <p>
                    <span className="font-medium">{CRITERION_LABELS[claim.criterion]}</span> · {STATUS[f?.status ?? "unverified"]}
                  </p>
                  <p className="mt-0.5">{claim.summary}</p>
                  {f?.foundValue && <p className="mt-0.5 text-neutral-600">{f.foundValue}</p>}
                  {f && f.sources.length > 0 && (
                    <p className="mt-0.5 break-all text-xs text-neutral-500">Sources: {f.sources.map((s) => s.url).join(" · ")}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>

        {hypotheses.length > 0 && (
          <Section n={n()} title="Precedent check: past AAO denials">
            <p className="mb-4 text-sm text-neutral-600">
              Weaknesses the AAO has found in similar evidence in published O-1A decisions, and what independent sources showed for
              this applicant.
            </p>
            <ul className="space-y-6">
              {hypotheses.map((h) => {
                const claim = claimOf.get(h.claimId);
                const relied = h.reliedOn.map((i) => h.measurements[i]).filter(Boolean);
                return (
                  <li key={h.id} className="break-inside-avoid text-sm">
                    <p className="text-neutral-500">
                      {CRITERION_LABELS[h.criterion]} · {RESULT[h.result]}
                      {h.queueStatusBefore === "applies" && h.result === "cleared" && " (cleared by investigation)"}
                    </p>
                    <p className="mt-0.5 font-medium">{h.failureMode}</p>
                    {claim && <p className="mt-0.5 text-neutral-600">Evidence: {claim.summary}</p>}
                    <p className="mt-1 border-l-2 border-neutral-300 pl-3 text-neutral-700">
                      “{h.hypothesis.precedent.quote}” <span className="text-neutral-500">({h.hypothesis.precedent.caseId})</span>
                    </p>
                    {relied.length > 0 && (
                      <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-neutral-700">
                        {relied.map((m, i) => (
                          <li key={`${m.checkId}:${i}`}>
                            {m.metric.replace(/_/g, " ")}: {typeof m.value === "number" ? m.value.toLocaleString("en-US") : m.value}
                            {m.benchmark &&
                              ` (benchmark: ${m.benchmark.description}, ${typeof m.benchmark.value === "number" ? m.benchmark.value.toLocaleString("en-US") : m.benchmark.value})`}
                            {m.sources[0] && <span className="break-all text-neutral-500"> · {m.sources[0].url}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-1 text-neutral-700">{h.reasoning.split("\n\n")[0]}</p>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        {answered.length > 0 && (
          <Section n={n()} title="Applicant clarifications">
            <ul className="space-y-5">
              {answered.map((d) => {
                const claim = claimOf.get(d.claimId);
                return (
                  <li key={d.id} className="break-inside-avoid text-sm">
                    <p className="text-neutral-500">
                      {claim ? `${CRITERION_LABELS[claim.criterion]} · ` : ""}
                      {RESOLUTION_LABELS[d.resolution]}
                    </p>
                    <p className="mt-0.5 font-medium">{d.question}</p>
                    <p className="mt-1 border-l-2 border-neutral-300 pl-3 text-neutral-700">{d.applicantResponse}</p>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        <Section n={n()} title="Open issues and next steps">
          {c.unresolvedIssues.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {c.unresolvedIssues.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-neutral-600">No open issues.</p>
          )}
          {c.suggestedLetterWriters.length > 0 && (
            <>
              <p className="mt-6 text-xs font-medium text-neutral-500">SUGGESTED RECOMMENDATION-LETTER WRITERS</p>
              <ul className="mt-1 space-y-1 text-sm">
                {c.suggestedLetterWriters.map((l) => (
                  <li key={l.role}>
                    <span className="font-medium">{l.role}</span> — {l.reason}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>

        <Section n={n()} title="Exhibit index">
          <ol className="space-y-1 text-sm">
            {[...exhibitNo.entries()].map(([url, n]) => (
              <li key={url} className="break-all">
                <span className="font-medium">Exhibit {n}</span> · {url}
              </li>
            ))}
          </ol>
        </Section>

        <footer className="mt-14 border-t border-neutral-300 pt-5 text-xs leading-relaxed text-neutral-500">
          Prepared on {fmtDate(caseRow.createdAt)} from public sources and the applicant&apos;s own statements, using AI-assisted
          research. This is a research and drafting aid, not legal advice, a petition, or a prediction of approval. Counsel should
          independently verify every fact and source, confirm the applicant&apos;s identity against each record (many names are
          shared), and capture authenticated copies of the exhibits before relying on them. Self-reported material is marked as
          such.
        </footer>
      </article>
    </div>
  );
}
