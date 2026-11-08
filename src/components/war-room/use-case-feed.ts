"use client";

/**
 * The war room's two data sources, both returning the same Feed shape:
 *
 * - useLiveFeed: polls the real case APIs every 500ms —
 *     GET /api/cases/[id]                 applicant, latest case, latest score
 *     GET /api/cases/[id]/events?after=N  new events only (incremental)
 *     GET /api/cases/[id]/findings        claims + findings (latest per claim is shown)
 *     GET /api/cases/[id]/discrepancies   questions and their resolutions
 *   If the events' firstEventId changes, the run was reset (e.g. the mock
 *   re-ran) and everything is refetched from 0. A 404 means the case doesn't
 *   exist (yet): the page keeps waiting.
 *
 * - useReplayFeed: plays a recorded replays/<id>.json on a timer. Every
 *   timestamp is shifted so the recording starts "now" (so elapsed timers,
 *   fresh-row glows and the REC timecode behave exactly as live), and idle
 *   gaps longer than MAX_GAP_MS are squeezed out (e.g. the pause before
 *   someone clicked "Build case").
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaseSummaryResponse } from "@/app/api/cases/[id]/route";
import type { CaseDiscrepanciesResponse } from "@/app/api/cases/[id]/discrepancies/route";
import type { CaseEventsResponse } from "@/app/api/cases/[id]/events/route";
import type { CaseFindingsResponse } from "@/app/api/cases/[id]/findings/route";
import type { CaseHypothesesResponse } from "@/app/api/cases/[id]/hypotheses/route";
import type { AgentEvent, CaseRecord, Discrepancy, FindingRecord, HypothesisRecord, Score } from "@/lib/schemas";
import type { CaseSnapshot, ReplayFile } from "@/lib/war-room";

export type Snapshot = CaseSnapshot;

export type Feed = {
  events: AgentEvent[];
  snapshot: Snapshot | null;
  /** null until the first response; false while polling fails. */
  online: boolean | null;
  /** Wall-clock ms at the last update; drives elapsed timers and "fresh" animations. */
  now: number;
};

const POLL_MS = 500;

const EMPTY: Snapshot = { applicant: null, claims: [], findings: [], discrepancies: [], hypotheses: [], case: null, score: null };

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { cache: "no-store", signal });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function useLiveFeed(caseId: string, enabled: boolean): Feed {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const base = `/api/cases/${encodeURIComponent(caseId)}`;
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
        const summaryRes = await fetch(base, { cache: "no-store", signal: ctrl.signal });
        if (summaryRes.status === 404) {
          // No such case (yet) — e.g. /case/demo before `npm run mock`. Keep waiting.
          after = 0;
          knownFirstId = null;
          setEvents([]);
          setSnapshot(EMPTY);
          setOnline(true);
          setNow(Date.now());
          return schedule(POLL_MS * 2);
        }
        if (!summaryRes.ok) throw new Error(`${base} → HTTP ${summaryRes.status}`);
        const summary = (await summaryRes.json()) as CaseSummaryResponse;

        const [ev, fd, dd, hd] = await Promise.all([
          getJson<CaseEventsResponse>(`${base}/events?after=${requestedAfter}`, ctrl.signal),
          getJson<CaseFindingsResponse>(`${base}/findings`, ctrl.signal),
          getJson<CaseDiscrepanciesResponse>(`${base}/discrepancies`, ctrl.signal),
          getJson<CaseHypothesesResponse>(`${base}/hypotheses`, ctrl.signal),
        ]);

        if (requestedAfter > 0 && ev.firstEventId !== knownFirstId) {
          after = 0; // reset detected
          return schedule(0);
        }
        knownFirstId = ev.firstEventId;
        if (requestedAfter === 0) setEvents(ev.events);
        else if (ev.events.length) setEvents((prev) => prev.concat(ev.events));
        if (ev.events.length) after = ev.events[ev.events.length - 1].id;

        // A claim can be re-verified (e.g. after follow-up); the ledger shows the newest finding.
        const latest = new Map(fd.findings.map((f) => [f.claimId, f]));
        setSnapshot({
          applicant: summary.applicant,
          claims: fd.claims.map(({ id, criterion, summary: text }) => ({ id, criterion, summary: text })),
          findings: [...latest.values()],
          discrepancies: dd.discrepancies,
          hypotheses: hd.hypotheses as HypothesisRecord[],
          case: summary.case,
          score: summary.score,
        });
        setOnline(true);
        setNow(Date.now());
        schedule(ev.hasMore ? 0 : POLL_MS);
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
  }, [caseId, enabled]);

  return { events, snapshot, online, now };
}

