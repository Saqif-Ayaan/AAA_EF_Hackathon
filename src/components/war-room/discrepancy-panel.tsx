import Link from "next/link";
import type { Discrepancy } from "@/lib/schemas";
import type { WarRoomClaim } from "@/lib/war-room";
import type { AgentView } from "./derive";
import { CRITERION_LABEL, DISCREPANCY_LABEL, RESOLUTION_STYLE } from "./meta";
import { StatusPill } from "./status-pill";
import styles from "./styles";
import { Label, SectionTitle } from "./ui";

const FRESH_MS = 3000;

export function DiscrepancyPanel({
  discrepancies,
  claims,
  questioner,
  resolver,
  followupHref,
  now,
}: {
  discrepancies: Discrepancy[];
  claims: WarRoomClaim[];
  questioner: AgentView;
  /** Classifies the applicant's answers on the follow-up page. */
  resolver: AgentView;
  /** Link to /case/[id]/followup, or null in replay mode. */
  followupHref: string | null;
  now: number;
}) {
  const claimById = new Map(claims.map((c) => [c.id, c]));
  const open = discrepancies.filter((d) => d.resolution === "open").length;

  return (
    <section
      id="discrepancies"
      aria-labelledby="discrepancies-title"
      className={`${styles.panel} flex min-w-0 scroll-mt-20 flex-col p-6`}
    >
      <SectionTitle
        id="discrepancies-title"
        title="Questions"
        sub={discrepancies.length ? `${open} open` : "Raised when a claim isn't fully corroborated"}
        right={
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-2">
              <Label>Questioner</Label>
              <StatusPill status={questioner.status} />
            </span>
            {resolver.eventCount > 0 && (
              <span className="flex items-center gap-2">
                <Label>Resolver</Label>
                <StatusPill status={resolver.status} />
              </span>
            )}
          </div>
        }
      />

      {discrepancies.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[color:var(--line)] p-8 text-center text-sm text-[color:var(--dim)]">
          No questions yet.
        </p>
      ) : (
        <ol className="divide-y divide-[color:var(--line)]">
          {discrepancies.map((d) => {
            const claim = claimById.get(d.claimId);
            const res = RESOLUTION_STYLE[d.resolution];
            const fresh = now - Date.parse(d.createdAt) < FRESH_MS;
            return (
              <li key={d.id} className={`py-4 first:pt-0 last:pb-0 ${fresh ? styles.enter : ""}`}>
                <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="font-medium text-[color:var(--text)]">
                    {claim ? CRITERION_LABEL[claim.criterion] : "Claim"}
                  </span>
                  <span className="text-[color:var(--dim)]">{DISCREPANCY_LABEL[d.type]}</span>
                  <span className="ml-auto flex items-center gap-1.5 font-medium" style={{ color: res.color }}>
                    <span className="size-2 rounded-full" style={{ backgroundColor: res.color }} aria-hidden />
                    {res.label}
                  </span>
                </div>
                <p className="text-sm leading-snug text-[color:var(--muted)]">{d.description}</p>
                <p className="mt-2 text-[0.95rem] leading-snug font-medium">{d.question}</p>
                {d.requestedDocument && (
                  <p className="mt-1.5 text-xs text-[color:var(--dim)]">Helpful to include: {d.requestedDocument}</p>
                )}
                {d.applicantResponse && (
                  <p className="mt-2 border-l-2 border-[color:var(--line)] pl-3 text-sm text-[color:var(--muted)]">
                    {d.applicantResponse}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {followupHref && open > 0 && (
        <Link href={followupHref} className={`${styles.button} mt-5 self-start px-4 py-2 text-sm`}>
          Resolve {open === 1 ? "question" : `${open} questions`}
        </Link>
      )}
    </section>
  );
}
