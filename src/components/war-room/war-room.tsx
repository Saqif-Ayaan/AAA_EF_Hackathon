"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { SOURCE_AGENT_IDS, type AgentEvent } from "@/lib/schemas";
import type { CaseEventsResponse } from "@/lib/war-room";
import { AgentCard } from "./agent-card";
import { Backdrop, Viewfinder } from "./backdrop";
import { deriveAgents } from "./derive";
import { DiscrepancyPanel } from "./discrepancy-panel";
import { EvidenceLedger } from "./evidence-ledger";
import { fontVariables } from "./fonts";
import { Corners, Micro, Timecode } from "./hud";
import { AGENT_STATUS_STYLE } from "./meta";
import { PALETTES, setPalette, usePalette } from "./palette";
import { SectionTitle } from "./section-title";
import { Ticker } from "./ticker";
import styles from "./styles";

const POLL_MS = 500;

type Snapshot = Pick<CaseEventsResponse, "applicant" | "claims" | "findings" | "discrepancies">;

/**
 * Polls GET /api/cases/[id]/events every 500ms. Events are fetched
 * incrementally (?after=lastId); if the server's first event id changes, the
 * run was reset (e.g. the mock re-ran) and everything is refetched from 0.
 */
function useCaseEvents(caseId: string) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    let after = 0;
    let knownFirstId: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctrl = new AbortController();

    const schedule = (ms: number) => {
      if (!ctrl.signal.aborted) timer = setTimeout(tick, ms);
    };

    async function tick() {
      const requestedAfter = after;
      try {
        const res = await fetch(
          `/api/cases/${encodeURIComponent(caseId)}/events?after=${requestedAfter}`,
          { cache: "no-store", signal: ctrl.signal },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as CaseEventsResponse;

        if (requestedAfter > 0 && data.firstEventId !== knownFirstId) {
          after = 0; // reset detected
          return schedule(0);
        }
        knownFirstId = data.firstEventId;
        if (requestedAfter === 0) setEvents(data.events);
        else if (data.events.length) setEvents((prev) => prev.concat(data.events));
        if (data.events.length) after = data.events[data.events.length - 1].id;

        setSnapshot({
          applicant: data.applicant,
          claims: data.claims,
          findings: data.findings,
          discrepancies: data.discrepancies,
        });
        setOnline(true);
        setNow(Date.now());
        schedule(data.hasMore ? 0 : POLL_MS);
      } catch (err) {
        if (ctrl.signal.aborted) return;
        console.warn("[war-room] poll failed", err);
        setOnline(false);
        setNow(Date.now());
        schedule(POLL_MS * 2);
      }
    }

    tick();
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [caseId]);

  return { events, snapshot, online, now };
}

function splitName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length < 2 ? { first: "", last: parts[0] ?? "" } : { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function WarRoom({ caseId }: { caseId: string }) {
  const { events, snapshot, online, now } = useCaseEvents(caseId);
  const views = useMemo(() => deriveAgents(events), [events]);
  const palette = usePalette();

  const applicant = snapshot?.applicant ?? null;
  const claims = snapshot?.claims ?? [];
  const findings = snapshot?.findings ?? [];
  const discrepancies = snapshot?.discrepancies ?? [];

  const sourceViews = SOURCE_AGENT_IDS.map((id) => views[id]);
  const research = Math.round(sourceViews.reduce((sum, v) => sum + v.progress, 0) / sourceViews.length);
  const researchStarted = sourceViews.some((v) => v.startedAt !== null);
  const activeAgents = sourceViews.filter((v) => AGENT_STATUS_STYLE[v.status].active).length;
  const pagesRead = sourceViews.reduce((sum, v) => sum + v.pagesRead, 0);
  const caseStart = events.length ? Date.parse(events[0].createdAt) : null;
  const caseEnd = views.pipeline.endedAt;

  const phase = !applicant
    ? { label: "Awaiting signal", color: "var(--dim)" }
    : caseEnd !== null
      ? { label: "Vetting complete", color: "#2ee68a" }
      : researchStarted
        ? { label: "Vetting in progress", color: "var(--accent)" }
        : { label: "Standing by", color: "var(--muted)" };

  // Latest orchestration-level event (pipeline, reconciler, questioner, handoffs).
  const pipelineEvent = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === "handoff" || ["pipeline", "reconciler", "questioner"].includes(e.agentId)) return e;
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
      <Viewfinder caseId={caseId} palette={palette.label} />

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
          <span className={`${styles.micro} hidden pr-2 lg:inline`}>War room</span>
          <ul className="flex items-center">
            {[
              { href: "#agents", label: "Agents" },
              { href: "#ledger", label: "Ledger" },
              { href: "#discrepancies", label: "Questions", count: discrepancies.length },
            ].map((l) => (
              <li key={l.href}>
                <a href={l.href} className={`${styles.navLink} flex items-center gap-2 px-3.5 py-2 text-base font-semibold sm:text-lg`}>
                  {l.label}
                  {l.count ? (
                    <span className={`${styles.mono} rounded-full bg-[#ffb224] px-1.5 text-xs font-bold text-[#050807]`}>
                      {l.count}
                    </span>
                  ) : null}
                </a>
              </li>
            ))}
          </ul>
          <span className="hidden h-6 w-px bg-[color:var(--line)] sm:block" aria-hidden />
          <PaletteSwitcher current={palette.id} />
          <span className="hidden h-6 w-px bg-[color:var(--line)] sm:block" aria-hidden />
          <div
            className={`${styles.mono} flex items-center gap-2.5 rounded-full border border-[color:var(--line)] bg-black/40 px-4 py-2 text-base`}
            role="status"
            aria-label={online === false ? "Connection lost" : "Recording, live"}
          >
            {online === false ? (
              <span className="font-semibold tracking-[0.14em] text-[#ff4d5e] uppercase">Signal lost</span>
            ) : (
              <>
                <span className={styles.rec} aria-hidden />
                <span className="font-semibold tracking-[0.14em] text-[#ff6b7a] uppercase">Rec</span>
                <span className="text-[color:var(--text)]">
                  <Timecode start={caseStart} end={caseEnd} />
                </span>
              </>
            )}
          </div>
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
                <span className={`${styles.mono} ml-3 text-base tracking-[0.14em] whitespace-nowrap text-[color:var(--accent)] uppercase`}>
                  AKA {applicant.alternateNames.join(" / ")}
                </span>
              )}
            </p>
          ) : (
            snapshot && (
              <p className="mt-4 max-w-3xl text-xl text-[color:var(--muted)] sm:text-2xl">
                No data yet for this case. Start a run (
                <code className={`${styles.mono} bg-black/50 px-2 py-0.5 text-[color:var(--accent)]`}>npm run mock</code>) and
                this page picks it up automatically.
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
            {discrepancies.length > 0 ? (
              <a href="#discrepancies" className={`${styles.cta} ${styles.display} px-8 py-4 text-2xl`}>
                Review {discrepancies.length} {discrepancies.length === 1 ? "question" : "questions"} <span aria-hidden>↓</span>
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
          <Readout label="Pages read" value={pad2(pagesRead)} />
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
          <DiscrepancyPanel
            discrepancies={discrepancies}
            claims={claims}
            questioner={views.questioner}
            now={now}
          />
        </div>
      </main>
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
