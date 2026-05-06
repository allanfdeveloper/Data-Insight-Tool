# SME Alternative Data Assessment MVP

## Overview

A full-stack fintech web application for assessing SME (Small and Medium Enterprise) creditworthiness using alternative data (bank statements). Users upload Excel/CSV files, the system analyzes cash flow, and returns a credit assessment: PASS, REVIEW, or FAIL.

## Run & Operate

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push-force` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run build` — build API server (esbuild CJS bundle)

Required env vars: `DATABASE_URL`, `SESSION_SECRET`

## Stack

- **Monorepo**: pnpm workspaces
- **Node.js**: 24 | **TypeScript**: 5.9
- **Frontend**: React + Vite (`artifacts/sme-assessment`) at path `/`
- **API**: Express 5 (`artifacts/api-server`) at path `/api`
- **Database**: PostgreSQL + Drizzle ORM (`lib/db`)
- **Auth**: Session-based (express-session + bcryptjs + connect-pg-simple)
- **File upload**: multer (memory storage)
- **Excel/CSV parsing**: xlsx library
- **Validation**: Zod (generated via Orval from OpenAPI spec)
- **API codegen**: Orval (from `lib/api-spec/openapi.yaml`)

## Where Things Live

- `lib/db/src/schema/` — DB schema (users, assessments, assessmentConfig)
- `lib/api-spec/openapi.yaml` — OpenAPI source of truth
- `lib/api-zod/` — generated Zod schemas
- `lib/api-client-react/` — generated React Query hooks
- `artifacts/api-server/src/lib/scorecard.ts` — scoring engine
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/sme-assessment/src/pages/` — React page components

## Architecture Decisions

- Contract-first API: OpenAPI spec → Orval codegen → typed Zod schemas + React Query hooks
- Scoring engine accepts a config object loaded from DB at upload time — zero-redeploy threshold changes
- Single-row `assessment_config` table; `getOrCreateConfig()` seeds defaults on first access
- Scorecard stored as JSONB in `assessments.scorecard` — full breakdown including triggered rules and config snapshot persisted with each assessment
- Session table auto-created by connect-pg-simple (`createTableIfMissing: true`)

## Product

1. **User auth** — signup/login with bcrypt, cookie session
2. **Dashboard** — upload Excel/CSV, view history, summary stats
3. **Assessment detail** — full scorecard breakdown: factor scores, irregularity flags, triggered rules, config snapshot
4. **Admin overview** (`/admin`) — all users, platform-wide stats
5. **Admin settings** (`/admin/settings`) — configure scoring rules without code changes

## Scoring Engine

Three factors normalized to 0–100 then weighted:
- **Cashflow Strength** (default 20%) — net cashflow ratio
- **Activity Level** (default 35%) — transaction volume
- **Income Consistency** (default 45%) — CV of monthly inflows + irregularity penalties

Hard gates: negative cashflow → FAIL; insufficient data or high irregularity → cap at REVIEW.

Configurable via admin panel: weights, pass threshold, review threshold, min months, min transactions.

## Admin Access

Default admin: `admin@sme.com` / `admin123`

## User Preferences

- Keep implementation simple and clean — validation-stage MVP
- No over-engineering; focus on flexibility and clarity

## Gotchas

- `pnpm --filter @workspace/db run push-force` is interactive; use raw SQL for CI/scripted migrations
- Do not run `pnpm dev` at workspace root — use `restart_workflow` instead
- Orval generates `File`/`Blob` type errors in `lib/api-zod` — pre-existing, does not affect runtime
- After changing `openapi.yaml`, always run codegen before building
