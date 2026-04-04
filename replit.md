# SME Alternative Data Assessment MVP

## Overview

A full-stack fintech web application for assessing SME (Small and Medium Enterprise) creditworthiness using alternative data (bank statements). Users upload Excel files, the system analyzes cash flow, and returns a credit assessment: PASS, REVIEW, or FAIL.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite (artifacts/sme-assessment), deployed at `/`
- **API framework**: Express 5 (artifacts/api-server)
- **Database**: PostgreSQL + Drizzle ORM
- **Authentication**: Session-based (express-session + bcryptjs)
- **File upload**: multer (memory storage)
- **Excel parsing**: xlsx library
- **Validation**: Zod (via OpenAPI codegen from Orval)
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Business Rules

- **PASS**: Total inflow > outflow AND transactions > 10
- **REVIEW**: Transactions between 5–10 (with inflow > outflow)
- **FAIL**: Total outflow >= total inflow

## Admin Access

Default admin account: `admin@sme.com` / `admin123`

## Features

1. **User authentication** — signup/login with bcrypt-hashed passwords, cookie session
2. **Dashboard** — upload Excel files, view assessment history, summary stats
3. **Assessment detail** — inflow, outflow, transaction count, net position, status
4. **Admin view** (/admin) — all users and their assessments, platform-wide stats

## Excel File Format

Expected columns: `Date`, `Description`, `Type` (Inflow/Outflow), `Amount`

## Artifacts

- `artifacts/sme-assessment` — React/Vite frontend at path `/`
- `artifacts/api-server` — Express API server at path `/api`

## Database Schema

- `users` — id, email, password_hash, is_admin, created_at
- `assessments` — id, user_id, file_name, total_inflow, total_outflow, transaction_count, status, created_at

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
