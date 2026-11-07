"use client";

import Link from "next/link";
import type { SubmitApplicationResponse } from "@/app/api/applications/route";
import { buildClaims } from "@/lib/claims";
import { CRITERION_LABELS } from "@/lib/labels";
import { CRITERIA, type ApplicationSubmission, type Criterion } from "@/lib/schemas";
import { STEPS, type StepId } from "./form-config";
import type { FieldErrors, FormState } from "./form-state";

export type SubmitStatus =
  | { state: "idle" }
  | { state: "submitting" }
  | { state: "error"; message: string; details?: { path: string; message: string }[] };

export function ReviewStep({
  form,
  submission,
  stepErrors,
  submitStatus,
  onEdit,
  onSubmit,
}: {
  form: FormState;
  submission: ApplicationSubmission | null;
  stepErrors: Partial<Record<StepId, FieldErrors>>;
  submitStatus: SubmitStatus;
  onEdit: (step: StepId) => void;
  onSubmit: () => void;
}) {
  const problemSteps = STEPS.filter((s) => stepErrors[s.id]);

  if (!submission) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
        <h3 className="font-semibold text-amber-900">A few sections need attention before you can submit</h3>
        <ul className="mt-3 space-y-2">
          {problemSteps.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-4 text-sm">
              <span className="text-amber-900">
                {s.title}: {Object.values(stepErrors[s.id] ?? {})[0]}
              </span>
              <button type="button" onClick={() => onEdit(s.id)} className="font-medium text-indigo-700 underline">
                Fix
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const { applicant } = submission;
  const claims = buildClaims(submission.criteria);
  const links = Object.entries(applicant.links).filter(([, url]) => url);

  return (
    <div className="space-y-6">
      <Section title="About you" onEdit={() => onEdit("about")}>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
          <Row label="Name" value={applicant.name} />
          {applicant.alternateNames.length > 0 && <Row label="Also known as" value={applicant.alternateNames.join(", ")} />}
          <Row label="Email" value={applicant.email} />
          {applicant.phone && <Row label="Phone" value={applicant.phone} />}
          <Row label="AI follow-up call" value={applicant.consentToCall ? "Yes, I consent" : "No — email me instead"} />
          <Row label="Field" value={applicant.field} />
          <Row label="Current role" value={`${applicant.currentRole}, ${applicant.currentOrganization}`} />
          <Row label="Planned US work" value={applicant.usWorkPlan} />
          <Row label="Profiles" value={links.length ? links.map(([, url]) => url).join("\n") : "None added"} />
          <Row label="CV" value={form.cv ? `${form.cv.fileName} (${form.cv.text.length.toLocaleString()} characters)` : "Not uploaded"} />
        </dl>
      </Section>

      <Section title={`Your achievements — ${claims.length} claim${claims.length === 1 ? "" : "s"} to verify`}>
        {claims.length === 0 ? (
          <p className="text-sm text-slate-600">
            You haven&apos;t added any achievements yet. An O-1A case needs evidence for at least 3 of the 8 criteria.
          </p>
        ) : (
          <ul className="space-y-3">
            {CRITERIA.filter((c) => claims.some((cl) => cl.criterion === c)).map((c) => (
              <CriterionClaims
                key={c}
                criterion={c}
                summaries={claims.filter((cl) => cl.criterion === c).map((cl) => cl.summary)}
                onEdit={() => onEdit(c)}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Anything else" onEdit={() => onEdit("anything")}>
        <p className="whitespace-pre-wrap text-sm text-slate-700">{applicant.additionalInfo || "Nothing added"}</p>
      </Section>

      {submitStatus.state === "error" && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">{submitStatus.message}</p>
          {submitStatus.details && (
            <ul className="mt-2 list-disc pl-5">
              {submitStatus.details.slice(0, 5).map((d) => (
                <li key={d.path}>
                  {d.path}: {d.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={submitStatus.state === "submitting"}
        className="w-full rounded-md bg-indigo-600 px-4 py-3 text-base font-semibold text-white shadow hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60"
      >
        {submitStatus.state === "submitting" ? "Submitting…" : "Submit application"}
      </button>
    </div>
  );
}

function Section({ title, onEdit, children }: { title: string; onEdit?: () => void; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-slate-900">{title}</h3>
        {onEdit && (
          <button type="button" onClick={onEdit} className="text-sm font-medium text-indigo-700 underline">
            Edit
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="whitespace-pre-wrap text-slate-900">{value}</dd>
    </>
  );
}

function CriterionClaims({ criterion, summaries, onEdit }: { criterion: Criterion; summaries: string[]; onEdit: () => void }) {
  return (
    <li>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-800">{CRITERION_LABELS[criterion]}</span>
        <button type="button" onClick={onEdit} className="text-xs font-medium text-indigo-700 underline">
          Edit
        </button>
      </div>
      <ul className="mt-1 space-y-1">
        {summaries.map((s, i) => (
          <li key={i} className="rounded bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {s}
          </li>
        ))}
      </ul>
    </li>
  );
}

export function SubmittedPanel({ result, onReset }: { result: SubmitApplicationResponse; onReset: () => void }) {
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-12">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6">
        <h1 className="text-2xl font-bold text-emerald-900">Application received</h1>
        <p className="mt-2 text-emerald-900">
          We saved your application and created <strong>{result.claims.length}</strong> claim
          {result.claims.length === 1 ? "" : "s"} for our agents to verify.
        </p>
        <p className="mt-1 text-xs text-emerald-800">Applicant ID: {result.applicantId}</p>
      </div>

      <ul className="space-y-2">
        {result.claims.map((c) => (
          <li key={c.id} className="rounded-md border border-slate-200 bg-white p-3 text-sm">
            <span className="font-semibold text-slate-800">{CRITERION_LABELS[c.criterion as Criterion] ?? c.criterion}</span>
            <p className="text-slate-700">{c.summary}</p>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-3">
        {/* TODO(after ui merge): redirect straight to the war room instead of showing this panel. */}
        <Link
          href={`/case/${result.applicantId}`}
          className="rounded-md bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700"
        >
          Open war room →
        </Link>
        <button type="button" onClick={onReset} className="rounded-md border border-slate-300 bg-white px-4 py-2 font-medium text-slate-800 hover:bg-slate-50">
          Start a new application
        </button>
      </div>
    </div>
  );
}
