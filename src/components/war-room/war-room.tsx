"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { SOURCE_AGENT_IDS, type FindingRecord } from "@/lib/schemas";
import type { ReplayLoad, WarRoomApplicant, WarRoomClaim } from "@/lib/war-room";
import { AgentCard } from "./agent-card";
import { Backdrop } from "./backdrop";
import { deriveAgents, type AgentView } from "./derive";
import { DiscrepancyPanel } from "./discrepancy-panel";
import { BuildCaseButton, DossierPanel, type BuildControl } from "./dossier-panel";
import { EvidenceLedger } from "./evidence-ledger";
import { fontVariables } from "./fonts";
import { AGENT_STATUS_STYLE, formatElapsed } from "./meta";
import { ScoreCard } from "./score-card";
import styles from "./styles";
import { Label, SectionTitle } from "./ui";
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
          ? "Available once every claim is checked"
          : null;

  return { onBuild: () => void onBuild(), building, disabledReason, error: state.error };
}

const NAV = [
  { href: "#agents", label: "Agents" },
  { href: "#ledger", label: "Ledger" },
  { href: "#discrepancies", label: "Questions" },
  { href: "#dossier", label: "Dossier" },
];

export function WarRoom({ caseId, replay, speed = 1 }: { caseId: string; replay?: ReplayLoad; speed?: number }) {
  const isReplay = replay !== undefined;
  const live = useLiveFeed(caseId, !isReplay);
  const playback = useReplayFeed(replay?.ok ? replay.file : null, speed);
  const { events, snapshot, online, now } = isReplay ? playback : live;

  const views = useMemo(() => deriveAgents(events), [events]);

  const applicant = snapshot?.applicant ?? null;
  const claims = snapshot?.claims ?? [];
  const findings = snapshot?.findings ?? [];
  const discrepancies = snapshot?.discrepancies ?? [];
  const caseRecord = snapshot?.case ?? null;
  const score = snapshot?.score ?? null;

  const sourceViews = SOURCE_AGENT_IDS.map((id) => views[id]);
  const research = Math.round(sourceViews.reduce((sum, v) => sum + v.progress, 0) / sourceViews.length);
  const researchStarted = sourceViews.some((v) => v.startedAt !== null);
  const caseStart = events.length ? Date.parse(events[0].createdAt) : null;
  const caseEnd = views.pipeline.endedAt;
  const elapsed = caseStart === null ? null : (caseEnd ?? now) - caseStart;
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
    ? "Waiting for a case"
    : score
      ? "Case scored"
      : caseRecord
        ? "Dossier built"
        : caseEnd !== null
          ? "Vetting complete"
          : researchStarted
            ? "Vetting in progress"
            : "Ready";

  // Latest orchestration-level event (pipeline, reconciler, questioner, case builder, scorer, handoffs).
  const pipelineEvent = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === "handoff" || !(SOURCE_AGENT_IDS as readonly string[]).includes(e.agentId)) return e;
    }
    return null;
  }, [events]);

  return (
    <div className={`${styles.root} ${fontVariables}`}>
      <Backdrop />

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className={`${styles.topbar} sticky top-0 z-30`}>
        <div className="mx-auto flex max-w-[1880px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-3 2xl:px-10">
          <a href="#top" className={`${styles.display} text-2xl`}>
            O-1A <span className="text-[color:var(--accent)]">War room</span>
          </a>
          <nav aria-label="Sections" className="hidden md:block">
            <ul className="flex gap-1">
              {NAV.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className={`${styles.navLink} block px-3.5 py-1.5 text-lg font-semibold`}>
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <StatusChip
            mode={isReplay ? (replay?.ok ? "replay" : "missing") : online === null ? "connecting" : online ? "live" : "offline"}
            elapsed={elapsed}
            onRestart={playback.restart}
          />
        </div>
      </div>

      {/* ── Title ────────────────────────────────────────────────────────── */}
      <header id="top" className="relative z-10 mx-auto max-w-[1880px] px-6 pt-12 pb-10 2xl:px-10">
        <Label className="block text-[color:var(--accent)]">
          {phase}
          {isReplay && ` · replay${speed !== 1 ? ` ×${speed}` : ""}`}
        </Label>
        <h1 className={`${styles.display} mt-3 text-[clamp(3.5rem,7vw,7.5rem)]`}>{applicant?.name ?? `Case ${caseId}`}</h1>

        {applicant ? (
          <p className="mt-3 text-2xl text-[color:var(--muted)]">
            {applicant.currentRole}, {applicant.currentOrganization} · {applicant.field}
            {applicant.alternateNames.length > 0 && <> · also published as {applicant.alternateNames.join(", ")}</>}
          </p>
        ) : replay && !replay.ok ? (
          <p role="alert" className="mt-3 text-xl text-[#ffc95c]">
            {replay.error}{" "}
            {replay.command && (
              <code className={`${styles.mono} rounded bg-black/50 px-2 py-0.5 whitespace-nowrap`}>{replay.command}</code>
            )}
          </p>
        ) : (
          snapshot &&
          (caseId === "demo" ? (
            <p className="mt-3 text-xl text-[color:var(--muted)]">
              No data yet. Start the mock run with{" "}
              <code className={`${styles.mono} rounded bg-black/50 px-2 py-0.5`}>npm run mock</code> — this page picks it up
              automatically.
            </p>
          ) : (
            <p className="mt-3 text-xl text-[color:var(--muted)]">
              No case with this ID yet. Submit the form at{" "}
              <a href="/apply" className="underline">
                /apply
              </a>{" "}
              or run <code className={`${styles.mono} rounded bg-black/50 px-2 py-0.5`}>npm run seed</code> — this page picks
              it up automatically.
            </p>
          ))
        )}

        <div className="mt-8 flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
          <dl className="flex flex-wrap gap-x-12 gap-y-4">
            <Stat label="Research" value={`${research}%`} />
            <Stat label="Claims checked" value={`${findings.length}/${claims.length}`} />
            <Stat label="Open questions" value={String(openQuestions)} color={openQuestions ? "#ffc95c" : undefined} />
            {score && <Stat label="Readiness" value={String(Math.round(score.approvalLikelihood))} color="#2ee68a" />}
          </dl>
          <div className="flex flex-wrap items-center gap-3">
            {!isReplay && openQuestions > 0 && (
              <Link href={`/case/${encodeURIComponent(caseId)}/followup`} className={`${styles.buttonGhost} px-7 py-3.5 text-xl`}>
                Resolve questions ({openQuestions}) →
              </Link>
            )}
            {caseRecord ? (
              <a href="#dossier" className={`${styles.button} px-7 py-3.5 text-xl`}>
                View dossier ↓
              </a>
            ) : build.disabledReason === null || build.building ? (
              <BuildCaseButton control={build} />
            ) : null}
          </div>
        </div>

        <p className="mt-6 min-h-7 truncate text-lg text-[color:var(--muted)]">
          {pipelineEvent && (
            <span key={pipelineEvent.id} className={styles.enter}>
              Latest: {pipelineEvent.message}
            </span>
          )}
        </p>
      </header>

      <main className="relative z-10 mx-auto max-w-[1880px] px-6 pb-20 2xl:px-10">
        <section id="agents" aria-labelledby="agents-title" className="scroll-mt-24">
          <SectionTitle id="agents-title" title="Source agents" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {SOURCE_AGENT_IDS.map((id) => (
              <AgentCard key={id} id={id} view={views[id]} now={now} />
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
          <DiscrepancyPanel
            discrepancies={discrepancies}
            claims={claims}
            questioner={views.questioner}
            resolver={views.resolver}
            followupHref={isReplay ? null : `/case/${encodeURIComponent(caseId)}/followup`}
            now={now}
          />
        </div>

        <div className="mt-10 grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <DossierPanel
            caseRecord={caseRecord}
            caseBuilder={views.caseBuilder}
            build={build}
            bundleHref={isReplay ? null : `/api/cases/${encodeURIComponent(caseId)}/bundle?download=1`}
            now={now}
          />
          <ScoreCard score={score} caseRecord={caseRecord} scorer={views.scorer} now={now} />
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <dt>
        <Label>{label}</Label>
      </dt>
      <dd className={`${styles.display} mt-1 text-6xl tabular-nums`} style={{ color }}>
        {value}
      </dd>
    </div>
  );
}

/** Live / offline / replay indicator with elapsed time; replay adds a restart button. */
function StatusChip({
  mode,
  elapsed,
  onRestart,
}: {
  mode: "connecting" | "live" | "offline" | "replay" | "missing";
  elapsed: number | null;
  onRestart: () => void;
}) {
  const time = elapsed === null ? "" : ` · ${formatElapsed(elapsed)}`;
  if (mode === "connecting") return <span className="text-lg font-semibold text-[color:var(--dim)]">Connecting…</span>;
  if (mode === "missing") return <span className="text-lg font-semibold text-[#ff8590]">No replay</span>;
  if (mode === "offline") {
    return (
      <span role="status" className="flex items-center gap-2 text-lg font-semibold text-[#ff8590]">
        <span className="size-2.5 rounded-full bg-[#ff4d5e]" aria-hidden /> Offline
      </span>
    );
  }
  if (mode === "replay") {
    return (
      <span role="status" className="flex items-center gap-3 text-lg font-semibold">
        <span className="tabular-nums text-[color:var(--accent)]">▶ Replay{time}</span>
        <button type="button" onClick={onRestart} className={`${styles.buttonGhost} px-3 py-1 text-base`}>
          Restart
        </button>
      </span>
    );
  }
  return (
    <span role="status" className="flex items-center gap-2 text-lg font-semibold tabular-nums">
      <span className="size-2.5 rounded-full bg-[#2ee68a] motion-safe:animate-pulse" aria-hidden />
      Live{time}
    </span>
  );
}
