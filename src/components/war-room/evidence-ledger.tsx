import { CRITERIA, type FindingRecord } from "@/lib/schemas";
import type { WarRoomClaim } from "@/lib/war-room";
import type { AgentView } from "./derive";
import { CRITERION_LABEL, LEDGER_STYLE, splitUrl, type LedgerStatus } from "./meta";
import { StatusPill } from "./status-pill";
import styles from "./styles";
import { Label, SectionTitle } from "./ui";

const FRESH_MS = 3000;
const LEGEND: LedgerStatus[] = ["corroborated", "partial", "unverified", "contradicted"];

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
    <section id="ledger" aria-labelledby="ledger-title" className={`${styles.panel} min-w-0 scroll-mt-20 p-6`}>
      <SectionTitle
        id="ledger-title"
        title="Evidence ledger"
        sub={`${byClaim.size} of ${claims.length} claims checked`}
        right={
          <div className="flex items-center gap-2">
            <Label>Reconciler</Label>
            <StatusPill status={reconciler.status} />
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
              </div>
            </div>
          );
        })}
      </div>
    </section>
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
