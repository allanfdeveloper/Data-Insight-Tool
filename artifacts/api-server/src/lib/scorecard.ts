/**
 * Multi-factor credit assessment scoring engine.
 *
 * Three independent factors combine into a 0–100 score:
 *   1. Cashflow Strength  (0–40 pts) — net cashflow ratio
 *   2. Activity Level     (0–30 pts) — transaction volume
 *   3. Consistency        (0–30 pts) — stability of monthly inflows
 *
 * Final decision:
 *   FAIL   — outflows >= inflows (always, regardless of score)
 *   PASS   — score >= PASS_THRESHOLD  (default 60)
 *   REVIEW — score <  PASS_THRESHOLD  (and inflows > outflows)
 *
 * All thresholds are declared as named constants at the top so they
 * can be adjusted without touching the logic.
 */

import type { TransactionRow } from "./parseExcel";

// ---------------------------------------------------------------------------
// Configuration — adjust thresholds here
// ---------------------------------------------------------------------------

const CASHFLOW_MAX = 40;
const ACTIVITY_MAX = 30;
const CONSISTENCY_MAX = 30;

/** Score needed (out of 100) for a PASS verdict */
const PASS_THRESHOLD = 60;

// Cashflow net-ratio tiers  (net / totalInflow)
const CF_TIERS = [
  { minRatio: 0.50, score: 40, label: "Strong positive cashflow"   },
  { minRatio: 0.25, score: 30, label: "Moderate positive cashflow" },
  { minRatio: 0.10, score: 20, label: "Slight positive cashflow"   },
  { minRatio: 0.00, score: 10, label: "Near break-even cashflow"   },
] as const;

// Activity tiers (transaction count)
const ACT_TIERS = [
  { minTxn: 30, score: 30, label: "High activity"      },
  { minTxn: 20, score: 25, label: "Good activity"      },
  { minTxn: 10, score: 20, label: "Moderate activity"  },
  { minTxn:  5, score: 10, label: "Low activity"       },
  { minTxn:  0, score:  0, label: "Very low activity"  },
] as const;

// Consistency tiers (coefficient of variation of monthly inflows)
const CON_TIERS = [
  { maxCv: 0.15, score: 30, label: "Highly consistent income"    },
  { maxCv: 0.30, score: 22, label: "Consistent income"           },
  { maxCv: 0.50, score: 14, label: "Moderately consistent income"},
  { maxCv: 0.75, score:  6, label: "Irregular income"            },
  { maxCv: Infinity, score: 0, label: "Highly irregular income"  },
] as const;

/** Score and label awarded when there is < 2 months of inflow data */
const CONSISTENCY_INSUFFICIENT = { score: 15, label: "Insufficient history for consistency check" };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Group inflow transactions by "YYYY-MM" and return per-month totals */
function monthlyInflowMap(rows: TransactionRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.type !== "Inflow") continue;

    // Accept both ISO dates and common formatted strings
    const d = new Date(row.date);
    if (isNaN(d.getTime())) continue;

    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    map.set(key, (map.get(key) ?? 0) + row.amount);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ScorecardFactor {
  score: number;
  maxScore: number;
  label: string;
}

export interface CashflowStrengthFactor extends ScorecardFactor {
  netRatio: number;
  netCashflow: number;
}

export interface ActivityLevelFactor extends ScorecardFactor {
  transactionCount: number;
}

export interface ConsistencyFactor extends ScorecardFactor {
  cv: number | null;
  monthCount: number;
}

export interface Scorecard {
  cashflowStrength: CashflowStrengthFactor;
  activityLevel: ActivityLevelFactor;
  consistency: ConsistencyFactor;
  totalScore: number;
  maxScore: 100;
  statusReason: string;
}

export interface ScorecardResult {
  scorecard: Scorecard;
  status: "PASS" | "REVIEW" | "FAIL";
}

// ---------------------------------------------------------------------------
// Main scoring function
// ---------------------------------------------------------------------------

