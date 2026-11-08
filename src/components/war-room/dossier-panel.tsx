import type { CaseRecord } from "@/lib/schemas";
import type { AgentView } from "./derive";
import { CRITERION_LABEL, splitUrl } from "./meta";
import { StatusPill } from "./status-pill";
import styles from "./styles";
import { Label, SectionTitle } from "./ui";

const FRESH_MS = 4000;

export const STRENGTH_STYLE = {
  strong: { label: "Strong", color: "#15803d" },
  moderate: { label: "Moderate", color: "#2563eb" },
  weak: { label: "Weak", color: "#b45309" },
} as const;

export type BuildControl = {
  onBuild: () => void;
  building: boolean;
  /** Why the button is disabled, or null when it can be pressed. */
  disabledReason: string | null;
  error: string | null;
};

export function BuildCaseButton({
  control,
  label = "Build case",
  variant = "solid",
}: {
  control: BuildControl;
  label?: string;
  variant?: "solid" | "ghost";
}) {
  return (
    <button
      type="button"
      onClick={control.onBuild}
      disabled={control.building || control.disabledReason !== null}
      title={control.disabledReason ?? undefined}
      className={`${variant === "solid" ? styles.button : styles.buttonGhost} px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {control.building ? "Building…" : label}
    </button>
  );
}

export function DossierPanel({
  caseRecord,
  caseBuilder,
  build,
  bundleHref,
  now,
}: {
  caseRecord: CaseRecord | null;
  caseBuilder: AgentView;
  build: BuildControl;
  /** Download link for the scorer handoff (CaseBundle), or null in replay mode. */
  bundleHref: string | null;
  now: number;
}) {
  const c = caseRecord?.caseJson ?? null;
  const fresh = caseRecord !== null && now - Date.parse(caseRecord.createdAt) < FRESH_MS;

  return (
    <section id="dossier" aria-labelledby="dossier-title" className={`${styles.panel} min-w-0 scroll-mt-20 p-6`}>
      <SectionTitle
        id="dossier-title"
        title="Case dossier"
        sub={c ? `${c.criteriaArgued.length} of 8 criteria argued` : "Built from verified evidence only"}
        right={
          <div className="flex items-center gap-3">
            <StatusPill status={caseBuilder.status} />
            {c && bundleHref && (
              <a href={bundleHref} download className={`${styles.buttonGhost} px-3 py-1.5 text-sm`}>
                Download bundle
              </a>
            )}
            {c && <BuildCaseButton control={build} label="Rebuild" variant="ghost" />}
          </div>
        }
      />

      {!c ? (
        <div className="rounded-lg border border-dashed border-[color:var(--line)] px-6 py-10 text-center">
          {build.building ? (
            <>
              <p className="font-medium">Building the dossier…</p>
              <p className="mt-1 text-sm text-[color:var(--muted)]">{caseBuilder.currentAction ?? "Starting"}</p>
              <div className={`${styles.bar} mx-auto mt-4 h-1 max-w-xs`}>
                <div className={styles.barFill} style={{ width: `${caseBuilder.progress}%`, backgroundColor: "var(--ink)" }} />
              </div>
            </>
          ) : (
            <>
              <p className="font-medium">No dossier yet</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-[color:var(--muted)]">
                Argues the strongest 3–5 criteria with cited exhibits and flags the weak spots.
              </p>
              <div className="mt-5">
                <BuildCaseButton control={build} />
              </div>
              {build.disabledReason && <p className="mt-3 text-xs text-[color:var(--dim)]">{build.disabledReason}</p>}
            </>
          )}
          {build.error && (
            <p role="alert" className="mt-3 text-sm text-[#b91c1c]">
              Build failed: {build.error}
            </p>
          )}
        </div>
      ) : (
        <div key={caseRecord?.id} className={fresh ? styles.enter : undefined}>
          <p className="text-base leading-relaxed">{c.summary}</p>

          <ol className="mt-5 divide-y divide-[color:var(--line)] border-t border-[color:var(--line)]">
            {c.criteriaArgued.map((a) => {
              const st = STRENGTH_STYLE[a.strength];
              return (
                <li key={a.criterion} className="py-5">
                  <div className="mb-2 flex flex-wrap items-center gap-3">
                    <h3 className="text-base font-semibold">{CRITERION_LABEL[a.criterion]}</h3>
                    <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: st.color }}>
                      <span className="size-2 rounded-full" style={{ backgroundColor: st.color }} aria-hidden />
                      {st.label}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-[color:var(--muted)]">{a.argument}</p>

                  <Label className="mt-4 block">Exhibits</Label>
                  <ul className="mt-1.5 space-y-1">
                    {a.exhibits.map((e) => (
                      <li key={e.url} className="text-sm">
                        <a
                          href={e.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-[color:var(--accent)] hover:underline"
                        >
                          {e.label}
                        </a>
                        <span className={`${styles.mono} ml-2 text-xs text-[color:var(--dim)]`}>{splitUrl(e.url).host}</span>
                      </li>
                    ))}
                  </ul>

                  {a.weaknesses.length > 0 && (
                    <>
                      <Label className="mt-4 block">Weaknesses</Label>
                      <ul className="mt-1.5 space-y-1">
                        {a.weaknesses.map((w) => (
                          <li key={w} className="flex gap-2 text-sm leading-snug text-[color:var(--muted)]">
                            <span className="text-[color:var(--dim)]" aria-hidden>
                              –
                            </span>
                            {w}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}
