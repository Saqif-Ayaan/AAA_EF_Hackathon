/**
 * Records everything stored for one case into replays/<id>.json, so the war
 * room can play it back with /case/<id>?replay=1 (the demo fallback).
 *
 *   npm run replay:save                 # case "demo"
 *   npm run replay:save -- --id my-case
 *
 * Typical flow: npm run mock → click "Build case" → wait for the score → save.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../src/db";
import { applicants, cases, claims, discrepancies, events, findings, scores } from "../src/db/schema";
import { ReplayFileSchema, SAFE_CASE_ID } from "../src/lib/war-room";

const { values: args } = parseArgs({
  options: { id: { type: "string", default: "demo" }, port: { type: "string", default: "3001" } },
});
const id = args.id;

async function main() {
  if (!SAFE_CASE_ID.test(id)) throw new Error(`"${id}" can't be used as a replay file name`);

  const [applicant] = await db
    .select({
      id: applicants.id,
      name: applicants.name,
      alternateNames: applicants.alternateNames,
      field: applicants.field,
      currentRole: applicants.currentRole,
      currentOrganization: applicants.currentOrganization,
      createdAt: applicants.createdAt,
    })
    .from(applicants)
    .where(eq(applicants.id, id));
  if (!applicant) throw new Error(`No case "${id}" in the database — run the mock (or a real intake) first`);

  const claimRows = await db
    .select({ id: claims.id, criterion: claims.criterion, summary: claims.summary })
    .from(claims)
    .where(eq(claims.applicantId, id))
    .orderBy(sql`rowid`);
  const claimIds = claimRows.map((c) => c.id);

  const [eventRows, findingRows, discrepancyRows, caseRows] = await Promise.all([
    db.select().from(events).where(eq(events.applicantId, id)).orderBy(asc(events.id)),
    claimIds.length
      ? db.select().from(findings).where(inArray(findings.claimId, claimIds)).orderBy(asc(findings.createdAt), sql`rowid`)
      : Promise.resolve([]),
    claimIds.length
      ? db
          .select()
          .from(discrepancies)
          .where(inArray(discrepancies.claimId, claimIds))
          .orderBy(asc(discrepancies.createdAt), sql`rowid`)
      : Promise.resolve([]),
    db.select().from(cases).where(eq(cases.applicantId, id)).orderBy(asc(cases.createdAt), sql`rowid`),
  ]);
  const scoreRows = caseRows.length
    ? await db
        .select()
        .from(scores)
        .where(inArray(scores.caseId, caseRows.map((c) => c.id)))
        .orderBy(asc(scores.createdAt), sql`rowid`)
    : [];

  const file = ReplayFileSchema.parse({
    version: 1,
    caseId: id,
    savedAt: new Date().toISOString(),
    applicant,
    claims: claimRows,
    events: eventRows,
    findings: findingRows,
    discrepancies: discrepancyRows,
    cases: caseRows,
    scores: scoreRows,
  });

  const out = path.join(process.cwd(), "replays", `${id}.json`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(file, null, 2)}\n`);

  const span = eventRows.length
    ? (Date.parse(eventRows[eventRows.length - 1].createdAt) - Date.parse(eventRows[0].createdAt)) / 1000
    : 0;
  console.log(`Saved ${path.relative(process.cwd(), out)}`);
  console.log(
    `  ${eventRows.length} events over ${span.toFixed(0)}s · ${findingRows.length} findings · ${discrepancyRows.length} discrepancies · ${caseRows.length} case(s) · ${scoreRows.length} score(s)`,
  );
  if (!caseRows.length) console.log("  (no dossier yet — click “Build case” before saving if you want it in the replay)");
  console.log(`  Play it: http://localhost:${args.port}/case/${id}?replay=1`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
