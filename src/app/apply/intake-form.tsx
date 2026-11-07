"use client";

import { useMemo, useState } from "react";
import type { SubmitApplicationResponse } from "@/app/api/applications/route";
import type { DemoApplicantResponse } from "@/app/api/demo-applicant/route";
import type { Criterion } from "@/lib/schemas";
import { ABOUT_SECTIONS, CRITERION_STEPS, STEPS, type StepId } from "./form-config";
import { CvUpload, Field } from "./fields";
import {
  STEP_ERROR,
  emptyFormState,
  fromSubmission,
  newEntry,
  validateAll,
  validateStep,
  type FieldErrors,
  type FormState,
} from "./form-state";
import { ReviewStep, SubmittedPanel, type SubmitStatus } from "./review-step";

export function IntakeForm() {
  const [form, setForm] = useState<FormState>(emptyFormState);
  const [stepIndex, setStepIndex] = useState(0);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>({ state: "idle" });
  const [submitted, setSubmitted] = useState<SubmitApplicationResponse | null>(null);
  const [demoState, setDemoState] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });

  const step = STEPS[stepIndex];
  const isReview = step.id === "review";
  // Only computed on the Review step, where it's needed.
  const review = useMemo(() => (isReview ? validateAll(form) : null), [isReview, form]);

  // ── navigation ──
  function goTo(id: StepId) {
    setErrors({});
    setStepIndex(STEPS.findIndex((s) => s.id === id));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function next() {
    const stepErrors = validateStep(step.id, form);
    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors);
      return;
    }
    goTo(STEPS[stepIndex + 1].id);
  }
  function back() {
    goTo(STEPS[stepIndex - 1].id);
  }

  // ── updates ──
  function clearError(key: string) {
    setErrors((e) => {
      if (!(key in e)) return e;
      const rest = { ...e };
      delete rest[key];
      return rest;
    });
  }
  function setAbout(key: string, value: string | boolean) {
    setForm((f) => ({ ...f, about: { ...f.about, [key]: value } }));
    clearError(key);
  }
  function updateCriterion(c: Criterion, update: (cur: FormState["criteria"][Criterion]) => FormState["criteria"][Criterion]) {
    setForm((f) => ({ ...f, criteria: { ...f.criteria, [c]: update(f.criteria[c]) } }));
  }
  function setApplies(c: Criterion, applies: "yes" | "no") {
    updateCriterion(c, (cur) => ({
      applies,
      entries: applies === "yes" && cur.entries.length === 0 ? [newEntry(c)] : cur.entries,
    }));
    clearError(STEP_ERROR);
  }
  function setEntryValue(c: Criterion, entryKey: string, fieldKey: string, value: string | boolean) {
    updateCriterion(c, (cur) => ({
      ...cur,
      entries: cur.entries.map((e) => (e.key === entryKey ? { ...e, values: { ...e.values, [fieldKey]: value } } : e)),
    }));
    clearError(`${entryKey}.${fieldKey}`);
  }

  async function loadDemo() {
    setDemoState({ loading: true, error: null });
    try {
      const res = await fetch("/api/demo-applicant");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDemoState({ loading: false, error: data.error ?? "Couldn't load the demo applicant" });
        return;
      }
      setForm(fromSubmission((data as DemoApplicantResponse).submission));
      setSubmitStatus({ state: "idle" });
      setDemoState({ loading: false, error: null });
      goTo("review");
    } catch {
      setDemoState({ loading: false, error: "Couldn't reach the server. Is `npm run dev` running?" });
    }
  }
  function reset() {
    setForm(emptyFormState());
    setSubmitted(null);
    setSubmitStatus({ state: "idle" });
    goTo("about");
  }

  async function submit() {
    const { submission } = validateAll(form);
    if (!submission) return;
    setSubmitStatus({ state: "submitting" });
    try {
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submission),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitStatus({ state: "error", message: data.error ?? `Submission failed (${res.status})`, details: data.issues });
        return;
      }
      setSubmitted(data as SubmitApplicationResponse);
      window.scrollTo({ top: 0 });
    } catch {
      setSubmitStatus({ state: "error", message: "Couldn't reach the server. Is `npm run dev` running?" });
    }
  }

  if (submitted) return <SubmittedPanel result={submitted} onReset={reset} />;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="text-xl font-bold">O-1A application</h1>
            <p className="text-sm text-slate-600">Tell us about your achievements. We&apos;ll verify them and build your case.</p>
          </div>
          <div className="text-right">
            <button
              type="button"
              onClick={loadDemo}
              disabled={demoState.loading}
              className="rounded-md border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-60"
            >
              {demoState.loading ? "Loading…" : "Load demo applicant"}
            </button>
            {demoState.error && <p className="mt-1 text-xs font-medium text-red-600">{demoState.error}</p>}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 md:grid-cols-[14rem_1fr]">
        <StepNav form={form} currentIndex={stepIndex} onSelect={goTo} />

        <main className="min-w-0">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Step {stepIndex + 1} of {STEPS.length}
            </p>
            <h2 className="mb-5 text-2xl font-bold">{step.title}</h2>

            {step.id === "about" && (
              <AboutStep form={form} errors={errors} onChange={setAbout} onCvChange={(cv) => setForm((f) => ({ ...f, cv }))} />
            )}

            {step.id !== "about" && step.id !== "anything" && step.id !== "review" && (
              <CriterionStep
                criterion={step.id}
                form={form}
                errors={errors}
                onApplies={(a) => setApplies(step.id as Criterion, a)}
                onAdd={() => updateCriterion(step.id as Criterion, (cur) => ({ ...cur, entries: [...cur.entries, newEntry(step.id as Criterion)] }))}
                onRemove={(key) => updateCriterion(step.id as Criterion, (cur) => ({ ...cur, entries: cur.entries.filter((e) => e.key !== key) }))}
                onChange={(entryKey, fieldKey, value) => setEntryValue(step.id as Criterion, entryKey, fieldKey, value)}
              />
            )}

            {step.id === "anything" && (
              <div>
                <label htmlFor="additional-info" className="mb-2 block text-sm font-medium text-slate-800">
                  Is there anything significant about your work that might not appear on your CV?
                </label>
                <textarea
                  id="additional-info"
                  rows={6}
                  value={form.additionalInfo}
                  onChange={(e) => setForm((f) => ({ ...f, additionalInfo: e.target.value }))}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                />
              </div>
            )}

            {isReview && review && (
              <ReviewStep
                form={form}
                submission={review.submission}
                stepErrors={review.stepErrors}
                submitStatus={submitStatus}
                onEdit={goTo}
                onSubmit={submit}
              />
            )}

            {errors[STEP_ERROR] && (
              <p role="alert" className="mt-4 text-sm font-medium text-red-600">
                {errors[STEP_ERROR]}
              </p>
            )}

            <div className="mt-8 flex justify-between border-t border-slate-100 pt-5">
              <button
                type="button"
                onClick={back}
                disabled={stepIndex === 0}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:invisible"
              >
                ← Back
              </button>
              {!isReview && (
                <button
                  type="button"
                  onClick={next}
                  className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                >
                  Next →
                </button>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function StepNav({ form, currentIndex, onSelect }: { form: FormState; currentIndex: number; onSelect: (id: StepId) => void }) {
  return (
    <nav aria-label="Application steps" className="md:sticky md:top-6 md:self-start">
      <ol className="flex gap-2 overflow-x-auto pb-2 md:flex-col md:gap-1 md:overflow-visible md:pb-0">
        {STEPS.map((s, i) => {
          const c = s.id in CRITERION_STEPS ? form.criteria[s.id as Criterion] : null;
          const status = c ? (c.applies === "yes" ? `${c.entries.length} added` : c.applies === "no" ? "Not applicable" : "") : "";
          const current = i === currentIndex;
          return (
            <li key={s.id} className="shrink-0">
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                aria-current={current ? "step" : undefined}
                className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                  current ? "bg-indigo-600 text-white" : "text-slate-700 hover:bg-slate-200"
                }`}
              >
                <span className="font-medium">
                  {i + 1}. {s.title}
                </span>
                {status && (
                  <span className={`hidden text-xs md:block ${current ? "text-indigo-100" : "text-slate-500"}`}>{status}</span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function AboutStep({
  form,
  errors,
  onChange,
  onCvChange,
}: {
  form: FormState;
  errors: FieldErrors;
  onChange: (key: string, value: string | boolean) => void;
  onCvChange: (cv: FormState["cv"]) => void;
}) {
  return (
    <div className="space-y-8">
      {ABOUT_SECTIONS.map((section) => (
        <fieldset key={section.title}>
          <legend className="text-base font-semibold text-slate-900">{section.title}</legend>
          {section.description && <p className="mt-1 text-sm text-slate-600">{section.description}</p>}
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {section.fields.map((def) => (
              <Field
                key={def.key}
                def={def}
                id={`about-${def.key}`}
                value={form.about[def.key]}
                error={errors[def.key]}
                onChange={(v) => onChange(def.key, v)}
              />
            ))}
          </div>
        </fieldset>
      ))}
      <fieldset>
        <legend className="mb-3 text-base font-semibold text-slate-900">CV</legend>
        <CvUpload cv={form.cv} onChange={onCvChange} />
      </fieldset>
    </div>
  );
}

function CriterionStep({
  criterion,
  form,
  errors,
  onApplies,
  onAdd,
  onRemove,
  onChange,
}: {
  criterion: Criterion;
  form: FormState;
  errors: FieldErrors;
  onApplies: (applies: "yes" | "no") => void;
  onAdd: () => void;
  onRemove: (entryKey: string) => void;
  onChange: (entryKey: string, fieldKey: string, value: string | boolean) => void;
}) {
  const config = CRITERION_STEPS[criterion];
  const { applies, entries } = form.criteria[criterion];

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="text-base font-medium text-slate-900">{config.question}</legend>
        <div className="mt-3 flex gap-3">
          {(["yes", "no"] as const).map((option) => (
            <label
              key={option}
              className={`flex cursor-pointer items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium ${
                applies === option ? "border-indigo-600 bg-indigo-50 text-indigo-800" : "border-slate-300 bg-white text-slate-700"
              }`}
            >
              <input
                type="radio"
                name={`applies-${criterion}`}
                checked={applies === option}
                onChange={() => onApplies(option)}
                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500"
              />
              {option === "yes" ? "Yes, this applies to me" : "No"}
            </label>
          ))}
        </div>
      </fieldset>

      {config.note && applies === "yes" && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{config.note}</p>
      )}

      {applies === "yes" && (
        <div className="space-y-4">
          {entries.map((entry, i) => (
            <div key={entry.key} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold capitalize text-slate-800">
                  {config.entryNoun} {i + 1}
                </h3>
                <button type="button" onClick={() => onRemove(entry.key)} className="text-sm text-red-700 underline">
                  Remove
                </button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {config.fields.map((def) => (
                  <Field
                    key={def.key}
                    def={def}
                    id={`${criterion}-${entry.key}-${def.key}`}
                    value={entry.values[def.key]}
                    error={errors[`${entry.key}.${def.key}`]}
                    onChange={(v) => onChange(entry.key, def.key, v)}
                  />
                ))}
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={onAdd}
            className="rounded-md border border-dashed border-slate-400 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            + Add {entries.length === 0 ? "" : "another "}
            {config.entryNoun}
          </button>
        </div>
      )}
    </div>
  );
}
