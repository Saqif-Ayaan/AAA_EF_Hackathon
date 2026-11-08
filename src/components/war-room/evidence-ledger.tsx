import { CRITERIA, type FindingRecord, type HypothesisRecord } from "@/lib/schemas";
import type { WarRoomClaim } from "@/lib/war-room";
import type { AgentView } from "./derive";
import { CRITERION_LABEL, HYPOTHESIS_STYLE, LEDGER_STYLE, SOURCE_AGENTS, alpha, splitUrl, type LedgerStatus } from "./meta";
import { StatusPill } from "./status-pill";
import styles from "./styles";
import { Label, SectionTitle } from "./ui";

const FRESH_MS = 3000;
const LEGEND: LedgerStatus[] = ["corroborated", "partial", "unverified", "contradicted"];

export function EvidenceLedger({
  claims,
  findings,
  hypotheses,
  researchStarted,
  reconciler,
  hypothesisResolver,
  now,
}: {
  claims: WarRoomClaim[];
  findings: FindingRecord[];
  hypotheses: HypothesisRecord[];
  researchStarted: boolean;
  reconciler: AgentView;
  hypothesisResolver: AgentView;
  now: number;
}) {
  const byClaim = new Map(findings.map((f) => [f.claimId, f]));
  const statusOf = (c: WarRoomClaim): LedgerStatus =>
    byClaim.get(c.id)?.status ?? (researchStarted ? "pending" : "queued");

  const counts = new Map<LedgerStatus, number>();
  for (const c of claims) counts.set(statusOf(c), (counts.get(statusOf(c)) ?? 0) + 1);

  return (
    <section id="ledger" aria-labelledby="ledger-title" className={`${styles.panel} min-w-0 scroll-mt-24 p-6 lg:p-8`}>
      <SectionTitle
        id="ledger-title"
        title="Evidence ledger"
        sub={`${byClaim.size} of ${claims.length} claims checked`}
        right={
          <div className="flex flex-wrap items-center gap-3">
            <Label>Reconciler</Label>
            <StatusPill status={reconciler.status} />
            {(hypotheses.length > 0 || hypothesisResolver.status !== "idle") && (
              <>
                <Label>Failure modes</Label>
                <StatusPill status={hypothesisResolver.status} />
              </>
            )}
          </div>
        }
      />

      <ul className="mb-4 flex flex-wrap gap-x-6 gap-y-2 text-lg" aria-label="Verdict counts">
        {LEGEND.map((s) => (
          <li key={s} className="flex items-center gap-2">
            <span className="size-3 rounded-full" style={{ backgroundColor: LEDGER_STYLE[s].color }} aria-hidden />
            <span className="font-semibold tabular-nums" style={{ color: LEDGER_STYLE[s].text }}>
              {counts.get(s) ?? 0}
            </span>
            <span className="text-[color:var(--muted)]">{LEDGER_STYLE[s].label.toLowerCase()}</span>
          </li>
        ))}
      </ul>

      <div className="divide-y divide-[color:var(--line)] border-t border-[color:var(--line)]">
        {CRITERIA.map((criterion) => {
          const rows = claims.filter((c) => c.criterion === criterion);
          const failureModes = hypotheses.filter((h) => h.criterion === criterion);
          return (
            <div key={criterion} className="grid grid-cols-1 gap-x-6 gap-y-2 py-3 md:grid-cols-[12rem_minmax(0,1fr)]">
              <h3 className={`pt-2 text-xl font-semibold ${rows.length ? "" : "text-[color:var(--dim)]"}`}>
                {CRITERION_LABEL[criterion]}
              </h3>
              <div className="space-y-2">
                {rows.length === 0 ? (
                  <p className="pt-2 text-lg text-[color:var(--dim)]">Not claimed</p>
                ) : (
                  rows.map((c) => (
                    // Keyed by finding id too, so a new verdict remounts the row and fades it in.
                    <ClaimRow
                      key={`${c.id}:${byClaim.get(c.id)?.id ?? "pending"}`}
                      claim={c}
                      status={statusOf(c)}
                      finding={byClaim.get(c.id)}
                      now={now}
                    />
                  ))
                )}
                {failureModes.length > 0 && <FailureModes items={failureModes} now={now} />}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** PART 3: the sceptic's failure modes for one criterion, with what the investigation measured. */
function FailureModes({ items, now }: { items: HypothesisRecord[]; now: number }) {
  return (
    <div className="pt-1">
      <Label className="mb-1.5 block">Failure modes · {items.length}</Label>
      <ul className="space-y-2">
        {items.map((h) => {
          const s = HYPOTHESIS_STYLE[h.result];
          const rescued = h.queueStatusBefore === "applies" && h.queueStatusAfter === "does_not_apply";
          const fresh = now - Date.parse(h.createdAt) < FRESH_MS;
          const shown = h.reliedOn.length ? h.reliedOn.map((i) => h.measurements[i]).filter(Boolean) : h.measurements;
          return (
            <li
              key={h.id}
              className={`rounded-lg border border-dashed px-4 py-2.5 ${fresh ? styles.enter : ""}`}
              style={{ borderColor: alpha(s.color, 45), backgroundColor: alpha(s.color, 6) }}
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="shrink-0 rounded-full px-2.5 py-0.5 text-sm font-bold" style={{ color: s.text, backgroundColor: alpha(s.color, 16) }}>
                  {s.label}
                  {rescued && " · rescued"}
                </span>
                <p className="min-w-0 flex-1 text-lg leading-snug font-medium">{h.failureMode}</p>
              </div>
              <p className="mt-1 text-base leading-snug text-[color:var(--muted)]">
                <span className={`${styles.mono} text-sm`}>{h.hypothesis.precedent.caseId}</span> “{h.hypothesis.precedent.quote}”
              </p>
              {shown.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {shown.map((m, i) => (
                    <li key={`${m.checkId}:${m.agentId}:${i}`} className="flex flex-wrap items-baseline gap-x-2 text-base">
                      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: SOURCE_AGENTS[m.agentId].color }} aria-hidden />
                      <span className="font-semibold">{m.metric.replace(/_/g, " ")}:</span>
                      <span>{m.value === null ? "couldn't measure" : typeof m.value === "number" ? m.value.toLocaleString("en-US") : m.value}</span>
                      {m.benchmark && (
                        <span className="text-[color:var(--muted)]">
                          vs {m.benchmark.description} ({typeof m.benchmark.value === "number" ? m.benchmark.value.toLocaleString("en-US") : m.benchmark.value})
                        </span>
                      )}
                      {m.sources[0] && (
                        <a
                          href={m.sources[0].url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={m.sources[0].url}
                          className={`${styles.mono} text-sm text-[color:var(--accent)] hover:underline`}
                        >
                          {splitUrl(m.sources[0].url).host} ↗
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1.5 text-base leading-snug">{h.reasoning.split("\n\n")[0]}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
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
  const hosts = [...new Set((finding?.sources ?? []).map((src) => src.url))];

  return (
    <div
      className={`rounded-lg border-l-4 px-4 py-2.5 ${fresh ? styles.enter : ""}`}
      style={{ borderLeftColor: s.color, backgroundColor: alpha(s.color, status === "queued" ? 4 : 8) }}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="shrink-0 text-base font-bold" style={{ color: s.text }}>
          {s.label}
          {status === "pending" && <span className="motion-safe:animate-pulse">…</span>}
        </span>
        <p className="min-w-0 flex-1 text-xl leading-snug font-medium">{claim.summary}</p>
      </div>
      {finding?.foundValue && <p className="mt-1 text-lg leading-snug text-[color:var(--muted)]">{finding.foundValue}</p>}
      {hosts.length > 0 && (
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {hosts.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              title={url}
              className={`${styles.mono} text-sm text-[color:var(--accent)] hover:underline`}
            >
              {splitUrl(url).host} ↗
            </a>
          ))}
        </p>
      )}
    </div>
  );
}
