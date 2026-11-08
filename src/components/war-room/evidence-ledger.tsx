import type { CSSProperties } from "react";
import { CRITERIA, type FindingRecord } from "@/lib/schemas";
import type { WarRoomClaim } from "@/lib/war-room";
import type { AgentView } from "./derive";
import { Corners, Micro } from "./hud";
import { CRITERION_LABEL, LEDGER_STYLE, alpha, splitUrl, type LedgerStatus } from "./meta";
import { SectionTitle } from "./section-title";
import { StatusPill } from "./status-pill";
import styles from "./styles";

const FRESH_MS = 3000;
const LEGEND: LedgerStatus[] = ["corroborated", "partial", "unverified", "contradicted", "pending"];

export function EvidenceLedger({
  claims,
  findings,
  researchStarted,
  reconciler,
  now,
}: {
  claims: WarRoomClaim[];
  findings: FindingRecord[];
  researchStarted: boolean;
  reconciler: AgentView;
  now: number;
}) {
  const byClaim = new Map(findings.map((f) => [f.claimId, f]));
  const statusOf = (c: WarRoomClaim): LedgerStatus =>
    byClaim.get(c.id)?.status ?? (researchStarted ? "pending" : "queued");

  const counts = new Map<LedgerStatus, number>();
  for (const c of claims) counts.set(statusOf(c), (counts.get(statusOf(c)) ?? 0) + 1);

  return (
    <section id="ledger" aria-labelledby="ledger-title" className={`${styles.panel} min-w-0 scroll-mt-28 p-6 lg:p-8`}>
      <Corners />
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <SectionTitle
          id="ledger-title"
          index="02"
          kicker="Reconciled per claim"
          plain="Evidence"
          checker="ledger"
          sub={`8 O-1A criteria · ${claims.length} claims · ${byClaim.size} reconciled`}
        />
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-3">
            <Micro>Reconciler</Micro>
            <StatusPill status={reconciler.status} size="md" />
          </div>
          {reconciler.currentAction && reconciler.status === "thinking" && (
            <p className={`${styles.mono} text-sm text-[color:var(--muted)]`}>{reconciler.currentAction}</p>
          )}
        </div>
      </header>

      <ul className="mb-5 flex flex-wrap gap-x-6 gap-y-2" aria-label="Verdict counts">
        {LEGEND.map((s) => (
          <li key={s} className="flex items-center gap-2.5">
            <span className="size-3 rotate-45" style={{ backgroundColor: LEDGER_STYLE[s].color }} aria-hidden />
            <span className={`${styles.mono} text-sm tracking-[0.12em] text-[color:var(--muted)] uppercase`}>
              {LEDGER_STYLE[s].label.replace("…", "")}
            </span>
            <span className={`${styles.display} text-3xl tabular-nums`} style={{ color: LEDGER_STYLE[s].text }}>
              {counts.get(s) ?? 0}
            </span>
          </li>
        ))}
      </ul>

      <div className="divide-y divide-[color:var(--line)] border-t border-[color:var(--line)]">
        {CRITERIA.map((criterion, i) => {
          const rows = claims.filter((c) => c.criterion === criterion);
          return (
            <div
              key={criterion}
              className="grid grid-cols-1 gap-x-6 gap-y-2 py-3.5 md:grid-cols-[14rem_minmax(0,1fr)]"
            >
              <div className="pt-1">
                <Micro className="block whitespace-nowrap tabular-nums">C-{String(i + 1).padStart(2, "0")}</Micro>
                <h3
                  className={`${styles.display} mt-1 text-[1.7rem] !leading-[0.95] ${rows.length ? "" : "text-[color:var(--dim)]"}`}
                >
                  {CRITERION_LABEL[criterion]}
                </h3>
              </div>
              <div className="space-y-2.5">
                {rows.length === 0 ? (
                  <p className={`${styles.mono} pt-2 text-base text-[color:var(--dim)]`}>— Not claimed</p>
                ) : (
                  rows.map((c) => (
                    // Keyed by finding id too, so a new verdict remounts the row and replays the flash.
                    <ClaimRow
                      key={`${c.id}:${byClaim.get(c.id)?.id ?? "pending"}`}
                      claim={c}
                      status={statusOf(c)}
                      finding={byClaim.get(c.id)}
                      now={now}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Host names, plus the last path segment when two sources share a host ("github.com/…/dependents"). */
function sourceLabels(urls: string[]): string[] {
  const parts = urls.map(splitUrl);
  const hostCount = new Map<string, number>();
  for (const p of parts) hostCount.set(p.host, (hostCount.get(p.host) ?? 0) + 1);
  return parts.map(({ host, rest }) => {
    if ((hostCount.get(host) ?? 0) < 2) return host;
    const last = rest.split(/[/?#]/).filter(Boolean).pop();
    return last ? `${host}/…/${last.length > 24 ? `${last.slice(0, 23)}…` : last}` : host;
  });
}

function ClaimRow({
  claim,
  status,
  finding,
  now,
}: {
  claim: WarRoomClaim;
  status: LedgerStatus;
  finding: FindingRecord | undefined;
  now: number;
}) {
  const s = LEDGER_STYLE[status];
  const fresh = finding !== undefined && now - Date.parse(finding.createdAt) < FRESH_MS;
  return (
    <div
      className={`border-l-[5px] px-4 py-3 transition-colors duration-700 ${fresh ? styles.flash : ""}`}
      style={
        {
          borderLeftColor: s.color,
          backgroundColor: alpha(s.color, status === "queued" ? 5 : 9),
          "--flash": s.color,
        } as CSSProperties
      }
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
        <span
          className={`${styles.mono} mt-0.5 inline-flex shrink-0 items-center gap-2 px-2.5 py-0.5 text-sm font-semibold tracking-[0.12em] uppercase`}
          style={{ color: s.text, backgroundColor: alpha(s.color, 16), boxShadow: `inset 0 0 0 1px ${alpha(s.color, 40)}` }}
        >
          <span
            className={`size-2 rotate-45 ${status === "pending" ? "motion-safe:animate-pulse" : ""}`}
            style={{ backgroundColor: s.color }}
            aria-hidden
          />
          {s.label}
        </span>
        <p className="min-w-0 flex-1 text-xl leading-snug font-semibold">{claim.summary}</p>
      </div>

      {finding && (
        <div className="mt-1.5 space-y-1.5">
          {finding.foundValue && (
            <p className="text-lg leading-snug" style={{ color: s.text }}>
              <span className={`${styles.mono} mr-2 text-sm tracking-[0.12em] uppercase opacity-80`}>Found</span>
              {finding.foundValue}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {sourceLabels(finding.sources.map((src) => src.url)).map((label, i) => {
              const src = finding.sources[i];
              return (
                <a
                  key={src.url}
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`${src.title}\n${src.excerpt}`}
                  className={`${styles.mono} border border-[color:var(--line)] bg-black/40 px-2 py-0.5 text-sm text-[color:var(--accent)] transition-colors hover:border-[color:var(--accent)]`}
                >
                  {label} ↗
                </a>
              );
            })}
            {finding.sources.length === 0 && (
              <span className={`${styles.mono} text-sm text-[color:var(--dim)]`}>No public sources — documents requested</span>
            )}
            <Micro className="!tracking-[0.1em]">ID match {Math.round(finding.identityConfidence * 100)}%</Micro>
          </div>
        </div>
      )}
    </div>
  );
}