export function computeScorecard(
  totalInflow: number,
  totalOutflow: number,
  transactionCount: number,
  rows: TransactionRow[]
): ScorecardResult {

  // ── 1. Cashflow Strength ─────────────────────────────────────────────────
  const netCashflow = Math.round((totalInflow - totalOutflow) * 100) / 100;
  const netRatio = totalInflow > 0 ? netCashflow / totalInflow : -1;

  let cfScore = 0;
  let cfLabel = "Negative cashflow";
  if (netRatio > 0) {
    for (const tier of CF_TIERS) {
      if (netRatio >= tier.minRatio) {
        cfScore = tier.score;
        cfLabel = tier.label;
        break;
      }
    }
  }

  const cashflowStrength: CashflowStrengthFactor = {
    score:    cfScore,
    maxScore: CASHFLOW_MAX,
    label:    cfLabel,
    netRatio: Math.round(netRatio * 10000) / 10000,
    netCashflow,
  };

  // ── 2. Activity Level ─────────────────────────────────────────────────────
  let actScore = 0;
  let actLabel = "Very low activity";
  for (const tier of ACT_TIERS) {
    if (transactionCount >= tier.minTxn) {
      actScore = tier.score;
      actLabel = tier.label;
      break;
    }
  }

  const activityLevel: ActivityLevelFactor = {
    score:            actScore,
    maxScore:         ACTIVITY_MAX,
    label:            actLabel,
    transactionCount,
  };

  // ── 3. Income Consistency ─────────────────────────────────────────────────
  const monthMap = monthlyInflowMap(rows);
  const monthCount = monthMap.size;
  const monthlyValues = Array.from(monthMap.values());

  let conScore: number;
  let conLabel: string;
  let cv: number | null = null;

  if (monthCount < 2) {
    conScore = CONSISTENCY_INSUFFICIENT.score;
    conLabel = CONSISTENCY_INSUFFICIENT.label;
  } else {
    const mean = monthlyValues.reduce((a, b) => a + b, 0) / monthlyValues.length;
    cv = mean > 0 ? stddev(monthlyValues) / mean : 0;
    cv = Math.round(cv * 10000) / 10000;

    const tier = CON_TIERS.find((t) => cv! <= t.maxCv) ?? CON_TIERS[CON_TIERS.length - 1];
    conScore = tier.score;
    conLabel = tier.label;
  }

  const consistency: ConsistencyFactor = {
    score:      conScore,
    maxScore:   CONSISTENCY_MAX,
    label:      conLabel,
    cv,
    monthCount,
  };

  // ── 4. Combine ────────────────────────────────────────────────────────────
  const totalScore = cfScore + actScore + conScore;

  // Decision — cashflow direction is the hard gate
  let status: "PASS" | "REVIEW" | "FAIL";
  let statusReason: string;

  if (totalOutflow >= totalInflow) {
    status = "FAIL";
    statusReason =
      `Outflows ($${totalOutflow.toLocaleString()}) equal or exceed inflows ` +
      `($${totalInflow.toLocaleString()}). Net cashflow is negative or zero.`;
  } else if (totalScore >= PASS_THRESHOLD) {
    status = "PASS";
    statusReason =
      `Score ${totalScore}/100 meets the pass threshold (${PASS_THRESHOLD}). ` +
      `${cfLabel}, ${actLabel.toLowerCase()}, and ${conLabel.toLowerCase()}.`;
  } else {
    status = "REVIEW";
    statusReason =
      `Score ${totalScore}/100 is below the pass threshold (${PASS_THRESHOLD}). ` +
      `Positive cashflow but further review recommended: ${conLabel.toLowerCase()}, ` +
      `${actLabel.toLowerCase()}.`;
  }

  return {
    scorecard: {
      cashflowStrength,
      activityLevel,
      consistency,
      totalScore,
      maxScore: 100,
      statusReason,
    },
    status,
  };
}
