/**
 * Multi-factor credit assessment scoring engine.
 *
 * Hard gates:
 *   - outflows >= inflows => FAIL
 *   - insufficient transaction activity => cannot PASS
 *   - consistency cannot be evaluated => cannot PASS
 *
 * Weighted score (0–100):
 *   1. Cashflow Strength  (0–20 pts)
 *   2. Activity Level     (0–35 pts)
 *   3. Income Consistency (0–45 pts)
 *
 * Final decision:
 *   FAIL   — negative cashflow or highly irregular income
 *   PASS   — strong cashflow + sufficient activity + consistent income
 *   REVIEW — everything else
 */

import type { TransactionRow } from "./parseExcel";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CASHFLOW_MAX = 20;
const ACTIVITY_MAX = 35;
const CONSISTENCY_MAX = 45;

const PASS_THRESHOLD = 72;
const MIN_TXN_FOR_PASS = 10;
const MIN_MONTHS_FOR_CONSISTENCY = 2;
const HIGH_IRREGULARITY_CV = 0.9;
const MODERATE_IRREGULARITY_CV = 0.55;
const MAX_INFLOW_GAP_DAYS = 45;
const SPIKE_RATIO = 2.5;
const NET_RATIO_STRONG = 0.35;
const NET_RATIO_MODERATE = 0.18;
const NET_RATIO_SLIGHT = 0.08;

const ACT_TIERS = [
  { minTxn: 30, score: 35, label: "High activity" },
  { minTxn: 20, score: 28, label: "Good activity" },
  { minTxn: 10, score: 20, label: "Moderate activity" },
  { minTxn: 5, score: 10, label: "Low activity" },
  { minTxn: 0, score: 0, label: "Very low activity" },
] as const;

const INSUFFICIENT_CONSISTENCY = {
  score: 10,
  label: "Insufficient history for consistency check",
};

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function parseDate(raw: string): Date | null {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function monthlyInflowMap(rows: TransactionRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.type !== "Inflow") continue;
    const d = parseDate(row.date);
    if (!d) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    map.set(key, (map.get(key) ?? 0) + row.amount);
  }
  return map;
}

