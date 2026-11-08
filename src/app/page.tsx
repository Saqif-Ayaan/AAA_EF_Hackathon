import Link from "next/link";
import { connection } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { applicants } from "@/db/schema";

export default async function Home() {
  await connection(); // read the database on every visit, not at build time
  const cases = await db
    .select({
      id: applicants.id,
      name: applicants.name,
      currentRole: applicants.currentRole,
      currentOrganization: applicants.currentOrganization,
      createdAt: applicants.createdAt,
    })
    .from(applicants)
    .orderBy(desc(applicants.createdAt))
    .limit(10);

  return (
    <main className="mx-auto max-w-2xl px-4 py-16 text-slate-900">
      <h1 className="text-4xl font-bold">O-1A case builder</h1>
      <p className="mt-3 text-lg text-slate-600">
        Tell us about your achievements. AI agents verify them against public sources, raise follow-up questions, and
        assemble the strongest evidence-backed O-1A case.
      </p>

      <Link
        href="/apply"
        className="mt-8 inline-block rounded-md bg-indigo-600 px-6 py-3 text-lg font-semibold text-white shadow hover:bg-indigo-700"
      >
        Start an application →
      </Link>
      <p className="mt-2 text-sm text-slate-500">
        On the form, <strong>Load demo applicant</strong> fills in the demo profile; submitting opens the live dashboard.
      </p>

      {cases.length > 0 && (
        <section className="mt-14">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Existing cases</h2>
          <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
            {cases.map((c) => (
              <li key={c.id}>
                <Link href={`/case/${c.id}`} className="flex items-baseline justify-between gap-4 px-4 py-3 hover:bg-slate-50">
                  <span>
                    <span className="font-semibold">{c.name}</span>
                    <span className="ml-2 text-sm text-slate-500">
                      {c.currentRole}, {c.currentOrganization}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm text-slate-400">{c.createdAt.slice(0, 16).replace("T", " ")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
