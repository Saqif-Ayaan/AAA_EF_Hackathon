# O-1A Intake → Vetting → Case Builder

A structured O-1A intake that verifies an applicant's achievements online (with sources), surfaces discrepancies and follow-up questions, and assembles an evidence-backed O-1A case for a separate scoring agent. Full plan: [`O1_BUILD_SPEC.md`](O1_BUILD_SPEC.md).

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in your keys (never commit them — this repo is public)
npm run db:push              # creates local.db with all tables
npm run dev                  # http://localhost:3000
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the app locally |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run db:push` | Apply `src/db/schema.ts` to the local SQLite database |
| `npm run db:studio` | Browse the database in the browser |

## Where things live

| Path | What |
|---|---|
| `src/lib/schemas.ts` | **The data contract.** Every zod schema (form, claims, findings, discrepancies, case, score, events). Only edited on `main`. |
| `src/db/schema.ts` | Drizzle tables (reuse the enums from `schemas.ts`) |
| `src/db/index.ts` | Database connection (`import { db } from "@/db"`) |
| `src/mastra/index.ts` | Mastra instance — agents and the workflow get registered here |

## Scoring agent handoff

The scorer reads `GET /api/cases/[id]/bundle` (shape: `CaseBundleSchema`) and posts `POST /api/cases/[id]/score` (shape: `ScoreInputSchema`). Both are defined in `src/lib/schemas.ts`.

## Demo applicant

"Load demo applicant" on `/apply` calls `GET /api/demo-applicant`, which serves `demo/applicant.local.json` if it exists, otherwise the fictional placeholder in `src/lib/demo-applicant.ts`. The local file holds a real person's details, so it is **gitignored and must never be committed** (this repo is public). Copy it between machines/worktrees by hand, like `.env`.