function inflowStats(rows: TransactionRow[]) {
  const inflows = rows
    .filter((r) => r.type === "Inflow")
    .map((r) => ({ date: parseDate(r.date), amount: r.amount }))
    .filter((r): r is { date: Date; amount: number } => r.date !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const amounts = inflows.map((i) => i.amount);
  const dates = inflows.map((i) => i.date);
  const gaps: number[] = [];

  for (let i = 1; i < dates.length; i++) {
    gaps.push((dates[i].getTime() - dates[i - 1].getTime()) / (1000 * 60 * 60 * 24));
  }

  const mean = amounts.length ? amounts.reduce((a, b) => a + b, 0) / amounts.length : 0;
  const max = amounts.length ? Math.max(...amounts) : 0;
  const cv = mean > 0 && amounts.length > 1 ? stddev(amounts) / mean : null;
  const maxGapDays = gaps.length ? Math.max(...gaps) : null;
  const gapCount = gaps.filter((g) => g > MAX_INFLOW_GAP_DAYS).length;
  const spikeCount = mean > 0 ? amounts.filter((a) => a / mean >= SPIKE_RATIO).length : 0;

  return { inflows, mean, max, cv, maxGapDays, gapCount, spikeCount };
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
  irregularityScore: number;
  irregularityFlags: string[];
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

export function computeScorecard(
  totalInflow: number,
  totalOutflow: number,
  transactionCount: number,
  rows: TransactionRow[]
): ScorecardResult {
  const netCashflow = Math.round((totalInflow - totalOutflow) * 100) / 100;
  const netRatio = totalInflow > 0 ? netCashflow / totalInflow : -1;

  let cfScore = 0;
  let cfLabel = "Negative cashflow";
  if (netRatio > 0.35) {
    cfScore = 20;
    cfLabel = "Strong positive cashflow";
  } else if (netRatio > 0.18) {
    cfScore = 15;
    cfLabel = "Moderate positive cashflow";
  } else if (netRatio > 0.08) {
    cfScore = 10;
    cfLabel = "Slight positive cashflow";
  } else if (netRatio > 0) {
    cfScore = 5;
    cfLabel = "Near break-even cashflow";
  }

  const cashflowStrength: CashflowStrengthFactor = {
    score: cfScore,
    maxScore: CASHFLOW_MAX,
    label: cfLabel,
    netRatio: Math.round(netRatio * 10000) / 10000,
    netCashflow,
  };

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
    score: actScore,
    maxScore: ACTIVITY_MAX,
    label: actLabel,
    transactionCount,
  };

  const monthMap = monthlyInflowMap(rows);
  const monthCount = monthMap.size;
  const monthlyValues = Array.from(monthMap.values());
  const { cv, maxGapDays, gapCount, spikeCount } = inflowStats(rows);

  const irregularityFlags: string[] = [];
  let consistencyScore = 0;
  let consistencyLabel = "Insufficient history for consistency check";
  let irregularityScore = 0;

  if (monthCount < MIN_MONTHS_FOR_CONSISTENCY) {
    consistencyScore = INSUFFICIENT_CONSISTENCY.score;
  } else if (cv === null) {
    consistencyScore = INSUFFICIENT_CONSISTENCY.score;
  } else {
    if (cv <= 0.15) {
      consistencyScore = 45;
      consistencyLabel = "Highly consistent income";
    } else if (cv <= 0.3) {
      consistencyScore = 36;
      consistencyLabel = "Consistent income";
    } else if (cv <= 0.55) {
      consistencyScore = 24;
      consistencyLabel = "Moderately consistent income";
    } else if (cv <= 0.9) {
      consistencyScore = 12;
      consistencyLabel = "Irregular income";
    } else {
      consistencyScore = 0;
      consistencyLabel = "Highly irregular income";
    }

    if (maxGapDays !== null && maxGapDays > MAX_INFLOW_GAP_DAYS) {
      irregularityFlags.push(`Large inflow gap detected (${Math.round(maxGapDays)} days)`);
      irregularityScore += 10;
    }
    if (spikeCount > 0 && monthlyValues.length > 0) {
      irregularityFlags.push(`Large inflow spike(s) detected (${spikeCount})`);
      irregularityScore += Math.min(10, spikeCount * 5);
    }
    if (gapCount > 1) {
      irregularityFlags.push(`Repeated long gaps between inflows (${gapCount})`);
      irregularityScore += 10;
    }
    if (cv >= HIGH_IRREGULARITY_CV) {
      irregularityFlags.push("Highly irregular inflow pattern");
      irregularityScore += 20;
    } else if (cv >= MODERATE_IRREGULARITY_CV) {
      irregularityFlags.push("Moderately irregular inflow pattern");
      irregularityScore += 10;
    }
  }

  if (monthCount < MIN_MONTHS_FOR_CONSISTENCY) {
    irregularityFlags.push("Consistency cannot be fully evaluated");
  }

  consistencyScore = Math.max(0, consistencyScore - irregularityScore);

  if (consistencyScore <= 8 && monthCount >= MIN_MONTHS_FOR_CONSISTENCY) {
    consistencyLabel = "Highly irregular income";
  } else if (irregularityFlags.length > 0 && consistencyScore < 20) {
    consistencyLabel = "Irregular income";
  }

  const consistency: ConsistencyFactor = {
    score: consistencyScore,
    maxScore: CONSISTENCY_MAX,
    label: consistencyLabel,
    cv,
    monthCount,
    irregularityScore,
    irregularityFlags,
  };

  const totalScore = cfScore + actScore + consistencyScore;

  const cashflowStrong = netRatio > 0.25;
  const sufficientActivity = transactionCount >= MIN_TXN_FOR_PASS;
  const consistencyEvaluated = monthCount >= MIN_MONTHS_FOR_CONSISTENCY && cv !== null;
  const consistentEnough = consistencyEvaluated && (cv ?? 1) < MODERATE_IRREGULARITY_CV && irregularityScore < 15;
  const highlyIrregular = !consistencyEvaluated || (cv !== null && cv >= HIGH_IRREGULARITY_CV) || irregularityScore >= 20;

  let status: "PASS" | "REVIEW" | "FAIL";
  let statusReason: string;

  if (totalOutflow >= totalInflow) {
    status = "FAIL";
    statusReason = `Outflows ($${totalOutflow.toLocaleString()}) equal or exceed inflows ($${totalInflow.toLocaleString()}). Net cashflow is negative or zero.`;
  } else if (highlyIrregular) {
    status = consistencyScore <= 5 ? "FAIL" : "REVIEW";
    statusReason = `Income is too irregular to support a pass decision. ${irregularityFlags.join("; ") || "Consistency could not be evaluated."}`;
  } else if (!sufficientActivity) {
    status = "REVIEW";
    statusReason = `Transaction activity is below the pass threshold (${transactionCount}/${MIN_TXN_FOR_PASS}).`; 
  } else if (!consistencyEvaluated) {
    status = "REVIEW";
    statusReason = "Consistency could not be evaluated due to insufficient history.";
  } else if (cashflowStrong && sufficientActivity && consistentEnough && totalScore >= PASS_THRESHOLD) {
    status = "PASS";
    statusReason = `Strong cashflow, sufficient activity, and stable income patterns support a pass decision. Score ${totalScore}/100.`;
  } else {
    status = "REVIEW";
    statusReason = `Score ${totalScore}/100 is below pass conditions. ${consistencyLabel}. ${irregularityFlags.join("; ")}`;
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
