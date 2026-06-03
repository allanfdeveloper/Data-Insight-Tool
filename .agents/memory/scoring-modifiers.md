---
name: Scoring modifiers summary
description: All active score modifier constants across the engine — useful when adding new modifiers or checking for double-counting.
---

All modifiers are additive to `baseScore = cfWeighted + actWeighted + conWeighted`.
Final score is clamped to [0, 100].

## Trend (trendAnalysis.trendScore)
- POSITIVE classification: +4
- NEGATIVE classification: -4
- Severe deterioration (additional): -3
- Recovery momentum (marginHealth.isRecovery): +1

## Margin Health (marginHealth.scoreModifier)
- Strong: +2
- Thin: -3
- Very Thin: -5

## Revenue Concentration (revenueConcentration.scoreModifier)
- LOW: 0
- MODERATE: -2
- HIGH: -4

## Volatility Intelligence (volatilityIntelligence.scoreModifier)
- LOW (CV < 20%): 0
- MODERATE (CV 20–50%): -2
- HIGH (CV > 50%): -5
- Eligibility: requires ≥3 months with inflow activity; isInsufficientHistory=true → no penalty

**Why:** Volatility and trend modifiers are independent — trend uses net cashflow CV; volatility uses inflow-only CV. Not double-counting.

**How to apply:** When adding a new modifier, wire it into the totalScore calculation in computeScorecard() step 6, add a triggered rule, include it in the Scorecard return object, backfill it in assessments.ts, and add it to the OpenAPI spec.
