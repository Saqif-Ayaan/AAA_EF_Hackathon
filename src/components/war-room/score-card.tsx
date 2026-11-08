import type { CSSProperties } from "react";
import type { CaseRecord, Score } from "@/lib/schemas";
import type { AgentView } from "./derive";
import { STRENGTH_STYLE } from "./dossier-panel";
import { Corners, Micro } from "./hud";
import { CRITERION_LABEL, alpha } from "./meta";
import { SectionTitle } from "./section-title";
import { StatusPill } from "./status-pill";
import styles from "./styles";

const MAX_FLAGS = 5;

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
 * RFE-risk flags. The scores table only stores a number and reasoning, so
 * the flags come from the dossier the score was computed on: unresolved
 * issues first, then criteria argued on less-than-strong evidence.
 */
function riskFlags(c: CaseRecord["caseJson"] | undefined): string[] {
  if (!c) return [];
  const flags = [...c.unresolvedIssues];
  for (const a of c.criteriaArgued) {
    if (a.strength !== "strong") {
      flags.push(`${CRITERION_LABEL[a.criterion]}: ${STRENGTH_STYLE[a.strength].label.toLowerCase()} evidence — ${a.weaknesses.at(-1) ?? "needs support"}`);
    }
  }
  return flags.slice(0, MAX_FLAGS);
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
    <section
      id="score"
      aria-labelledby="score-title"
      className={`${styles.panel} min-w-0 scroll-mt-28 p-6 lg:p-8`}
    >
      <Corners />
      <header className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <SectionTitle id="score-title" index="05" kicker="Scoring agent" plain="Readiness" checker="score" />
        <div className="flex items-center gap-3">
          <Micro>Scorer</Micro>
          <StatusPill status={scorer.status} size="md" />
        </div>
      </header>

      {!score ? (
        <div className="grid min-h-80 place-items-center border border-dashed border-[color:var(--line)] p-8 text-center">
          {scorer.status === "thinking" ? (
            <div>
              <p className={`${styles.display} text-6xl text-[color:var(--accent)] motion-safe:animate-pulse`}>Scoring</p>
              <p className={`${styles.mono} mt-3 text-lg`}>{scorer.currentAction ?? "Scoring the case…"}</p>
            </div>
          ) : (
            <div>
              <p className={`${styles.display} text-[7rem] leading-none text-[color:var(--line)]`}>--</p>
              <p className="mt-3 text-xl text-[color:var(--muted)]">
                {caseRecord ? "Waiting for the scoring agent…" : "The score appears after the case is built."}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div key={score.id} className={fresh ? `${styles.enter}` : undefined}>
          <Gauge value={score.approvalLikelihood} />

          <div className="mt-6 border-t border-[color:var(--line)] pt-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <Micro>RFE risk</Micro>
                <p className={`${styles.display} text-7xl tabular-nums`} style={{ color: rfeBand(score.rfeRisk).color }}>
                  {Math.round(score.rfeRisk)}
                  <span className="text-3xl text-[color:var(--muted)]">/100</span>
                </p>
              </div>
              <span
                className={`${styles.mono} rounded-full border px-4 py-1.5 text-lg font-semibold tracking-[0.14em] uppercase`}
                style={{
                  color: rfeBand(score.rfeRisk).color,
                  borderColor: alpha(rfeBand(score.rfeRisk).color, 55),
                  backgroundColor: alpha(rfeBand(score.rfeRisk).color, 12),
                }}
              >
                ⚑ {rfeBand(score.rfeRisk).label}
              </span>
            </div>
            <div className={`${styles.segTrack} mt-3 h-3.5`} aria-hidden>
              <div
                className={styles.segFill}
                style={{ width: `${score.rfeRisk}%`, backgroundColor: rfeBand(score.rfeRisk).color }}
              />
            </div>

            {flags.length > 0 && (
              <>
                <Micro className="mt-5 block">Risk flags</Micro>
                <ul className="mt-2 space-y-2">
                  {flags.map((f) => (
                    <li key={f} className="flex gap-3 text-lg leading-snug">
                      <span className="text-[#ffb224]" aria-hidden>
                        ⚑
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="mt-6 border-t border-[color:var(--line)] pt-5">
            <Micro>Reasoning</Micro>
            <p className="mt-2 text-xl leading-relaxed">{score.reasoning}</p>
          </div>
        </div>
      )}
    </section>
  );
}

/** Semicircle gauge with the readiness number inside. The arc draws in once (not under reduced motion). */
function Gauge({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const band = readinessBand(v);
  return (
    <figure className="relative mx-auto max-w-md" aria-label={`Approval readiness ${v} out of 100, ${band.label}`}>
      <svg viewBox="0 0 220 124" className="w-full" aria-hidden>
        <path
          d="M 14 112 A 96 96 0 0 1 206 112"
          fill="none"
          stroke="rgb(233 241 237 / 0.1)"
          strokeWidth="14"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray="1.2 1.6"
        />
        <path
          d="M 14 112 A 96 96 0 0 1 206 112"
          fill="none"
          stroke={band.color}
          strokeWidth="14"
          strokeLinecap="round"
          pathLength={100}
          className={styles.gaugeArc}
          style={{ "--gauge": v, filter: `drop-shadow(0 0 8px ${alpha(band.color, 70)})` } as CSSProperties}
        />
      </svg>
      <figcaption className="absolute inset-x-0 bottom-0 text-center">
        <span className={`${styles.display} block text-[clamp(6rem,9vw,9rem)] leading-none tabular-nums`}>{v}</span>
        <span className={`${styles.micro} mt-2 block !text-base`} style={{ color: band.color }}>
          Readiness · {band.label}
        </span>
      </figcaption>
    </figure>
  );
}
