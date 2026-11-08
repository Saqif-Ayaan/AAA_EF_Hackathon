"use client";

/**
 * The war room's two data sources, both returning the same Feed shape:
 *
 * - useLiveFeed: polls GET /api/cases/[id]/events every 500ms. Events are
 *   incremental (?after=lastId); if the server's first event id changes, the
 *   run was reset (e.g. the mock re-ran) and everything is refetched from 0.
 *
 * - useReplayFeed: plays a recorded replays/<id>.json on a timer. Every
 *   timestamp is shifted so the recording starts "now" (so elapsed timers,
 *   fresh-row glows and the REC timecode behave exactly as live), and idle
 *   gaps longer than MAX_GAP_MS are squeezed out (e.g. the pause before
 *   someone clicked "Build case").
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentEvent, CaseRecord, Discrepancy, FindingRecord, Score } from "@/lib/schemas";
import type { CaseEventsResponse, ReplayFile } from "@/lib/war-room";

export type Snapshot = Pick<
  CaseEventsResponse,
  "applicant" | "claims" | "findings" | "discrepancies" | "case" | "score"
>;

export type Feed = {
  events: AgentEvent[];
  snapshot: Snapshot | null;
  /** null until the first response; false while polling fails. */
  online: boolean | null;
  /** Wall-clock ms at the last update; drives elapsed timers and "fresh" animations. */
  now: number;
};

const POLL_MS = 500;

export function useLiveFeed(caseId: string, enabled: boolean): Feed {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!enabled) return;
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
        const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}/events?after=${requestedAfter}`, {
          cache: "no-store",
          signal: ctrl.signal,
        });
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
          case: data.case,
          score: data.score,
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
  cases: CaseRecord[];
  scores: Score[];
  end: number;
};

function retime(file: ReplayFile, speed: number, wallStart: number): Timeline {
  const all = [...file.events, ...file.findings, ...file.discrepancies, ...file.cases, ...file.scores];
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
      case: caseRecord,
      score,
    };
  }, [file, timeline, now]);

  return { events, snapshot, online: file ? true : null, now, restart, ended: timeline ? now >= timeline.end : false };
}
