---
name: Scorecard backfill pattern
description: How to add new fields to the scorecard without breaking legacy assessments.
---

The `backfillScorecard()` function in `artifacts/api-server/src/routes/assessments.ts` patches legacy JSONB scorecards at read time.

**Rules:**
1. Every new top-level scorecard field must have a backfill entry: `if (!scorecard.newField) { scorecard.newField = { ... }; }`
2. Backfill values must match the Zod schema types exactly — `number` fields cannot be `null` even for "unknown" sentinels; use `0` instead.
3. New boolean fields added to existing sub-objects (e.g. trendAnalysis) need the else-branch check: `if (ta.newBool === undefined) ta.newBool = false;`

**Why:** The Zod validation runs on every GET /assessments/:id response against the generated schema. A type mismatch (e.g. null where number is expected) throws a ZodError and returns a 500 HTML error page instead of JSON.
