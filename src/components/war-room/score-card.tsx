import type { CaseRecord, Score } from "@/lib/schemas";
import type { AgentView } from "./derive";
import { STRENGTH_STYLE } from "./dossier-panel";
import { CRITERION_LABEL, alpha } from "./meta";
import { StatusPill } from "./status-pill";
import styles from "./styles";
import { Label, SectionTitle } from "./ui";

const MAX_FLAGS = 4;

function readinessBand(v: number) {
  if (v >= 70) return { label: "Strong case", color: "#2ee68a" };
  if (v >= 45) return { label: "Borderline", color: "#ffb224" };
  return { label: "Weak case", color: "#ff4d5e" };
}

function rfeBand(v: number) {
  if (v < 34) return { label: "Low", color: "#2ee68a" };
  if (v < 60) return { label: "Elevated", color: "#ffb224" };
  return { label: "High", color: "#ff4d5e" };
}

/**
 * RFE-risk flags. The scores table only stores numbers and reasoning, so the
 * flags come from the dossier the score was computed on: unresolved issues
 * first, then criteria argued on less-than-strong evidence.
 */
function riskFlags(c: CaseRecord["caseJson"] | undefined): string[] {
  if (!c) return [];
  const thin = c.criteriaArgued
    .filter((a) => a.strength !== "strong")
    .map((a) => `${CRITERION_LABEL[a.criterion]}: ${STRENGTH_STYLE[a.strength].label.toLowerCase()} evidence`);
  // Unresolved issues read "Criterion: long description" — keep just the criterion.
  const open = c.unresolvedIssues.map((u) => {
    const head = u.split(":")[0];
    return head.length < u.length && head.length <= 40 ? `${head}: open question` : u;
  });
  return [...thin, ...open].slice(0, MAX_FLAGS);
}

export function ScoreCard({
  score,
  caseRecord,
  scorer,
  now,
}: {
  score: Score | null;
  caseRecord: CaseRecord | null;
  scorer: AgentView;
  now: number;
}) {
  const fresh = score !== null && now - Date.parse(score.createdAt) < 4000;
  const flags = riskFlags(caseRecord?.caseJson);

  return (
    <section id="score" aria-labelledby="score-title" className={`${styles.panel} min-w-0 scroll-mt-24 p-6 lg:p-8`}>
      <SectionTitle id="score-title" title="Score" right={<StatusPill status={scorer.status} />} />

      {!score ? (
        <p className="rounded-lg border border-dashed border-[color:var(--line)] p-8 text-center text-xl text-[color:var(--dim)]">
          {scorer.status === "thinking"
            ? (scorer.currentAction ?? "Scoring…")
            : caseRecord
              ? "Waiting for the scoring agent…"
              : "Appears after the case is built."}
        </p>
      ) : (
        <div key={score.id} className={fresh ? styles.enter : undefined}>
          <Label>Readiness</Label>
          <div className="flex flex-wrap items-baseline gap-x-4">
            <span className={`${styles.display} text-[8rem] leading-none tabular-nums`}>
              {Math.round(score.approvalLikelihood)}
            </span>
            <span className="text-2xl text-[color:var(--muted)]">/ 100</span>
            <span
              className="rounded-full px-3 py-0.5 text-lg font-semibold"
              style={{
                color: readinessBand(score.approvalLikelihood).color,
                backgroundColor: alpha(readinessBand(score.approvalLikelihood).color, 12),
              }}
            >
              {readinessBand(score.approvalLikelihood).label}
            </span>
          </div>

          <div className="mt-6 border-t border-[color:var(--line)] pt-5">
            <div className="flex items-baseline justify-between gap-3">
              <Label>RFE risk</Label>
              <span className="text-2xl font-semibold tabular-nums" style={{ color: rfeBand(score.rfeRisk).color }}>
                {Math.round(score.rfeRisk)}/100 · {rfeBand(score.rfeRisk).label}
              </span>
            </div>
            <div className={`${styles.bar} mt-2 h-2.5`} aria-hidden>
              <div
                className={styles.barFill}
                style={{ width: `${score.rfeRisk}%`, backgroundColor: rfeBand(score.rfeRisk).color }}
              />
            </div>
            {flags.length > 0 && (
              <ul className="mt-4 space-y-2">
                {flags.map((f) => (
                  <li key={f} className="flex gap-2.5 text-lg leading-snug">
                    <span className="text-[#ffb224]" aria-hidden>
                      •
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-6 border-t border-[color:var(--line)] pt-5">
            <Label>Reasoning</Label>
            <p className="mt-2 text-lg leading-relaxed text-[color:var(--muted)]">{score.reasoning}</p>
          </div>
        </div>
      )}
    </section>
  );
}
