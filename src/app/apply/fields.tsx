"use client";

import { useState } from "react";
import type { CvExtractResponse } from "@/app/api/cv/route";
import type { FieldDef } from "./form-config";
import type { CvState } from "./form-state";

const inputBase =
  "w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2";
const inputOk = "border-slate-300 focus:border-indigo-500 focus:ring-indigo-200";
const inputErr = "border-red-500 focus:border-red-500 focus:ring-red-200";

export function isWide(def: FieldDef) {
  return def.wide || def.type === "textarea" || def.type === "list" || def.type === "checkbox";
}

export function Field({
  def,
  id,
  value,
  error,
  onChange,
}: {
  def: FieldDef;
  id: string;
  value: string | boolean;
  error?: string;
  onChange: (value: string | boolean) => void;
}) {
  const describedBy = [def.help && `${id}-help`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  const cls = `${inputBase} ${error ? inputErr : inputOk}`;
  const text = typeof value === "string" ? value : "";

  const help = def.help && (
    <p id={`${id}-help`} className="mt-1 text-xs text-slate-500">
      {def.help}
    </p>
  );
  const errorText = error && (
    <p id={`${id}-error`} className="mt-1 text-xs font-medium text-red-600">
      {error}
    </p>
  );

  if (def.type === "checkbox") {
    return (
      <div className={isWide(def) ? "sm:col-span-2" : undefined}>
        <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            aria-describedby={describedBy}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-sm font-medium text-slate-800">{def.label}</span>
        </label>
        <div className="pl-7">
          {help}
          {errorText}
        </div>
      </div>
    );
  }

  let control: React.ReactNode;
  if (def.type === "textarea" || def.type === "list") {
    control = (
      <textarea
        id={id}
        rows={def.type === "list" ? 3 : 4}
        value={text}
        placeholder={def.placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={describedBy}
        className={cls}
      />
    );
  } else if (def.type === "select") {
    control = (
      <select
        id={id}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={describedBy}
        className={cls}
      >
        <option value="">Choose…</option>
        {def.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else {
    control = (
      <input
        id={id}
        type={def.type === "number" ? "text" : def.type}
        inputMode={def.type === "number" ? "decimal" : undefined}
        value={text}
        placeholder={def.placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={describedBy}
        className={cls}
      />
    );
  }

  return (
    <div className={isWide(def) ? "sm:col-span-2" : undefined}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-800">
        {def.label}
        {def.required && <span className="text-red-600"> *</span>}
      </label>
      {control}
      {help}
      {errorText}
    </div>
  );
}

export function CvUpload({ cv, onChange }: { cv: CvState | null; onChange: (cv: CvState | null) => void }) {
  const [status, setStatus] = useState<"idle" | "uploading">("idle");
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    setStatus("uploading");
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/cv", { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as Partial<CvExtractResponse> & { error?: string };
      if (!res.ok || typeof data.text !== "string") {
        setError(data.error ?? "Couldn't read that PDF");
        return;
      }
      onChange({ fileName: file.name, text: data.text, pages: data.pages ?? 0, truncated: !!data.truncated });
    } catch {
      setError("Couldn't reach the server. Is `npm run dev` running?");
    } finally {
      setStatus("idle");
    }
  }

  if (cv) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium text-emerald-900">
            ✓ {cv.fileName} — {cv.pages} page{cv.pages === 1 ? "" : "s"}, {cv.text.length.toLocaleString()} characters
            extracted{cv.truncated ? " (trimmed to the first 50,000)" : ""}
          </span>
          <button type="button" onClick={() => onChange(null)} className="text-emerald-800 underline">
            Remove
          </button>
        </div>
        <details className="mt-2">
          <summary className="cursor-pointer text-emerald-800">Preview extracted text</summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-xs text-slate-700">
            {cv.text.slice(0, 2000)}
            {cv.text.length > 2000 ? "\n…" : ""}
          </pre>
        </details>
      </div>
    );
  }

  return (
    <div>
      <label htmlFor="cv-upload" className="mb-1 block text-sm font-medium text-slate-800">
        CV (PDF, optional)
      </label>
      <input
        id="cv-upload"
        type="file"
        accept="application/pdf,.pdf"
        disabled={status === "uploading"}
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          e.target.value = ""; // allow re-selecting the same file
        }}
        className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100"
      />
      <p className="mt-1 text-xs text-slate-500">
        {status === "uploading" ? "Reading your CV…" : "We extract the text so our agents can cross-check it."}
      </p>
      {error && <p className="mt-1 text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}
