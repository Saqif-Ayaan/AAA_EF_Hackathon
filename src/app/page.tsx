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
    <main className="mx-auto max-w-2xl px-6 py-24">
      <h1 className="text-3xl font-semibold tracking-tight">O-1A case builder</h1>
      <p className="mt-3 max-w-xl text-base leading-relaxed text-neutral-600">
        Tell us about your achievements. Agents verify them against public sources, raise follow-up questions, and
        assemble the strongest evidence-backed O-1A case.
      </p>

      <Link
        href="/apply"
        className="mt-8 inline-block rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700"
      >
        Start an application
      </Link>

      {cases.length > 0 && (
        <section className="mt-20">
          <h2 className="text-sm font-medium text-neutral-500">Cases</h2>
          <ul className="mt-2 divide-y divide-neutral-200 border-y border-neutral-200">
            {cases.map((c) => (
              <li key={c.id}>
                <Link href={`/case/${c.id}`} className="flex items-baseline justify-between gap-4 py-3 transition-colors hover:text-neutral-500">
                  <span>
                    <span className="font-medium">{c.name}</span>
                    <span className="ml-3 text-sm text-neutral-500">
                      {c.currentRole}, {c.currentOrganization}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-neutral-400">
                    {c.createdAt.slice(0, 16).replace("T", " ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
