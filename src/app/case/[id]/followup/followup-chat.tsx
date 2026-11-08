"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CaseDiscrepanciesResponse } from "@/app/api/cases/[id]/discrepancies/route";
import type { FollowupResponse } from "@/app/api/cases/[id]/followup/route";
import type { DiscrepancyWithClaim } from "@/lib/case-data";
import { CRITERION_LABELS, RESOLUTION_LABELS } from "@/lib/labels";
import type { Resolution } from "@/lib/schemas";

const RESOLUTION_STYLES: Record<Resolution, string> = {
  open: "bg-neutral-100 text-neutral-700",
  amended: "bg-sky-100 text-sky-800",
  substantiated: "bg-emerald-100 text-emerald-800",
  reframed: "bg-violet-100 text-violet-800",
  escalated: "bg-amber-100 text-amber-900",
};

export function FollowupChat({ applicantId, applicantName }: { applicantId: string; applicantName: string }) {
  const [items, setItems] = useState<DiscrepancyWithClaim[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({}); // resolver reasoning from this session
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const applyResult = useCallback((result: Awaited<ReturnType<typeof fetchDiscrepancies>>) => {
    if ("error" in result) {
      setLoadError(result.error);
    } else {
      setItems(result.discrepancies);
      setLoadError(null);
    }
  }, []);

  /** Re-fetch after an answer (called from event handlers). */
  const load = useCallback(async () => applyResult(await fetchDiscrepancies(applicantId)), [applicantId, applyResult]);

  // Initial load: state is only set in the promise callback, after the request finishes.
  useEffect(() => {
    let cancelled = false;
    fetchDiscrepancies(applicantId).then((result) => {
      if (!cancelled) applyResult(result);
    });
    return () => {
      cancelled = true;
    };
  }, [applicantId, applyResult]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items, sending, reasons]);

  const current = items?.find((d) => d.resolution === "open") ?? null;
  const total = items?.length ?? 0;
  const answeredCount = items?.filter((d) => d.resolution !== "open").length ?? 0;
  const firstName = applicantName.split(" ")[0];

  async function send() {
    if (!current || sending) return;
    const reply = draft.trim();
    if (!reply) {
      setSendError("Please type a reply first.");
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/cases/${applicantId}/followup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discrepancyId: current.id, reply }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSendError(data.error ?? `Something went wrong (${res.status})`);
        if (res.status === 409) await load(); // already answered elsewhere
        return;
      }
      const result = data as FollowupResponse;
      setReasons((r) => ({ ...r, [result.discrepancyId]: result.reasoning }));
      setDraft("");
      await load();
    } catch {
      setSendError("Couldn't reach the server. Is `npm run dev` running?");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50 text-neutral-900">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto max-w-3xl px-4 py-4">
          <Link href={`/case/${applicantId}`} className="text-sm font-medium text-neutral-900 underline">
            ← Back to the case
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">Follow-up questions</h1>
          <p className="text-sm text-neutral-600">
            {applicantName}
            {total > 0 && ` · ${answeredCount} of ${total} answered`}
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-6">
        <p className="rounded-md bg-neutral-100 px-3 py-2 text-xs text-neutral-900">
          You&apos;re chatting with an AI assistant, not a person. Your answers are saved to your case and reviewed by
          the legal team.
        </p>

        {loadError && (
          <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {loadError}{" "}
            <button type="button" onClick={() => void load()} className="font-medium underline">
              Try again
            </button>
          </div>
        )}

        {items === null && !loadError && <p className="text-neutral-500">Loading your questions…</p>}

        {items !== null && (
          <>
            <AgentBubble>
              {items.length === 0 ? (
                <>Hi {firstName}. Everything we checked lined up — there are no follow-up questions for you.</>
              ) : (
                <>
                  Hi {firstName}. We checked your application against public sources and have{" "}
                  {items.length === 1 ? "one question" : `${items.length} questions`}. Please answer in your own words —
                  links to documents help.
                </>
              )}
            </AgentBubble>

            {items.map((d, i) => {
              if (d.resolution === "open" && d.id !== current?.id) return null;
              return (
                <div key={d.id} className="space-y-3">
                  <AgentBubble>
                    <p className="mb-1 text-xs font-semibold text-neutral-500">
                      Question {i + 1} · {CRITERION_LABELS[d.claim.criterion]}
                    </p>
                    <p className="mb-2 text-sm text-neutral-500">About: {d.claim.summary}</p>
                    <p className="text-lg">{d.question}</p>
                    {d.resolution === "open" && d.requestedDocument && (
                      <p className="mt-2 text-sm text-neutral-600">Helpful to include: {d.requestedDocument}</p>
                    )}
                  </AgentBubble>

                  {d.applicantResponse && <ApplicantBubble>{d.applicantResponse}</ApplicantBubble>}

                  {d.resolution !== "open" && (
                    <div className="flex flex-wrap items-start gap-2 pl-2">
                      <span className={`rounded-full px-3 py-1 text-sm font-semibold ${RESOLUTION_STYLES[d.resolution]}`}>
                        {RESOLUTION_LABELS[d.resolution]}
                      </span>
                      {reasons[d.id] && <p className="flex-1 text-sm text-neutral-600">{reasons[d.id]}</p>}
                    </div>
                  )}
                </div>
              );
            })}

            {sending && (
              <AgentBubble>
                <span className="animate-pulse text-neutral-500">Reviewing your answer…</span>
              </AgentBubble>
            )}

            {items.length > 0 && !current && (
              <AgentBubble>
                <p className="text-lg">That&apos;s everything — thank you. Your answers have been added to your case.</p>
                <Link href={`/case/${applicantId}`} className="mt-2 inline-block font-semibold text-neutral-900 underline">
                  Back to the case →
                </Link>
              </AgentBubble>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </main>

      {current && (
        <footer className="sticky bottom-0 border-t border-neutral-200 bg-white">
          <form
            className="mx-auto max-w-3xl space-y-2 px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            {sendError && (
              <p role="alert" className="text-sm font-medium text-red-600">
                {sendError}
              </p>
            )}
            <div className="flex items-end gap-2">
              <label htmlFor="reply" className="sr-only">
                Your answer
              </label>
              <textarea
                id="reply"
                rows={3}
                value={draft}
                disabled={sending}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="Type your answer… (Enter to send, Shift+Enter for a new line)"
                className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-base focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-200 disabled:bg-neutral-100"
              />
              <button
                type="submit"
                disabled={sending}
                className="rounded-md bg-neutral-900 px-5 py-3 font-semibold text-white hover:bg-neutral-700 disabled:cursor-wait disabled:opacity-60"
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
        </footer>
      )}
    </div>
  );
}

async function fetchDiscrepancies(
  applicantId: string,
): Promise<{ discrepancies: DiscrepancyWithClaim[] } | { error: string }> {
  try {
    const res = await fetch(`/api/cases/${applicantId}/discrepancies`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) return { error: data.error ?? `Request failed (${res.status})` };
    return { discrepancies: (data as CaseDiscrepanciesResponse).discrepancies };
  } catch {
    return { error: "Couldn't load your questions. Is `npm run dev` running?" };
  }
}

function AgentBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div aria-hidden className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-sm font-semibold text-white">
        AI
      </div>
      <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-neutral-200 bg-white px-4 py-3">{children}</div>
    </div>
  );
}

function ApplicantBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-neutral-900 px-4 py-3 text-white">
        {children}
      </div>
    </div>
  );
}