// ── Replay ───────────────────────────────────────────────────────────────────

const LEAD_IN_MS = 1500;
const MAX_GAP_MS = 2500;
const TICK_MS = 200;

type Timeline = {
  events: AgentEvent[];
  findings: FindingRecord[];
  discrepancies: Discrepancy[];
  hypotheses: HypothesisRecord[];
  cases: CaseRecord[];
  scores: Score[];
  end: number;
};

function retime(file: ReplayFile, speed: number, wallStart: number): Timeline {
  const all = [...file.events, ...file.findings, ...file.discrepancies, ...file.hypotheses, ...file.cases, ...file.scores];
  const stamps = [...new Set(all.map((x) => Date.parse(x.createdAt)))].sort((a, b) => a - b);
  const offset = new Map<number, number>();
  let acc = 0;
  stamps.forEach((s, i) => {
    if (i > 0) acc += Math.min(s - stamps[i - 1], MAX_GAP_MS);
    offset.set(s, acc);
  });
  const at = (iso: string) => wallStart + LEAD_IN_MS + (offset.get(Date.parse(iso)) ?? 0) / speed;
  const shift = <T extends { createdAt: string }>(x: T): T => ({ ...x, createdAt: new Date(at(x.createdAt)).toISOString() });

  return {
    events: file.events.map(shift),
    findings: file.findings.map(shift),
    discrepancies: file.discrepancies.map(shift),
    hypotheses: file.hypotheses.map(shift),
    cases: file.cases.map(shift),
    scores: file.scores.map(shift),
    end: wallStart + LEAD_IN_MS + acc / speed,
  };
}

export type ReplayFeed = Feed & { restart: () => void; ended: boolean };

export function useReplayFeed(file: ReplayFile | null, speed: number): ReplayFeed {
  const startRef = useRef(0);
  const [clock, setClock] = useState<{ start: number; now: number } | null>(null);

  useEffect(() => {
    if (!file) return;
    startRef.current = Date.now();
    const tick = () => setClock({ start: startRef.current, now: Date.now() });
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, TICK_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [file]);

  const restart = useCallback(() => {
    startRef.current = Date.now();
    setClock({ start: startRef.current, now: startRef.current });
  }, []);

  const start = clock?.start ?? null;
  const now = clock?.now ?? 0;
  const timeline = useMemo(() => (file && start !== null ? retime(file, speed, start) : null), [file, speed, start]);

  // Events arrive in order, so "how many are visible" keeps the array identity stable between ticks.
  let visibleEvents = 0;
  if (timeline) while (visibleEvents < timeline.events.length && Date.parse(timeline.events[visibleEvents].createdAt) <= now) visibleEvents++;
  const events = useMemo(() => timeline?.events.slice(0, visibleEvents) ?? [], [timeline, visibleEvents]);

  const snapshot = useMemo((): Snapshot | null => {
    if (!file || !timeline) return null;
    const shown = (x: { createdAt: string }) => Date.parse(x.createdAt) <= now;
    const latest = new Map<string, FindingRecord>();
    for (const f of timeline.findings) if (shown(f)) latest.set(f.claimId, f);
    const caseRecord = timeline.cases.filter(shown).at(-1) ?? null;
    const score = caseRecord ? (timeline.scores.filter((s) => s.caseId === caseRecord.id && shown(s)).at(-1) ?? null) : null;
    return {
      applicant: file.applicant,
      claims: file.claims,
      findings: [...latest.values()],
      discrepancies: timeline.discrepancies.filter(shown),
      hypotheses: timeline.hypotheses.filter(shown),
      case: caseRecord,
      score,
    };
  }, [file, timeline, now]);

  return { events, snapshot, online: file ? true : null, now, restart, ended: timeline ? now >= timeline.end : false };
}
