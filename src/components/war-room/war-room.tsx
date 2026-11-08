"use client";

import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { SOURCE_AGENT_IDS, type FindingRecord } from "@/lib/schemas";
import type { ReplayLoad, WarRoomApplicant, WarRoomClaim } from "@/lib/war-room";
import { AgentCard } from "./agent-card";
import { Backdrop, Viewfinder } from "./backdrop";
import { deriveAgents, type AgentView } from "./derive";
import { DiscrepancyPanel } from "./discrepancy-panel";
import { BuildCaseButton, DossierPanel, type BuildControl } from "./dossier-panel";
import { EvidenceLedger } from "./evidence-ledger";
import { fontVariables } from "./fonts";
import { Corners, Micro, Timecode } from "./hud";
import { AGENT_STATUS_STYLE } from "./meta";
import { PALETTES, setPalette, usePalette } from "./palette";
import { ScoreCard } from "./score-card";
import { SectionTitle } from "./section-title";
import styles from "./styles";
import { Ticker } from "./ticker";
import { useLiveFeed, useReplayFeed } from "./use-case-feed";

/** How long after a click the button stays in "Building…" before events confirm it. */
const BUILD_GRACE_MS = 2500;

function useBuildControl({
  caseId,
  now,
  isReplay,
  applicant,
  claims,
  findings,
  caseBuilder,
  scorer,
}: {
  caseId: string;
  now: number;
  isReplay: boolean;
  applicant: WarRoomApplicant | null;
  claims: WarRoomClaim[];
  findings: FindingRecord[];
  caseBuilder: AgentView;
  scorer: AgentView;
}): BuildControl {
  const [state, setState] = useState<{ requestedAt: number | null; pending: boolean; error: string | null }>({
    requestedAt: null,
    pending: false,
    error: null,
  });

  const onBuild = useCallback(async () => {
    setState({ requestedAt: Date.now(), pending: true, error: null });
    try {
      const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}/build`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setState((s) => ({ ...s, pending: false }));
    } catch (err) {
      setState({ requestedAt: null, pending: false, error: err instanceof Error ? err.message : String(err) });
    }
  }, [caseId]);

  const agentsBusy = AGENT_STATUS_STYLE[caseBuilder.status].active || AGENT_STATUS_STYLE[scorer.status].active;
  const building =
    state.pending || (state.requestedAt !== null && now - state.requestedAt < BUILD_GRACE_MS) || agentsBusy;

  const disabledReason = isReplay
    ? "Replay mode — the recorded build plays from the file"
    : !applicant
      ? "No case loaded yet"
      : claims.length === 0
        ? "No claims yet"
        : findings.length < claims.length
          ? "Available once every claim is reconciled"
          : null;

  return { onBuild: () => void onBuild(), building, disabledReason, error: state.error };
}

function splitName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length < 2
    ? { first: "", last: parts[0] ?? "" }
    : { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

const pad2 = (n: number) => String(Math.round(n)).padStart(2, "0");

export function WarRoom({ caseId, replay, speed = 1 }: { caseId: string; replay?: ReplayLoad; speed?: number }) {
  const isReplay = replay !== undefined;
  const live = useLiveFeed(caseId, !isReplay);
  const playback = useReplayFeed(replay?.ok ? replay.file : null, speed);
  const { events, snapshot, online, now } = isReplay ? playback : live;

  const views = useMemo(() => deriveAgents(events), [events]);
  const palette = usePalette();

  const applicant = snapshot?.applicant ?? null;
  const claims = snapshot?.claims ?? [];
  const findings = snapshot?.findings ?? [];
  const discrepancies = snapshot?.discrepancies ?? [];
  const caseRecord = snapshot?.case ?? null;
  const score = snapshot?.score ?? null;

  const sourceViews = SOURCE_AGENT_IDS.map((id) => views[id]);
  const research = Math.round(sourceViews.reduce((sum, v) => sum + v.progress, 0) / sourceViews.length);
  const researchStarted = sourceViews.some((v) => v.startedAt !== null);
  const activeAgents = sourceViews.filter((v) => AGENT_STATUS_STYLE[v.status].active).length;
  const pagesRead = sourceViews.reduce((sum, v) => sum + v.pagesRead, 0);
  const caseStart = events.length ? Date.parse(events[0].createdAt) : null;
  const caseEnd = views.pipeline.endedAt;
  const openQuestions = discrepancies.filter((d) => d.resolution === "open").length;

  const build = useBuildControl({
    caseId,
    now,
    isReplay,
    applicant,
    claims,
    findings,
    caseBuilder: views.caseBuilder,
    scorer: views.scorer,
  });

  const phase = !applicant
    ? { label: "Awaiting signal", color: "var(--dim)" }
    : score
      ? { label: "Case scored", color: "#2ee68a" }
      : caseRecord
        ? { label: "Dossier built", color: "var(--accent)" }
        : caseEnd !== null
          ? { label: "Vetting complete", color: "#2ee68a" }
          : researchStarted
            ? { label: "Vetting in progress", color: "var(--accent)" }
            : { label: "Standing by", color: "var(--muted)" };

  // Latest orchestration-level event (pipeline, reconciler, questioner, case builder, scorer, handoffs).
  const pipelineEvent = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === "handoff" || !(SOURCE_AGENT_IDS as readonly string[]).includes(e.agentId)) return e;
    }
    return null;
  }, [events]);

  const name = applicant ? splitName(applicant.name) : null;

  return (
    <div
      className={`${styles.root} ${fontVariables}`}
      style={{ "--accent": palette.accent, "--accent-2": palette.accent2 } as CSSProperties}
    >
      <Backdrop />
      <Viewfinder caseId={caseId} palette={isReplay ? `${palette.label} · playback` : palette.label} />

      {/* ── Pill nav ─────────────────────────────────────────────────────── */}
      <div className="sticky top-3 z-30 flex justify-center px-4 pt-3">
        <nav
          aria-label="War room"
          className={`${styles.pill} flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-2 rounded-[28px] p-1.5 sm:rounded-full`}
        >
          <a
            href="#top"
            className={`${styles.display} flex items-center gap-2 rounded-full bg-[color:var(--accent)] px-4 py-2 text-xl text-[#050807]`}
          >
            <span aria-hidden>◆</span> O-1A
          </a>
          <span className={`${styles.micro} hidden pr-2 2xl:inline`}>War room</span>
          <ul className="flex flex-wrap items-center justify-center">
            {[
              { href: "#agents", label: "Agents" },
              { href: "#ledger", label: "Ledger" },
              { href: "#discrepancies", label: "Questions", count: discrepancies.length },
              { href: "#dossier", label: "Dossier", dot: caseRecord !== null },
            ].map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  className={`${styles.navLink} flex items-center gap-2 px-3.5 py-2 text-base font-semibold sm:text-lg`}
                >
                  {l.label}
                  {l.count ? (
                    <span className={`${styles.mono} rounded-full bg-[#ffb224] px-1.5 text-xs font-bold text-[#050807]`}>
                      {l.count}
                    </span>
                  ) : null}
                  {l.dot ? <span className="size-2 rounded-full bg-[color:var(--accent)]" aria-label="ready" /> : null}
                </a>
              </li>
            ))}
          </ul>
          <span className="hidden h-6 w-px bg-[color:var(--line)] sm:block" aria-hidden />
          <PaletteSwitcher current={palette.id} />
          <span className="hidden h-6 w-px bg-[color:var(--line)] sm:block" aria-hidden />
          <CameraChip
            mode={isReplay ? (replay?.ok ? "replay" : "missing") : online === false ? "lost" : "live"}
            caseStart={caseStart}
            caseEnd={caseEnd}
            onRestart={playback.restart}
            ended={playback.ended}
          />
        </nav>
      </div>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <header
        id="top"
        className="relative z-10 mx-auto grid max-w-[1880px] gap-8 px-6 pt-12 pb-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)] lg:items-end lg:pt-16 2xl:px-10"
      >
        <div className="min-w-0">
          <Micro className="mb-4 block">
            Case {caseId} <span className="opacity-60">{"//"}</span> Subject 01 <span className="opacity-60">{"//"}</span>{" "}
            <span style={{ color: phase.color }}>{phase.label}</span>
            {isReplay && (
              <>
                {" "}
                <span className="opacity-60">{"//"}</span>{" "}
                <span className="text-[color:var(--accent)]">Replay{speed !== 1 ? ` ×${speed}` : ""}</span>
              </>
            )}
          </Micro>
          <h1 className={`${styles.display} text-[clamp(4rem,10vw,11rem)] break-words`}>
            {name ? (
              <>
                {name.first && <span className="text-[color:var(--text)]">{name.first} </span>}
                <span className={styles.checker}>{name.last}</span>
              </>
            ) : (
              <>
                Awaiting <span className={styles.checker}>signal</span>
              </>
            )}
          </h1>
          {applicant ? (
            <p className="mt-4 max-w-4xl text-xl text-[color:var(--muted)] sm:text-2xl">
              {applicant.currentRole}, {applicant.currentOrganization} · {applicant.field}
              {applicant.alternateNames.length > 0 && (
                <span
                  className={`${styles.mono} ml-3 text-base tracking-[0.14em] whitespace-nowrap text-[color:var(--accent)] uppercase`}
                >
                  AKA {applicant.alternateNames.join(" / ")}
                </span>
              )}
            </p>
          ) : replay && !replay.ok ? (
            <p role="alert" className={`${styles.mono} mt-4 max-w-4xl text-xl text-[#ffc95c]`}>
              {replay.error}
              {replay.command && (
                <code className="ml-3 inline-block bg-black/50 px-2 py-0.5 whitespace-nowrap text-[color:var(--accent)]">
                  {replay.command}
                </code>
              )}
            </p>
          ) : (
            snapshot && (
              <p className="mt-4 max-w-3xl text-xl text-[color:var(--muted)] sm:text-2xl">
                No data yet for this case. Start a run (
                <code className={`${styles.mono} bg-black/50 px-2 py-0.5 text-[color:var(--accent)]`}>npm run mock</code>
                ) and this page picks it up automatically.
              </p>
            )
          )}

          <p className={`${styles.mono} mt-5 flex min-h-7 items-center gap-3 text-base text-[color:var(--text)] sm:text-lg`}>
            <span className="text-[color:var(--accent)]" aria-hidden>
              ▸
            </span>
            {pipelineEvent ? (
              <span key={pipelineEvent.id} className={`${styles.enter} min-w-0 truncate`}>
                {pipelineEvent.message}
              </span>
            ) : (
              <span className="text-[color:var(--dim)]">Pipeline idle</span>
            )}
          </p>

          <div className="mt-7 flex flex-wrap gap-4">
            {caseRecord ? (
              <a href="#dossier" className={`${styles.cta} ${styles.display} px-8 py-4 text-2xl`}>
                View dossier <span aria-hidden>↓</span>
              </a>
            ) : build.disabledReason === null || build.building ? (
              <BuildCaseButton control={build} />
            ) : discrepancies.length > 0 ? (
              <a href="#discrepancies" className={`${styles.cta} ${styles.display} px-8 py-4 text-2xl`}>
                Review {discrepancies.length} {discrepancies.length === 1 ? "question" : "questions"}{" "}
                <span aria-hidden>↓</span>
              </a>
            ) : (
              <a href="#agents" className={`${styles.cta} ${styles.display} px-8 py-4 text-2xl`}>
                Watch the agents <span aria-hidden>↓</span>
              </a>
            )}
            <a href="#ledger" className={`${styles.ctaGhost} ${styles.display} px-8 py-4 text-2xl`}>
              Evidence ledger
            </a>
          </div>
        </div>

        <aside aria-label="Case readout" className={`${styles.panel} relative grid grid-cols-2`}>
          <Readout label="Research" value={`${research}%`} accent={researchStarted && caseEnd === null} />
          <Readout label="Claims checked" value={`${pad2(findings.length)}/${pad2(claims.length)}`} />
          {score ? (
            <Readout label="Readiness" value={pad2(score.approvalLikelihood)} color="#2ee68a" />
          ) : (
            <Readout label="Pages read" value={pad2(pagesRead)} />
          )}
          <Readout
            label="Anomalies"
            value={pad2(discrepancies.length)}
            color={discrepancies.length ? "#ffc95c" : undefined}
          />
          <Corners size={22} />
        </aside>
      </header>

      <Ticker events={events} />

      <main className="relative z-10 mx-auto max-w-[1880px] px-6 pb-20 2xl:px-10">
        <section id="agents" aria-labelledby="agents-title" className="scroll-mt-24 pt-10">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <SectionTitle id="agents-title" index="01" kicker="Parallel source sweep" plain="Source" checker="agents" />
            <Micro>
              {SOURCE_AGENT_IDS.length} agents <span className="opacity-60">{"//"}</span>{" "}
              <span className={activeAgents ? "text-[color:var(--accent)]" : ""}>{activeAgents} active</span>
            </Micro>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {SOURCE_AGENT_IDS.map((id) => (
              <AgentCard key={id} id={id} view={views[id]} now={now} caseStart={caseStart} />
            ))}
          </div>
        </section>

        <div className="mt-10 grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <EvidenceLedger
            claims={claims}
            findings={findings}
            researchStarted={researchStarted}
            reconciler={views.reconciler}
            now={now}
          />
          <DiscrepancyPanel discrepancies={discrepancies} claims={claims} questioner={views.questioner} now={now} />
        </div>

        <div className="mt-10 grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <DossierPanel
            caseRecord={caseRecord}
            caseBuilder={views.caseBuilder}
            build={build}
            openQuestions={openQuestions}
            now={now}
          />
          <ScoreCard score={score} caseRecord={caseRecord} scorer={views.scorer} now={now} />
        </div>
      </main>
    </div>
  );
}

