/**
 * Form state + conversion + validation for the intake form.
 *
 * Inputs hold plain strings/booleans while the user types. These helpers turn
 * them into the typed objects defined in src/lib/schemas.ts (numbers, string
 * lists, nested objects) and validate with those same zod schemas — so the
 * browser and the API apply exactly the same rules.
 */
import type { ZodError } from "zod";
import {
  ApplicantInputSchema,
  ApplicationSubmissionSchema,
  CRITERIA,
  CRITERION_ENTRY_SCHEMAS,
  type ApplicationSubmission,
  type Criterion,
} from "@/lib/schemas";
import { ABOUT_FIELDS, CRITERION_STEPS, type FieldDef, type StepId } from "./form-config";

// ── State shape ──────────────────────────────────────────────────────────────

export type Values = Record<string, string | boolean>;
export type Entry = { key: string; values: Values }; // key = stable React key
export type CriterionState = { applies: "yes" | "no" | null; entries: Entry[] };
export type CvState = { fileName: string; text: string; pages: number; truncated: boolean };

export type FormState = {
  about: Values;
  cv: CvState | null;
  criteria: Record<Criterion, CriterionState>;
  additionalInfo: string;
};

/** Errors keyed by field key (About step) or `${entryKey}.${fieldKey}` (criterion steps). */
export type FieldErrors = Record<string, string>;
/** Step-level message, e.g. "Choose Yes or No". */
export const STEP_ERROR = "_step";

const newKey = () => crypto.randomUUID();

/** Builds a { awards: …, membership: …, … } object with one value per criterion. */
function perCriterion<T>(make: (c: Criterion) => T): Record<Criterion, T> {
  return Object.fromEntries(CRITERIA.map((c) => [c, make(c)])) as Record<Criterion, T>;
}

function emptyValues(fields: FieldDef[]): Values {
  return Object.fromEntries(
    fields.map((f) => [f.key, f.type === "checkbox" ? false : (f.defaultValue ?? "")]),
  );
}

export function newEntry(criterion: Criterion): Entry {
  return { key: newKey(), values: emptyValues(CRITERION_STEPS[criterion].fields) };
}

export function emptyFormState(): FormState {
  return {
    about: emptyValues(ABOUT_FIELDS),
    cv: null,
    criteria: perCriterion((): CriterionState => ({ applies: null, entries: [] })),
    additionalInfo: "",
  };
}

// ── Converting between input values and typed objects ────────────────────────

/** "github.com/me" → "https://github.com/me" */
function normalizeUrl(s: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
}

function convert(def: FieldDef, raw: string | boolean | undefined): unknown {
  if (def.type === "checkbox") return raw === true;
  const s = typeof raw === "string" ? raw.trim() : "";
  if (def.type === "list") {
    const items = s.split("\n").map((x) => x.trim()).filter(Boolean);
    return def.listOf === "url" ? items.map(normalizeUrl) : items;
  }
  if (s === "") return undefined;
  if (def.type === "number") {
    const n = Number(s.replace(/[,\s]/g, "")); // accept "1,200"
    return Number.isFinite(n) ? n : s; // a non-number string makes zod say "Enter a number"
  }
  if (def.type === "url") return normalizeUrl(s);
  return s;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let cur = obj;
  for (const part of parts.slice(0, -1)) {
    cur[part] ??= {};
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (cur, part) => (cur && typeof cur === "object" ? (cur as Record<string, unknown>)[part] : undefined),
    obj,
  );
}

/** Input values → plain object shaped like the zod schema (empty fields left out). */
export function valuesToObject(fields: FieldDef[], values: Values): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = convert(f, values[f.key]);
    if (v !== undefined) setPath(out, f.key, v);
  }
  return out;
}

/** Typed object → input values (used by "Load demo applicant"). */
export function objectToValues(fields: FieldDef[], obj: unknown): Values {
  return Object.fromEntries(
    fields.map((f) => {
      const v = getPath(obj, f.key);
      if (f.type === "checkbox") return [f.key, v === true];
      if (f.type === "list") return [f.key, Array.isArray(v) ? v.join("\n") : ""];
      return [f.key, v === undefined || v === null ? "" : String(v)];
    }),
  );
}

export function fromSubmission(sub: ApplicationSubmission): FormState {
  return {
    about: objectToValues(ABOUT_FIELDS, sub.applicant),
    cv: null,
    criteria: perCriterion((c): CriterionState => {
      const entries = sub.criteria[c] as unknown[];
      return {
        applies: entries.length > 0 ? "yes" : "no",
        entries: entries.map((e) => ({ key: newKey(), values: objectToValues(CRITERION_STEPS[c].fields, e) })),
      };
    }),
    additionalInfo: sub.applicant.additionalInfo ?? "",
  };
}

