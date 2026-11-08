import type { CSSProperties } from "react";
import type { CaseRecord } from "@/lib/schemas";
import type { AgentView } from "./derive";
import { Corners, Micro } from "./hud";
import { CRITERION_LABEL, alpha, splitUrl } from "./meta";
import { SectionTitle } from "./section-title";
import { StatusPill } from "./status-pill";
import styles from "./styles";

const FRESH_MS = 4000;

export const STRENGTH_STYLE = {
  strong: { label: "Strong", color: "#2ee68a" },
  moderate: { label: "Moderate", color: "var(--accent)" },
  weak: { label: "Weak", color: "#ffb224" },
} as const;

export type BuildControl = {
  onBuild: () => void;
  building: boolean;
  /** Why the button is disabled, or null when it can be pressed. */
  disabledReason: string | null;
  error: string | null;
};

/** Large luminous "Build case" button. */
export function BuildCaseButton({
  control,
  label = "Build case",
  size = "lg",
}: {
  control: BuildControl;
  label?: string;
  size?: "lg" | "md";
}) {
  const disabled = control.building || control.disabledReason !== null;
  return (
    <button
      type="button"
      onClick={control.onBuild}
      disabled={disabled}
      title={control.disabledReason ?? undefined}
      className={`${size === "lg" ? styles.cta : styles.ctaGhost} ${styles.display} ${
        size === "lg" ? "px-9 py-5 text-3xl" : "px-6 py-3 text-xl"
      } disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0`}
    >
      {control.building ? (
        <>
          <span className="inline-block size-3 animate-pulse rounded-full bg-current" aria-hidden /> Building…
        </>
      ) : (
        <>
          <span aria-hidden>◆</span> {label}
        </>
      )}
    </button>
  );
}

