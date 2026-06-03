---
name: Revenue Concentration scoring
description: How concentration risk is classified and scored — OR logic, no auto-fail, modest penalties.
---

Classification uses OR (not AND) for risk level:
- HIGH: largestInflowPct > 40% OR top3Pct > 80%
- MODERATE: largestInflowPct >= 25% OR top3Pct >= 60% (and not HIGH)
- LOW: everything else

**Why:** SME-inclusive design — a business can have one large client but diversified minor inflows. OR means we flag the highest-risk scenario rather than requiring both conditions to be bad.

**Score modifiers:** MODERATE −2 pts, HIGH −4 pts, LOW 0 pts. These are additive (not overrides), applied alongside trend and margin modifiers.

**No auto-fail or cap-review:** Revenue concentration is a risk awareness signal only. Triggered rules are `score-penalty` or `passed` effects only.
