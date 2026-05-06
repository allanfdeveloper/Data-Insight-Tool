/**
 * Multi-factor credit assessment scoring engine.
 *
 * Each factor is normalized to 0–100, then weighted and summed.
 * Configuration (weights, thresholds, minimum data requirements) is
 * loaded from the database and passed in at call time — nothing is
 * hardcoded here.
 *
 * Hard gates (override score-based decision):
 *   1. Negative cashflow (outflows >= inflows) → FAIL
 *   2. Insufficient data (months < minMonths OR txn < minTransactions) → cap at REVIEW
 *   3. Highly irregular income (CV >= 0.9 OR heavy penalty) → REVIEW / FAIL
 *
 * Score-based decision (after gates):
 *   PASS   — totalScore >= passThreshold
 *   REVIEW — totalScore >= reviewThreshold
 *   FAIL   — totalScore < reviewThreshold
 */

import type { TransactionRow } from "./parseExcel";

// ---------------------------------------------------------------------------
// Config type (mirrors the DB row — passed in from the route)
// ---------------------------------------------------------------------------

export interface AssessmentEngineConfig {
  minMonths: number;
  minTransactions: number;
  passThreshold: number;
  reviewThreshold: number;
  cashflowWeight: number;     // percentage (e.g. 20 means 20%)
  activityWeight: number;
  consistencyWeight: number;
}

export const DEFAULT_CONFIG: AssessmentEngineConfig = {
  minMonths: 3,
  minTransactions: 10,
  passThreshold: 72,
  reviewThreshold: 40,
  cashflowWeight: 20,
  activityWeight: 35,
  consistencyWeight: 45,
};

// ---------------------------------------------------------------------------
// Irregularity detection thresholds (not user-configurable, keep stable)
// ---------------------------------------------------------------------------

const MAX_INFLOW_GAP_DAYS = 45;
const SPIKE_RATIO = 2.5;
const HIGH_IRREGULARITY_CV = 0.9;
const MODERATE_IRREGULARITY_CV = 0.55;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function monthlyInflowMap(rows: TransactionRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.type !== "Inflow") continue;
    const d = new Date(row.date);
    if (isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    map.set(key, (map.get(key) ?? 0) + row.amount);
  }
  return map;
}

function inflowStats(rows: TransactionRow[]) {
  const inflows = rows
    .filter((r) => r.type === "Inflow")
    .map((r) => ({ date: new Date(r.date), amount: r.amount }))
    .filter((r) => !isNaN(r.date.getTime()))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const amounts = inflows.map((i) => i.amount);
  const dates = inflows.map((i) => i.date);
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    gaps.push((dates[i].getTime() - dates[i - 1].getTime()) / (1000 * 60 * 60 * 24));
  }

  const mean = amounts.length ? amounts.reduce((a, b) => a + b, 0) / amounts.length : 0;
  const cv = mean > 0 && amounts.length > 1 ? stddev(amounts) / mean : null;
  const maxGapDays = gaps.length ? Math.max(...gaps) : null;
  const longGapCount = gaps.filter((g) => g > MAX_INFLOW_GAP_DAYS).length;
  const spikeCount = mean > 0 ? amounts.filter((a) => a / mean >= SPIKE_RATIO).length : 0;

  return { mean, cv, maxGapDays, longGapCount, spikeCount };
}

/** Normalize cashflow net-ratio to 0–100 */
function normalizeCashflow(netRatio: number): number {
  if (netRatio <= 0)   return 0;
  if (netRatio > 0.50) return 100;
  if (netRatio > 0.30) return 80;
  if (netRatio > 0.15) return 55;
  if (netRatio > 0.05) return 30;
  return 10;
}

/** Normalize transaction count to 0–100 */
function normalizeActivity(txn: number): number {
  if (txn >= 50) return 100;
  if (txn >= 30) return 85;
  if (txn >= 20) return 70;
  if (txn >= 10) return 50;
  if (txn >= 5)  return 25;
  return 8;
}