/** REC timecode while live; PLAYBACK + restart in replay mode. */
function CameraChip({
  mode,
  caseStart,
  caseEnd,
  onRestart,
  ended,
}: {
  mode: "live" | "lost" | "replay" | "missing";
  caseStart: number | null;
  caseEnd: number | null;
  onRestart: () => void;
  ended: boolean;
}) {
  const shell = `${styles.mono} flex items-center gap-2.5 rounded-full border border-[color:var(--line)] bg-black/40 px-4 py-2 text-base`;
  if (mode === "lost" || mode === "missing") {
    return (
      <div className={shell} role="status">
        <span className="font-semibold tracking-[0.14em] text-[#ff4d5e] uppercase">
          {mode === "lost" ? "Signal lost" : "No replay"}
        </span>
      </div>
    );
  }
  if (mode === "replay") {
    return (
      <div className={`${shell} !py-1.5 !pr-1.5`} role="status" aria-label={ended ? "Replay finished" : "Replaying"}>
        <span className="font-semibold tracking-[0.14em] text-[color:var(--accent)] uppercase">
          {ended ? "■ End" : "▶ Replay"}
        </span>
        <span className="text-[color:var(--text)]">
          <Timecode start={caseStart} end={caseEnd} />
        </span>
        <button
          type="button"
          onClick={onRestart}
          className="rounded-full border border-[color:var(--line)] px-3 py-1 text-sm tracking-[0.14em] uppercase hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
        >
          Restart
        </button>
      </div>
    );
  }
  return (
    <div className={shell} role="status" aria-label="Recording, live">
      <span className={styles.rec} aria-hidden />
      <span className="font-semibold tracking-[0.14em] text-[#ff6b7a] uppercase">Rec</span>
      <span className="text-[color:var(--text)]">
        <Timecode start={caseStart} end={caseEnd} />
      </span>
    </div>
  );
}

function Readout({ label, value, color, accent }: { label: string; value: string; color?: string; accent?: boolean }) {
  return (
    <div className="border-[color:var(--line)] p-5 [&:nth-child(-n+2)]:border-b [&:nth-child(odd)]:border-r">
      <Micro>{label}</Micro>
      <p
        className={`${styles.display} mt-2 text-[clamp(3rem,4.2vw,4.5rem)] tabular-nums`}
        style={{ color: color ?? (accent ? "var(--accent)" : undefined) }}
      >
        {value}
      </p>
    </div>
  );
}

function PaletteSwitcher({ current }: { current: string }) {
  return (
    <fieldset className="flex items-center gap-2.5 px-2">
      <legend className="sr-only">Accent colour</legend>
      {PALETTES.map((p) => (
        <label key={p.id} className="cursor-pointer" title={p.label}>
          <input
            type="radio"
            name="war-room-palette"
            value={p.id}
            checked={current === p.id}
            onChange={() => setPalette(p.id)}
            className={`${styles.swatchInput} sr-only`}
          />
          <span className={styles.swatch} style={{ backgroundColor: p.accent, color: p.accent }} />
          <span className="sr-only">{p.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