function applicantObject(state: FormState) {
  return {
    ...valuesToObject(ABOUT_FIELDS, state.about),
    cvText: state.cv?.text,
    additionalInfo: state.additionalInfo.trim() || undefined,
  };
}

function entryObjects(state: FormState, criterion: Criterion) {
  const { applies, entries } = state.criteria[criterion];
  if (applies !== "yes") return [];
  return entries.map((e) => valuesToObject(CRITERION_STEPS[criterion].fields, e.values));
}

// ── Validation ───────────────────────────────────────────────────────────────

type Issue = ZodError["issues"][number];

function friendlyMessage(issue: Issue): string {
  switch (issue.code) {
    case "invalid_type":
      if (issue.message.includes("received undefined")) return "Required";
      return issue.expected === "number" ? "Enter a number" : "Required";
    case "too_small":
      if (issue.origin === "string") return "Required";
      return issue.origin === "number" ? `Must be at least ${issue.minimum}` : issue.message;
    case "too_big":
      return issue.origin === "number" ? `Must be at most ${issue.maximum}` : issue.message;
    case "invalid_format":
      return issue.format === "email" ? "Enter a valid email address" : "Check the format";
    case "invalid_value":
      return "Choose one of the options";
    default:
      return issue.message;
  }
}

function toFieldErrors(issues: Issue[], fields: FieldDef[], prefix = ""): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const path = issue.path.map(String).join(".");
    const field = fields.find((f) => path === f.key || path.startsWith(`${f.key}.`));
    const key = prefix + (field?.key ?? STEP_ERROR);
    errors[key] ??= friendlyMessage(issue);
  }
  return errors;
}

/** Fields marked `required` in the form config that zod allows to be empty (e.g. scholarly titles). */
function requiredErrors(fields: FieldDef[], obj: Record<string, unknown>, prefix = ""): FieldErrors {
  const errors: FieldErrors = {};
  for (const f of fields) {
    if (!f.required) continue;
    const v = getPath(obj, f.key);
    if (v === undefined || (Array.isArray(v) && v.length === 0)) errors[prefix + f.key] = "Required";
  }
  return errors;
}

export function validateStep(step: StepId, state: FormState): FieldErrors {
  if (step === "about") {
    const obj = applicantObject(state);
    const result = ApplicantInputSchema.safeParse(obj);
    return {
      ...requiredErrors(ABOUT_FIELDS, obj),
      ...(result.success ? {} : toFieldErrors(result.error.issues, ABOUT_FIELDS)),
    };
  }
  if (step === "anything" || step === "review") return {};

  const { applies, entries } = state.criteria[step];
  if (applies === null) return { [STEP_ERROR]: "Choose Yes or No to continue" };
  if (applies === "no") return {};
  if (entries.length === 0) return { [STEP_ERROR]: "Add at least one entry, or choose No" };

  const fields = CRITERION_STEPS[step].fields;
  const schema = CRITERION_ENTRY_SCHEMAS[step];
  let errors: FieldErrors = {};
  for (const entry of entries) {
    const obj = valuesToObject(fields, entry.values);
    const result = schema.safeParse(obj);
    errors = {
      ...errors,
      ...requiredErrors(fields, obj, `${entry.key}.`),
      ...(result.success ? {} : toFieldErrors(result.error.issues, fields, `${entry.key}.`)),
    };
  }
  return errors;
}

/**
 * Validates every step. Returns the ready-to-send submission when everything
 * is valid, plus the errors per step (for the Review page).
 */
export function validateAll(state: FormState): {
  submission: ApplicationSubmission | null;
  stepErrors: Partial<Record<StepId, FieldErrors>>;
} {
  const stepErrors: Partial<Record<StepId, FieldErrors>> = {};
  for (const step of ["about", ...CRITERIA] as StepId[]) {
    const errors = validateStep(step, state);
    if (Object.keys(errors).length > 0) stepErrors[step] = errors;
  }
  if (Object.keys(stepErrors).length > 0) return { submission: null, stepErrors };

  const result = ApplicationSubmissionSchema.safeParse({
    applicant: applicantObject(state),
    criteria: Object.fromEntries(CRITERIA.map((c) => [c, entryObjects(state, c)])),
  });
  return { submission: result.success ? result.data : null, stepErrors };
}
