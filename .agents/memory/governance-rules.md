---
name: Governance Rules Engine
description: Post-scoring override layer that can cap PASS→REVIEW; never changes REVIEW or FAIL; stores provisionalDecision + finalDecision in GovernanceResult.
---

Governance runs AFTER scoring (step 10 in computeScorecard). It evaluates 5 rules and can only cap PASS → REVIEW; REVIEW and FAIL are unaffected.

## Rules and Thresholds

| Rule | Condition | Cap |
|------|-----------|-----|
| Extreme Revenue Concentration | rc.risk=HIGH AND largestInflowPct >= 70% | REVIEW |
| Extreme Expense Dependency | ed.risk=HIGH AND largestExpensePct >= 60% | REVIEW |
| Severe Revenue Volatility | vi.classification=HIGH AND cv >= 90% (non-insufficient) | REVIEW |
| Severe Income Irregularity | consistency.normalizedScore=0 OR highlyIrregular=true | REVIEW |
| Low Confidence Protection | confidence=LOW | REVIEW |

## Data Shape

```typescript
GovernanceResult {
  overridesTriggered: boolean;
  overrides: GovernanceOverride[];  // all triggered rules
  provisionalDecision: "PASS" | "REVIEW" | "FAIL";  // before governance
  finalDecision: "PASS" | "REVIEW" | "FAIL";        // after governance
}
```

## Backfill (assessments.ts)
Old assessments get: overridesTriggered=false, overrides=[], provisionalDecision=assessment.status, finalDecision=assessment.status. The backfillScorecard function accepts optional `status` param for this.

**Why:** Separates "credit score" from "lending decision" — high-scoring businesses can still be blocked by material risk conditions without changing the underlying score.

**How to apply:** When adding a new governance rule, add it in computeGovernance() in scorecard.ts. Do NOT change any score weights or factor calculations — governance is a read-only layer that only inspects already-computed data.
