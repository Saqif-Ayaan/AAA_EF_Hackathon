import type { Discrepancy } from "@/lib/schemas";
import type { WarRoomClaim } from "@/lib/war-room";
import type { AgentView } from "./derive";
import { CRITERION_LABEL, DISCREPANCY_LABEL, RESOLUTION_STYLE, alpha } from "./meta";
import { StatusPill } from "./status-pill";
import styles from "./styles";
import { Label, SectionTitle } from "./ui";

const FRESH_MS = 3000;

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
      className={`${styles.panel} flex min-w-0 scroll-mt-24 flex-col p-6 lg:p-8`}
    >
      <SectionTitle
        id="discrepancies-title"
        title="Questions"
        sub={discrepancies.length ? `${open} open` : "Raised when a claim isn't fully corroborated"}
        right={
          <div className="flex items-center gap-3">
            <Label>Questioner</Label>
            <StatusPill status={questioner.status} />
          </div>
        }
      />

      {discrepancies.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[color:var(--line)] p-8 text-center text-xl text-[color:var(--dim)]">
          No discrepancies yet.
        </p>
      ) : (
        <ol className="space-y-4">
          {discrepancies.map((d) => {
            const claim = claimById.get(d.claimId);
            const res = RESOLUTION_STYLE[d.resolution];
            const fresh = now - Date.parse(d.createdAt) < FRESH_MS;
            return (
              <li
                key={d.id}
                className={`rounded-lg border border-[color:var(--line)] p-5 ${fresh ? styles.enter : ""}`}
              >
                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-xl font-semibold">{claim ? CRITERION_LABEL[claim.criterion] : "Claim"}</span>
                  <span className="text-base text-[#ffc95c]">{DISCREPANCY_LABEL[d.type]}</span>
                  <span
                    className="ml-auto rounded-full px-3 py-0.5 text-sm font-semibold"
                    style={{ color: res.color, backgroundColor: alpha(res.color, 12) }}
                  >
                    {res.label}
                  </span>
                </div>
                <p className="text-lg leading-snug text-[color:var(--muted)]">{d.description}</p>
                <p className="mt-3 border-l-4 border-[color:var(--accent)] pl-4 text-xl leading-snug">{d.question}</p>
                {d.requestedDocument && (
                  <p className="mt-2 text-base text-[color:var(--dim)]">Requested: {d.requestedDocument}</p>
                )}
                {d.applicantResponse && (
                  <p className="mt-2 text-lg text-[color:var(--muted)] italic">“{d.applicantResponse}”</p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
