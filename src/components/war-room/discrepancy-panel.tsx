import type { CSSProperties } from "react";
import type { Discrepancy } from "@/lib/schemas";
import type { WarRoomClaim } from "@/lib/war-room";
import type { AgentView } from "./derive";
import { Corners, Micro } from "./hud";
import { CRITERION_LABEL, DISCREPANCY_LABEL, RESOLUTION_STYLE, alpha } from "./meta";
import { SectionTitle } from "./section-title";
import { StatusPill } from "./status-pill";
import styles from "./styles";

const FRESH_MS = 3000;
const AMBER = "#ffb224";

export function DiscrepancyPanel({
  discrepancies,
  claims,
  questioner,
  now,
}: {
  discrepancies: Discrepancy[];
  claims: WarRoomClaim[];
  questioner: AgentView;
  now: number;
}) {
  const claimById = new Map(claims.map((c) => [c.id, c]));
  const open = discrepancies.filter((d) => d.resolution === "open").length;

  return (
    <section
      id="discrepancies"
      aria-labelledby="discrepancies-title"
      className={`${styles.panel} flex min-w-0 scroll-mt-28 flex-col p-6 lg:p-8`}
    >
      <Corners />
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <SectionTitle
          id="discrepancies-title"
          index="03"
          kicker="Anomalies + follow-up"
          plain="Open"
          checker="questions"
          sub={
            discrepancies.length === 0
              ? "Questions appear when a claim isn't fully corroborated"
              : `${discrepancies.length} discrepancies · ${open} open`
          }
        />
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-3">
            <Micro>Questioner</Micro>
            <StatusPill status={questioner.status} size="md" />
          </div>
          {questioner.currentAction && questioner.status === "thinking" && (
            <p className={`${styles.mono} text-sm text-[color:var(--muted)]`}>{questioner.currentAction}</p>
          )}
        </div>
      </header>

      {discrepancies.length === 0 ? (
        <div className="relative grid flex-1 place-items-center border border-dashed border-[color:var(--line)] p-10 text-center">
          <div>
            <p className={`${styles.display} text-4xl text-[color:var(--dim)]`}>No anomalies yet</p>
            <p className="mt-2 text-lg text-[color:var(--dim)]">Scanning every claim against its sources.</p>
          </div>
        </div>
      ) : (
        <ol className="space-y-4">
          {discrepancies.map((d, i) => {
            const claim = claimById.get(d.claimId);
            const res = RESOLUTION_STYLE[d.resolution];
            const fresh = now - Date.parse(d.createdAt) < FRESH_MS;
            return (
              <li
                key={d.id}
                className={`relative border border-[color:var(--line)] bg-black/35 p-5 ${fresh ? `${styles.enter} ${styles.flash}` : ""}`}
                style={{ "--flash": AMBER } as CSSProperties}
              >
                <Corners color={alpha(AMBER, 70)} size={14} />
                <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                  <Micro className="!text-[color:#ffc95c]">Anomaly {String(i + 1).padStart(2, "0")}</Micro>
                  <span
                    className={`${styles.mono} px-2 py-0.5 text-sm font-semibold tracking-[0.12em] uppercase`}
                    style={{ color: "#ffc95c", backgroundColor: alpha(AMBER, 14) }}
                  >
                    {DISCREPANCY_LABEL[d.type]}
                  </span>
                  {claim && (
                    <span className={`${styles.display} text-2xl text-[color:var(--text)]`}>
                      {CRITERION_LABEL[claim.criterion]}
                    </span>
                  )}
                  <span
                    className={`${styles.mono} ml-auto rounded-full border px-3 py-0.5 text-sm font-semibold tracking-[0.14em] uppercase`}
                    style={{ color: res.color, borderColor: alpha(res.color, 55), backgroundColor: alpha(res.color, 10) }}
                  >
                    {res.label}
                  </span>
                </div>
                <p className="text-xl leading-snug">{d.description}</p>
                <div
                  className="mt-3 border-l-[3px] px-4 py-2.5"
                  style={{ borderColor: "var(--accent)", backgroundColor: alpha("var(--accent)", 7) }}
                >
                  <Micro className="!text-[color:var(--accent)]">Follow-up question</Micro>
                  <p className="mt-1 text-lg leading-snug text-[color:var(--text)]">{d.question}</p>
                </div>
                {d.requestedDocument && (
                  <p className="mt-3 flex gap-2 text-lg text-[color:var(--muted)]">
                    <span className={`${styles.mono} shrink-0 pt-0.5 text-sm tracking-[0.12em] uppercase`}>Req ▸</span>
                    {d.requestedDocument}
                  </p>
                )}
                {d.applicantResponse && (
                  <p className="mt-2.5 text-lg text-[color:var(--muted)] italic">“{d.applicantResponse}”</p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
