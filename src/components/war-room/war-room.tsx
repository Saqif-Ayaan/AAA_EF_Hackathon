"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { decide } from "@/lib/decision";
import { INVESTIGATOR_IDS, SOURCE_AGENT_IDS, type FindingRecord } from "@/lib/schemas";
import type { ReplayLoad, WarRoomApplicant, WarRoomClaim } from "@/lib/war-room";
import { AgentCard } from "./agent-card";
import { deriveAgents, type AgentView } from "./derive";
import { DiscrepancyPanel } from "./discrepancy-panel";
import { BuildCaseButton, DossierPanel, type BuildControl } from "./dossier-panel";
import { EvidenceLedger } from "./evidence-ledger";
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
  const hypotheses = snapshot?.hypotheses ?? [];
  const caseRecord = snapshot?.case ?? null;
  const score = snapshot?.score ?? null;

  const sourceViews = SOURCE_AGENT_IDS.map((id) => views[id]);
  const research = Math.round(sourceViews.reduce((sum, v) => sum + v.progress, 0) / sourceViews.length);
  const researchStarted = sourceViews.some((v) => v.startedAt !== null);
  const caseStart = events.length ? Date.parse(events[0].createdAt) : null;
  const caseEnd = views.pipeline.endedAt;
  const elapsed = caseStart === null ? null : (caseEnd ?? now) - caseStart;
  const openQuestions = discrepancies.filter((d) => d.resolution === "open").length;
  // Final routing decision (src/lib/decision.ts), once the pipeline has finished.
  const pipelineEnded = views.pipeline.endedAt !== null;
  const decision = useMemo(
    () =>
      pipelineEnded && snapshot?.claims.length
        ? decide({ claims: snapshot.claims, findings: snapshot.findings, hypotheses: snapshot.hypotheses })
        : null,
    [pipelineEnded, snapshot],
  );
  const investigating = INVESTIGATOR_IDS.some((id) => views[id].mode === "investigate" && AGENT_STATUS_STYLE[views[id].status].active);

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
          : investigating
            ? "Investigating failure modes"
            : researchStarted
              ? "Vetting in progress"
              : "Ready";

  // Latest orchestration-level event (pipeline, reconciler, questioner, case builder, scorer, handoffs).
  const pipelineEvent = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === "handoff" || !(INVESTIGATOR_IDS as readonly string[]).includes(e.agentId)) return e;
    }
    return null;
  }, [events]);

  return (
    <div className={styles.root}>
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className={`${styles.topbar} sticky top-0 z-30`}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              O-1A case builder
            </Link>
            <nav aria-label="Sections" className="hidden md:block">
              <ul className="flex gap-1">
                {NAV.map((l) => (
                  <li key={l.href}>
                    <a href={l.href} className={`${styles.navLink} block px-3 py-1 text-sm`}>
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          <StatusChip
            mode={isReplay ? (replay?.ok ? "replay" : "missing") : online === null ? "connecting" : online ? "live" : "offline"}
            elapsed={elapsed}
            onRestart={playback.restart}
          />
        </div>
      </div>

      {/* ── Title ────────────────────────────────────────────────────────── */}
      <header id="top" className="mx-auto max-w-6xl px-6 pt-12 pb-8">
        <Label>
          {phase}
          {isReplay && ` · replay${speed !== 1 ? ` ×${speed}` : ""}`}
        </Label>
        <h1 className={`${styles.display} mt-2 text-4xl`}>{applicant?.name ?? `Case ${caseId}`}</h1>

        {applicant ? (
          <p className="mt-2 text-base text-[color:var(--muted)]">
            {applicant.currentRole}, {applicant.currentOrganization} · {applicant.field}
            {applicant.alternateNames.length > 0 && <> · also published as {applicant.alternateNames.join(", ")}</>}
          </p>
        ) : replay && !replay.ok ? (
          <p role="alert" className="mt-2 text-sm text-[color:var(--warn)]">
            {replay.error}{" "}
            {replay.command && (
              <code className={`${styles.mono} rounded bg-[color:var(--track)] px-1.5 py-0.5 whitespace-nowrap`}>{replay.command}</code>
            )}
          </p>
        ) : (
          snapshot &&
          (caseId === "demo" ? (
            <p className="mt-2 text-sm text-[color:var(--muted)]">
              No data yet. Start the mock run with{" "}
              <code className={`${styles.mono} rounded bg-[color:var(--track)] px-1.5 py-0.5`}>npm run mock</code> — this page picks it
              up automatically.
            </p>
          ) : (
            <p className="mt-2 text-sm text-[color:var(--muted)]">
              No case with this ID yet. Submit the form at{" "}
              <a href="/apply" className="underline">
                /apply
              </a>{" "}
              or run <code className={`${styles.mono} rounded bg-[color:var(--track)] px-1.5 py-0.5`}>npm run seed</code> — this page
              picks it up automatically.
            </p>
          ))
        )}

        <div className="mt-8 flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
          <dl className="flex flex-wrap gap-x-10 gap-y-3">
            <Stat label="Research" value={`${research}%`} />
            <Stat label="Claims checked" value={`${findings.length}/${claims.length}`} />
            <Stat label="Open questions" value={String(openQuestions)} color={openQuestions ? "var(--warn)" : undefined} />
            {decision && (
              <Stat
                label={`Decision · ${decision.criteriaCounted}/${decision.criteriaNeeded} criteria`}
                value={decision.routing === "to_lawyer" ? "To lawyer" : "Needs evidence"}
                color={decision.routing === "to_lawyer" ? "var(--ok)" : "var(--warn)"}
              />
            )}
            {score && <Stat label="Approval likelihood" value={String(Math.round(score.approvalLikelihood))} />}
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            {!isReplay && openQuestions > 0 && (
              <Link href={`/case/${encodeURIComponent(caseId)}/followup`} className={`${styles.buttonGhost} px-4 py-2 text-sm`}>
                Resolve questions ({openQuestions})
              </Link>
            )}
            {caseRecord ? (
              <a href="#dossier" className={`${styles.button} px-4 py-2 text-sm`}>
                View dossier
              </a>
            ) : build.disabledReason === null || build.building ? (
              <BuildCaseButton control={build} />
            ) : null}
          </div>
        </div>

        {decision && (
          <p className="mt-5 max-w-3xl text-[0.95rem] leading-snug">
            {decision.summary}
            {decision.rescued > 0 && ` ${decision.rescued} flagged failure mode(s) were rescued by the investigation.`}
          </p>
        )}
        <p className="mt-5 min-h-5 truncate text-sm text-[color:var(--dim)]">
          {pipelineEvent && (
            <span key={pipelineEvent.id} className={styles.enter}>
              {pipelineEvent.message}
            </span>
          )}
        </p>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-20">
        <section id="agents" aria-labelledby="agents-title" className="scroll-mt-20">
          <SectionTitle id="agents-title" title="Source agents" sub="Verify the claims, then investigate the sceptic's failure modes" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {INVESTIGATOR_IDS.map((id) => (
              <AgentCard key={id} id={id} view={views[id]} now={now} />
            ))}
          </div>
        </section>

        <div className="mt-8 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <EvidenceLedger
            claims={claims}
            findings={findings}
            hypotheses={hypotheses}
            researchStarted={researchStarted}
            reconciler={views.reconciler}
            hypothesisResolver={views.hypothesisResolver}
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

        <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <DossierPanel
            caseRecord={caseRecord}
            caseBuilder={views.caseBuilder}
            build={build}
            bundleHref={isReplay ? null : `/api/cases/${encodeURIComponent(caseId)}/bundle?download=1`}
            // The lawyer's PDF is the last step: offered once the case has been through the scorer.
            documentHref={
              isReplay || (!score && AGENT_STATUS_STYLE[views.scorer.status].active) ? null : `/case/${encodeURIComponent(caseId)}/dossier`
            }
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
      <dd className="mt-0.5 text-2xl font-semibold tracking-tight tabular-nums" style={{ color }}>
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
  if (mode === "connecting") return <span className="text-sm text-[color:var(--dim)]">Connecting…</span>;
  if (mode === "missing") return <span className="text-sm text-[color:var(--bad)]">No replay</span>;
  if (mode === "offline") {
    return (
      <span role="status" className="flex items-center gap-2 text-sm text-[color:var(--bad)]">
        <span className="size-2 rounded-full bg-[color:var(--bad)]" aria-hidden /> Offline
      </span>
    );
  }
  if (mode === "replay") {
    return (
      <span role="status" className="flex items-center gap-3 text-sm">
        <span className="tabular-nums text-[color:var(--muted)]">Replay{time}</span>
        <button type="button" onClick={onRestart} className={`${styles.buttonGhost} px-2.5 py-1 text-xs`}>
          Restart
        </button>
      </span>
    );
  }
  return (
    <span role="status" className="flex items-center gap-2 text-sm tabular-nums text-[color:var(--muted)]">
      <span className="size-2 rounded-full bg-[color:var(--ok)] motion-safe:animate-pulse" aria-hidden />
      Live{time}
    </span>
  );
}