export function DossierPanel({
  caseRecord,
  caseBuilder,
  build,
  openQuestions,
  now,
}: {
  caseRecord: CaseRecord | null;
  caseBuilder: AgentView;
  build: BuildControl;
  openQuestions: number;
  now: number;
}) {
  const c = caseRecord?.caseJson ?? null;
  const exhibitCount = c?.criteriaArgued.reduce((n, a) => n + a.exhibits.length, 0) ?? 0;
  const fresh = caseRecord !== null && now - Date.parse(caseRecord.createdAt) < FRESH_MS;

  return (
    <section
      id="dossier"
      aria-labelledby="dossier-title"
      className={`${styles.panel} min-w-0 scroll-mt-28 p-6 lg:p-8`}
    >
      <Corners />
      <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <SectionTitle
          id="dossier-title"
          index="04"
          kicker="Case builder · verified evidence only"
          plain="Case"
          checker="dossier"
          sub={
            c
              ? `${c.criteriaArgued.length} criteria argued · ${exhibitCount} cited exhibits`
              : "The strongest honest case, built only from corroborated evidence"
          }
        />
        <div className="flex flex-col items-end gap-3">
          <div className="flex items-center gap-3">
            <Micro>Case builder</Micro>
            <StatusPill status={caseBuilder.status} size="md" />
          </div>
          {c && <BuildCaseButton control={build} label="Rebuild" size="md" />}
        </div>
      </header>

      {!c ? (
        <EmptyDossier build={build} caseBuilder={caseBuilder} openQuestions={openQuestions} />
      ) : (
        // Keyed by case id so a rebuild remounts and replays the entrance.
        <div key={caseRecord?.id} className={fresh ? styles.enter : undefined}>
          <div className="border-l-4 border-[color:var(--accent)] py-1 pl-5">
            <Micro className="!text-[color:var(--accent)]">Case theory</Micro>
            <p className="mt-2 text-2xl leading-snug font-medium">{c.summary}</p>
          </div>

          <dl className="mt-6 grid grid-cols-2 border border-[color:var(--line)] sm:grid-cols-5">
            {[
              { k: "Claims", v: c.evidenceStats.totalClaims, color: undefined },
              { k: "Corroborated", v: c.evidenceStats.corroborated, color: "#6af2ad" },
              { k: "Substantiated", v: c.evidenceStats.substantiated, color: "var(--accent)" },
              { k: "Unverified", v: c.evidenceStats.unverified, color: "#c8d3ce" },
              { k: "Contradicted", v: c.evidenceStats.contradicted, color: "#ff8590" },
            ].map((s) => (
              <div key={s.k} className="border-[color:var(--line)] px-4 py-3 not-last:border-r">
                <dt>
                  <Micro>{s.k}</Micro>
                </dt>
                <dd className={`${styles.display} mt-1 text-5xl tabular-nums`} style={{ color: s.color }}>
                  {String(s.v).padStart(2, "0")}
                </dd>
              </div>
            ))}
          </dl>

          <ol className="mt-8 space-y-6">
            {c.criteriaArgued.map((a, i) => {
              const st = STRENGTH_STYLE[a.strength];
              return (
                <li key={a.criterion} className="relative border border-[color:var(--line)] bg-black/30 p-6">
                  <Corners color={alpha(st.color, 70)} size={16} />
                  <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <Micro>CR-{String(i + 1).padStart(2, "0")}</Micro>
                    <h3 className={`${styles.display} text-[2.6rem]`}>{CRITERION_LABEL[a.criterion]}</h3>
                    <span
                      className={`${styles.mono} ml-auto rounded-full border px-3.5 py-1 text-base font-semibold tracking-[0.14em] uppercase`}
                      style={{ color: st.color, borderColor: alpha(st.color, 55), backgroundColor: alpha(st.color, 12) }}
                    >
                      {st.label}
                    </span>
                  </div>
                  <p className="text-xl leading-relaxed">{a.argument}</p>

                  <Micro className="mt-5 block">Exhibits · {String(a.exhibits.length).padStart(2, "0")}</Micro>
                  <ol className="mt-2 space-y-2">
                    {a.exhibits.map((e, j) => (
                      <li key={e.url} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className={`${styles.mono} text-base text-[color:var(--accent)] tabular-nums`}>
                          EX-{String(i + 1)}.{j + 1}
                        </span>
                        <a
                          href={e.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-w-0 text-lg font-semibold underline decoration-[color:var(--line)] underline-offset-4 hover:decoration-[color:var(--accent)]"
                        >
                          {e.label}
                        </a>
                        <span className={`${styles.mono} text-sm text-[color:var(--muted)]`}>{splitUrl(e.url).host} ↗</span>
                        <span
                          className={`${styles.mono} px-2 text-xs font-semibold tracking-[0.12em] uppercase`}
                          style={{
                            color: e.status === "corroborated" ? "#6af2ad" : "var(--accent)",
                            backgroundColor: alpha(e.status === "corroborated" ? "#2ee68a" : "var(--accent)", 12),
                          }}
                        >
                          {e.status}
                        </span>
                      </li>
                    ))}
                  </ol>

                  {a.weaknesses.length > 0 && (
                    <>
                      <Micro className="mt-5 block !text-[color:#ffc95c]">Weaknesses</Micro>
                      <ul className="mt-2 space-y-1.5">
                        {a.weaknesses.map((w) => (
                          <li key={w} className="flex gap-3 text-lg leading-snug text-[color:var(--text)]">
                            <span className="text-[#ffb224]" aria-hidden>
                              ⚠
                            </span>
                            {w}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </li>
              );
            })}
          </ol>

          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <div>
              <Micro className="block">Not argued</Micro>
              <ul className="mt-3 space-y-2.5">
                {c.criteriaNotArgued.map((n) => (
                  <li key={n.criterion} className="text-lg leading-snug">
                    <span className={`${styles.display} mr-2 text-2xl text-[color:var(--muted)]`}>
                      {CRITERION_LABEL[n.criterion]}
                    </span>
                    <span className="text-[color:var(--muted)]">{n.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <Micro className="block">Suggested letter writers</Micro>
              <ul className="mt-3 space-y-2.5">
                {c.suggestedLetterWriters.map((l) => (
                  <li key={l.role} className="text-lg leading-snug">
                    <span className="font-semibold">{l.role}</span>
                    <span className="text-[color:var(--muted)]"> — {l.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function EmptyDossier({
  build,
  caseBuilder,
  openQuestions,
}: {
  build: BuildControl;
  caseBuilder: AgentView;
  openQuestions: number;
}) {
  return (
    <div className="relative grid place-items-center border border-dashed border-[color:var(--line)] px-6 py-14 text-center">
      {build.building ? (
        <div className="w-full max-w-2xl">
          <p className={`${styles.display} text-6xl text-[color:var(--accent)] motion-safe:animate-pulse`}>
            Building dossier
          </p>
          <p className={`${styles.mono} mt-4 text-lg text-[color:var(--text)]`}>
            {caseBuilder.currentAction ?? "Starting the case builder…"}
          </p>
          <div className={`${styles.segTrack} mx-auto mt-6 h-4 max-w-xl`}>
            <div
              className={`${styles.segFill} ${styles.segActive}`}
              style={{ width: `${caseBuilder.progress}%`, backgroundColor: "var(--accent)" } as CSSProperties}
            />
          </div>
        </div>
      ) : (
        <div className="max-w-2xl">
          <p className={`${styles.display} text-6xl`}>No dossier yet</p>
          <p className="mt-3 text-xl text-[color:var(--muted)]">
            Picks the strongest 3–5 criteria, argues each with cited exhibits, and flags the weak spots.
            {openQuestions > 0 && ` ${openQuestions} open questions are left out until they’re resolved.`}
          </p>
          <div className="mt-8 flex justify-center">
            <BuildCaseButton control={build} />
          </div>
          {build.disabledReason && (
            <p className={`${styles.mono} mt-4 text-base text-[color:var(--dim)]`}>{build.disabledReason}</p>
          )}
        </div>
      )}
      {build.error && (
        <p role="alert" className={`${styles.mono} mt-4 text-base text-[#ff8590]`}>
          Build failed: {build.error}
        </p>
      )}
    </div>
  );
}
