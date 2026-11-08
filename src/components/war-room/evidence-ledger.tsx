import { CRITERIA, type FindingRecord, type HypothesisRecord } from "@/lib/schemas";
import type { WarRoomClaim } from "@/lib/war-room";
import type { AgentView } from "./derive";
import { CRITERION_LABEL, HYPOTHESIS_STYLE, LEDGER_STYLE, SOURCE_AGENTS, splitUrl, type LedgerStatus } from "./meta";
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
    <section id="ledger" aria-labelledby="ledger-title" className={`${styles.panel} min-w-0 scroll-mt-20 p-6`}>
      <SectionTitle
        id="ledger-title"
        title="Evidence ledger"
        sub={`${byClaim.size} of ${claims.length} claims checked`}
        right={
          <div className="flex flex-wrap items-center gap-2">

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

      <ul className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-label="Verdict counts">
        {LEGEND.map((s) => (
          <li key={s} className="flex items-center gap-1.5 text-[color:var(--muted)]">
            <span className="size-2 rounded-full" style={{ backgroundColor: LEDGER_STYLE[s].color }} aria-hidden />
            <span className="font-medium tabular-nums text-[color:var(--text)]">{counts.get(s) ?? 0}</span>
            {LEDGER_STYLE[s].label.toLowerCase()}
          </li>
        ))}
      </ul>

      <div className="divide-y divide-[color:var(--line)]">
        {CRITERIA.map((criterion) => {
          const rows = claims.filter((c) => c.criterion === criterion);
          const failureModes = hypotheses.filter((h) => h.criterion === criterion);
          return (
            <div key={criterion} className="grid grid-cols-1 gap-x-6 gap-y-1 py-4 md:grid-cols-[10rem_minmax(0,1fr)]">
              <h3 className={`text-sm font-medium ${rows.length ? "" : "text-[color:var(--dim)]"}`}>
                {CRITERION_LABEL[criterion]}
              </h3>
              <div className="space-y-4">
                {rows.length === 0 ? (
                  <p className="text-sm text-[color:var(--dim)]">Not claimed</p>
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
    <div className="border-l-2 border-dashed border-[color:var(--line)] pl-3">
      <Label className="mb-2 block">Failure modes from past AAO denials · {items.length}</Label>
      <ul className="space-y-3">
        {items.map((h) => {
          const s = HYPOTHESIS_STYLE[h.result];
          const rescued = h.queueStatusBefore === "applies" && h.queueStatusAfter === "does_not_apply";
          const fresh = now - Date.parse(h.createdAt) < FRESH_MS;
          const shown = h.reliedOn.length ? h.reliedOn.map((i) => h.measurements[i]).filter(Boolean) : h.measurements;
          return (
            <li key={h.id} className={fresh ? styles.enter : undefined}>
              <p className="flex items-center gap-2 text-xs font-medium" style={{ color: s.text }}>
                <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
                {s.label}
                {rescued && " · rescued"}
              </p>
              <p className="mt-1 text-[0.95rem] leading-snug">{h.failureMode}</p>
              <p className="mt-1 text-sm leading-snug text-[color:var(--muted)]">
                <span className={`${styles.mono} text-xs`}>{h.hypothesis.precedent.caseId}</span> “{h.hypothesis.precedent.quote}”
              </p>
              {shown.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {shown.map((m, i) => (
                    <li key={`${m.checkId}:${m.agentId}:${i}`} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <span className="size-1.5 shrink-0 translate-y-[-1px] rounded-full" style={{ backgroundColor: SOURCE_AGENTS[m.agentId].color }} aria-hidden />
                      <span className="font-medium">{m.metric.replace(/_/g, " ")}:</span>
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
                          className={`${styles.mono} text-xs text-[color:var(--accent)] hover:underline`}
                        >
                          {splitUrl(m.sources[0].url).host} ↗
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1.5 text-sm leading-snug">{h.reasoning.split("\n\n")[0]}</p>
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
  const urls = [...new Set((finding?.sources ?? []).map((src) => src.url))];

  return (
    <div className={fresh ? styles.enter : undefined}>
      <p className="flex items-center gap-2 text-xs font-medium" style={{ color: s.text }}>
        <span
          className={`size-2 rounded-full ${status === "pending" ? "motion-safe:animate-pulse" : ""}`}
          style={{ backgroundColor: s.color }}
          aria-hidden
        />
        {s.label}
        {status === "pending" && "…"}
      </p>
      <p className="mt-1 text-[0.95rem] leading-snug">{claim.summary}</p>
      {finding?.foundValue && <p className="mt-1 text-sm leading-snug text-[color:var(--muted)]">{finding.foundValue}</p>}
      {urls.length > 0 && (
        <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
          {urls.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              title={url}
              className={`${styles.mono} text-xs text-[color:var(--accent)] hover:underline`}
            >
              {splitUrl(url).host} ↗
            </a>
          ))}
        </p>
      )}
    </div>
  );
}