/** Normalize CV to 0–100 (lower CV = better) */
function normalizeConsistency(cv: number): number {
  if (cv <= 0.10) return 100;
  if (cv <= 0.20) return 85;
  if (cv <= 0.35) return 68;
  if (cv <= 0.55) return 48;
  if (cv <= 0.75) return 28;
  if (cv <= 0.90) return 12;
  return 0;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TriggeredRule {
  rule: string;
  effect: "auto-fail" | "cap-review" | "score-penalty" | "passed";
  description: string;
}

export interface ScorecardFactor {
  score: number;
  maxScore: number;
  label: string;
  normalizedScore: number;
  weight: number;
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
  irregularityScore: number;
  irregularityFlags: string[];
}

export interface ConfigSnapshot {
  passThreshold: number;
  reviewThreshold: number;
  minMonths: number;
  minTransactions: number;
  cashflowWeight: number;
  activityWeight: number;
  consistencyWeight: number;
}

export interface Scorecard {
  cashflowStrength: CashflowStrengthFactor;
  activityLevel: ActivityLevelFactor;
  consistency: ConsistencyFactor;
  totalScore: number;
  maxScore: 100;
  statusReason: string;
  triggeredRules: TriggeredRule[];
  configSnapshot: ConfigSnapshot;
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
  rows: TransactionRow[],
  config: AssessmentEngineConfig = DEFAULT_CONFIG
): ScorecardResult {

  const {
    minMonths,
    minTransactions,
    passThreshold,
    reviewThreshold,
    cashflowWeight,
    activityWeight,
    consistencyWeight,
  } = config;

  // ── 1. Cashflow Strength ────────────────────────────────────────────────
  const netCashflow = Math.round((totalInflow - totalOutflow) * 100) / 100;
  const netRatio = totalInflow > 0 ? netCashflow / totalInflow : -1;

  const cfNorm = normalizeCashflow(netRatio);
  const cfWeighted = Math.round((cfNorm * cashflowWeight) / 100 * 10) / 10;

  const cfLabel =
    cfNorm >= 90 ? "Excellent cashflow" :
    cfNorm >= 70 ? "Strong positive cashflow" :
    cfNorm >= 45 ? "Moderate positive cashflow" :
    cfNorm >= 20 ? "Slight positive cashflow" :
    netRatio > 0  ? "Near break-even cashflow" :
    "Negative cashflow";

  const cashflowStrength: CashflowStrengthFactor = {
    score: cfWeighted,
    maxScore: Math.round(cashflowWeight),
    label: cfLabel,
    normalizedScore: cfNorm,
    weight: cashflowWeight,
    netRatio: Math.round(netRatio * 10000) / 10000,
    netCashflow,
  };

  // ── 2. Activity Level ───────────────────────────────────────────────────
  const actNorm = normalizeActivity(transactionCount);
  const actWeighted = Math.round((actNorm * activityWeight) / 100 * 10) / 10;

  const actLabel =
    actNorm >= 85 ? "High activity" :
    actNorm >= 65 ? "Good activity" :
    actNorm >= 45 ? "Moderate activity" :
    actNorm >= 20 ? "Low activity" :
    "Very low activity";

  const activityLevel: ActivityLevelFactor = {
    score: actWeighted,
    maxScore: Math.round(activityWeight),
    label: actLabel,
    normalizedScore: actNorm,
    weight: activityWeight,
    transactionCount,
  };

  // ── 3. Income Consistency ───────────────────────────────────────────────
  const monthMap = monthlyInflowMap(rows);
  const monthCount = monthMap.size;
  const { cv, maxGapDays, longGapCount, spikeCount } = inflowStats(rows);

  const irregularityFlags: string[] = [];
  let irregularityScore = 0;

  let conNorm: number;
  let conLabel: string;

  if (monthCount < 2 || cv === null) {
    conNorm = 20;
    conLabel = "Insufficient history for consistency check";
    irregularityFlags.push("Cannot evaluate consistency with less than 2 months of data");
  } else {
    conNorm = normalizeConsistency(cv);
    conLabel =
      conNorm >= 85 ? "Highly consistent income" :
      conNorm >= 65 ? "Consistent income" :
      conNorm >= 45 ? "Moderately consistent income" :
      conNorm >= 20 ? "Irregular income" :
      "Highly irregular income";

    if (maxGapDays !== null && maxGapDays > MAX_INFLOW_GAP_DAYS) {
      irregularityFlags.push(`Large inflow gap: ${Math.round(maxGapDays)} days between transactions`);
      irregularityScore += 12;
    }
    if (longGapCount > 1) {
      irregularityFlags.push(`Repeated long gaps (${longGapCount} occurrences > ${MAX_INFLOW_GAP_DAYS} days)`);
      irregularityScore += 12;
    }
    if (spikeCount > 0) {
      irregularityFlags.push(`Unusual inflow spikes detected (${spikeCount} transactions > ${SPIKE_RATIO}× average)`);
      irregularityScore += Math.min(12, spikeCount * 6);
    }
    if (cv >= HIGH_IRREGULARITY_CV) {
      irregularityFlags.push("Highly irregular inflow pattern (CV ≥ 90%)");
      irregularityScore += 20;
    } else if (cv >= MODERATE_IRREGULARITY_CV) {
      irregularityFlags.push("Moderately irregular inflow pattern (CV ≥ 55%)");
      irregularityScore += 8;
    }
  }

  const adjustedConNorm = Math.max(0, conNorm - irregularityScore);
  const conWeighted = Math.round((adjustedConNorm * consistencyWeight) / 100 * 10) / 10;

  if (irregularityScore > 0 && monthCount >= 2) {
    const afterPenalty =
      adjustedConNorm >= 65 ? "Consistent income" :
      adjustedConNorm >= 45 ? "Moderately consistent income" :
      adjustedConNorm >= 20 ? "Irregular income" :
      "Highly irregular income";
    conLabel = afterPenalty;
  }

  const consistency: ConsistencyFactor = {
    score: conWeighted,
    maxScore: Math.round(consistencyWeight),
    label: conLabel,
    normalizedScore: adjustedConNorm,
    weight: consistencyWeight,
    cv: cv !== null ? Math.round(cv * 10000) / 10000 : null,
    monthCount,
    irregularityScore,
    irregularityFlags,
  };

  // ── 4. Total score ──────────────────────────────────────────────────────
  const totalScore = Math.round(cfWeighted + actWeighted + conWeighted);

  // ── 5. Hard gates + triggered rules ─────────────────────────────────────
  const triggeredRules: TriggeredRule[] = [];
  const negativeCashflow = totalOutflow >= totalInflow;
  const insufficientMonths = monthCount < minMonths;
  const insufficientActivity = transactionCount < minTransactions;
  const highlyIrregular = (cv !== null && cv >= HIGH_IRREGULARITY_CV) || irregularityScore >= 25;
  const veryHighlyIrregular = irregularityScore >= 35;

  // Gate 1 — negative cashflow
  if (negativeCashflow) {
    triggeredRules.push({
      rule: "NEGATIVE_CASHFLOW",
      effect: "auto-fail",
      description: `Outflows ($${totalOutflow.toLocaleString()}) equal or exceed inflows ($${totalInflow.toLocaleString()}).`,
    });
  }

  // Gate 2 — insufficient data
  if (insufficientMonths) {
    triggeredRules.push({
      rule: "INSUFFICIENT_MONTHS",
      effect: "cap-review",
      description: `Only ${monthCount} month(s) of inflow data found; minimum required is ${minMonths}.`,
    });
  }
  if (insufficientActivity) {
    triggeredRules.push({
      rule: "INSUFFICIENT_TRANSACTIONS",
      effect: "cap-review",
      description: `Only ${transactionCount} transaction(s) found; minimum required is ${minTransactions}.`,
    });
  }

  // Gate 3 — highly irregular income
  if (highlyIrregular) {
    triggeredRules.push({
      rule: "HIGH_IRREGULARITY",
      effect: veryHighlyIrregular ? "auto-fail" : "cap-review",
      description: `Income patterns are too irregular for a reliable assessment. ${irregularityFlags.join(" ")}`,
    });
  }

  // Score-based rules
  if (!negativeCashflow && !highlyIrregular && !insufficientMonths && !insufficientActivity) {
    if (totalScore >= passThreshold) {
      triggeredRules.push({
        rule: "SCORE_PASS",
        effect: "passed",
        description: `Score ${totalScore}/100 meets the pass threshold (${passThreshold}).`,
      });
    } else if (totalScore >= reviewThreshold) {
      triggeredRules.push({
        rule: "SCORE_REVIEW",
        effect: "cap-review",
        description: `Score ${totalScore}/100 is above the review threshold (${reviewThreshold}) but below pass (${passThreshold}).`,
      });
    } else {
      triggeredRules.push({
        rule: "SCORE_FAIL",
        effect: "auto-fail",
        description: `Score ${totalScore}/100 is below the review threshold (${reviewThreshold}).`,
      });
    }
  }

  // ── 6. Final decision ───────────────────────────────────────────────────
  let status: "PASS" | "REVIEW" | "FAIL";
  let statusReason: string;

  if (negativeCashflow) {
    status = "FAIL";
    statusReason = `Net cashflow is negative — outflows equal or exceed inflows. ${cfLabel}.`;
  } else if (veryHighlyIrregular) {
    status = "FAIL";
    statusReason = `Income is critically irregular. Irregularity penalty: ${irregularityScore} pts. ${irregularityFlags.join("; ")}.`;
  } else if (insufficientMonths || insufficientActivity || highlyIrregular) {
    status = "REVIEW";
    const reasons: string[] = [];
    if (insufficientMonths) reasons.push(`insufficient monthly history (${monthCount}/${minMonths} months)`);
    if (insufficientActivity) reasons.push(`insufficient transactions (${transactionCount}/${minTransactions})`);
    if (highlyIrregular) reasons.push("highly irregular income pattern");
    statusReason = `Insufficient data for full assessment — ${reasons.join(", ")}.`;
  } else if (totalScore >= passThreshold) {
    status = "PASS";
    statusReason = `Score ${totalScore}/100 meets the pass threshold (${passThreshold}). ${cfLabel}, ${actLabel.toLowerCase()}, and ${conLabel.toLowerCase()}.`;
  } else if (totalScore >= reviewThreshold) {
    status = "REVIEW";
    statusReason = `Score ${totalScore}/100 is above the review threshold but below pass. ${conLabel}.${irregularityFlags.length > 0 ? " " + irregularityFlags[0] : ""}`;
  } else {
    status = "FAIL";
    statusReason = `Score ${totalScore}/100 is below the review threshold (${reviewThreshold}). Insufficient creditworthiness indicators.`;
  }

  const configSnapshot: ConfigSnapshot = {
    passThreshold,
    reviewThreshold,
    minMonths,
    minTransactions,
    cashflowWeight,
    activityWeight,
    consistencyWeight,
  };

  return {
    scorecard: {
      cashflowStrength,
      activityLevel,
      consistency,
      totalScore,
      maxScore: 100,
      statusReason,
      triggeredRules,
      configSnapshot,
    },
    status,
  };
}
