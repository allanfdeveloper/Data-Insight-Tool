/**
 * Multi-factor credit assessment scoring engine.
 *
 * Each factor is normalized to 0–100, then weighted and summed.
 * Configuration (weights, thresholds, minimum data requirements) is
 * loaded from the database and passed in at call time — nothing is hardcoded.
 *
 * Confidence layer:
 *   HIGH   — meets both minMonths AND minTransactions
 *   MEDIUM — meets exactly one requirement
 *   LOW    — meets neither requirement
 *
 * Trend intelligence layer:
 *   POSITIVE — cashflow improving over assessment period (+4 pts)
 *   STABLE   — no significant direction detected (0 pts)
 *   NEGATIVE — cashflow deteriorating (-4 pts)
 *
 * Hard gates (override score):
 *   1. Negative cashflow (outflows >= inflows) → FAIL
 *   2. Critically irregular income              → FAIL / REVIEW
 */

import type { TransactionRow } from "./parseExcel";

// ---------------------------------------------------------------------------
// Config type
// ---------------------------------------------------------------------------

export interface AssessmentEngineConfig {
  minMonths: number;
  minTransactions: number;
  passThreshold: number;
  reviewThreshold: number;
  cashflowWeight: number;
  activityWeight: number;
  consistencyWeight: number;
}

export const DEFAULT_CONFIG: AssessmentEngineConfig = {
  minMonths: 3,
  minTransactions: 10,
  passThreshold: 65,
  reviewThreshold: 40,
  cashflowWeight: 40,
  activityWeight: 30,
  consistencyWeight: 30,
};

// ---------------------------------------------------------------------------
// Irregularity detection constants
// ---------------------------------------------------------------------------

const MAX_INFLOW_GAP_DAYS = 45;
const SPIKE_RATIO = 2.5;
const HIGH_IRREGULARITY_CV = 0.9;
const MODERATE_IRREGULARITY_CV = 0.55;

// Trend detection thresholds
const TREND_SLOPE_THRESHOLD = 0.05;   // 5% relative change per month to count as a trend
const TREND_SCORE_BONUS = 4;           // pts added for POSITIVE
const TREND_SCORE_PENALTY = 4;         // pts removed for NEGATIVE
const VOLATILITY_HIGH_CV = 0.6;
const VOLATILITY_MODERATE_CV = 0.25;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Ordinary least-squares slope for a sequence of values (index = x). */
function linearSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (values[i] - meanY);
    den += (i - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/** Classify the direction of a slope relative to the mean magnitude. */
function directionOf(
  slope: number,
  meanMagnitude: number,
  threshold = TREND_SLOPE_THRESHOLD
): "increasing" | "stable" | "declining" {
  if (meanMagnitude === 0) return "stable";
  const rel = slope / meanMagnitude;
  if (rel > threshold) return "increasing";
  if (rel < -threshold) return "declining";
  return "stable";
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

function normalizeCashflow(netRatio: number): number {
  if (netRatio <= 0)   return 0;
  if (netRatio > 0.50) return 100;
  if (netRatio > 0.30) return 80;
  if (netRatio > 0.15) return 55;
  if (netRatio > 0.05) return 30;
  return 10;
}

function normalizeActivity(txn: number): number {
  if (txn >= 50) return 100;
  if (txn >= 30) return 85;
  if (txn >= 20) return 70;
  if (txn >= 10) return 50;
  if (txn >= 5)  return 25;
  return 8;
}

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

export type AssessmentConfidence = "HIGH" | "MEDIUM" | "LOW";
export type TrendClassification = "POSITIVE" | "STABLE" | "NEGATIVE";

export interface MonthlyDataPoint {
  month: string;   // YYYY-MM
  inflow: number;
  outflow: number;
  net: number;
}

export interface TrendAnalysis {
  monthlyData: MonthlyDataPoint[];
  classification: TrendClassification;
  inflowTrend: "increasing" | "stable" | "declining";
  outflowTrend: "increasing" | "stable" | "declining";
  netTrend: "improving" | "stable" | "deteriorating";
  volatility: "low" | "moderate" | "high";
  trendScore: number;
  explanations: string[];
}

export interface TriggeredRule {
  rule: string;
  effect: "auto-fail" | "cap-review" | "score-penalty" | "score-bonus" | "passed" | "confidence-warning";
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
  confidence: AssessmentConfidence;
  confidenceReasons: string[];
  trendAnalysis: TrendAnalysis;
  triggeredRules: TriggeredRule[];
  configSnapshot: ConfigSnapshot;
}

export interface ScorecardResult {
  scorecard: Scorecard;
  status: "PASS" | "REVIEW" | "FAIL";
  confidence: AssessmentConfidence;
}

// ---------------------------------------------------------------------------
// Trend computation
// ---------------------------------------------------------------------------

function computeTrend(rows: TransactionRow[]): TrendAnalysis {
  // Build per-month aggregates
  const monthMap = new Map<string, { inflow: number; outflow: number }>();
  for (const row of rows) {
    const d = new Date(row.date);
    if (isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const entry = monthMap.get(key) ?? { inflow: 0, outflow: 0 };
    if (row.type === "Inflow") entry.inflow += row.amount;
    else entry.outflow += row.amount;
    monthMap.set(key, entry);
  }

  const monthlyData: MonthlyDataPoint[] = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { inflow, outflow }]) => ({
      month,
      inflow: Math.round(inflow * 100) / 100,
      outflow: Math.round(outflow * 100) / 100,
      net: Math.round((inflow - outflow) * 100) / 100,
    }));

  // Need at least 2 months for a meaningful trend
  if (monthlyData.length < 2) {
    return {
      monthlyData,
      classification: "STABLE",
      inflowTrend: "stable",
      outflowTrend: "stable",
      netTrend: "stable",
      volatility: "low",
      trendScore: 0,
      explanations: ["Insufficient monthly data for trend analysis — minimum 2 months required."],
    };
  }

  // Compute slopes
  const inflows  = monthlyData.map((m) => m.inflow);
  const outflows = monthlyData.map((m) => m.outflow);
  const nets     = monthlyData.map((m) => m.net);

  const meanInflow  = inflows.reduce((a, b) => a + b, 0) / inflows.length;
  const meanOutflow = outflows.reduce((a, b) => a + b, 0) / outflows.length;
  const meanAbsNet  = nets.map(Math.abs).reduce((a, b) => a + b, 0) / nets.length;

  const inflowSlope  = linearSlope(inflows);
  const outflowSlope = linearSlope(outflows);
  const netSlope     = linearSlope(nets);

  const inflowTrend  = directionOf(inflowSlope,  meanInflow);
  const outflowTrend = directionOf(outflowSlope, meanOutflow);
  const rawNetDir    = directionOf(netSlope, meanAbsNet || 1);
  const netTrend: TrendAnalysis["netTrend"] =
    rawNetDir === "increasing" ? "improving" :
    rawNetDir === "declining"  ? "deteriorating" :
    "stable";

  // Volatility: CV of monthly net cashflow
  const netMean  = nets.reduce((a, b) => a + b, 0) / nets.length;
  const netCV    = netMean !== 0
    ? Math.abs(stddev(nets) / netMean)
    : stddev(nets) > 0 ? 1 : 0;
  const volatility: TrendAnalysis["volatility"] =
    netCV > VOLATILITY_HIGH_CV     ? "high" :
    netCV > VOLATILITY_MODERATE_CV ? "moderate" :
    "low";

  // Overall classification
  let classification: TrendClassification;
  const netImproving    = netTrend === "improving";
  const netDeteriorating = netTrend === "deteriorating";
  const inflowUp        = inflowTrend === "increasing";
  const outflowDown     = outflowTrend === "declining";
  const inflowDown      = inflowTrend === "declining";
  const outflowUp       = outflowTrend === "increasing";

  if (netImproving || (inflowUp && !outflowUp)) {
    classification = "POSITIVE";
  } else if (netDeteriorating || (inflowDown && outflowUp)) {
    classification = "NEGATIVE";
  } else {
    classification = "STABLE";
  }

  // Downgrade POSITIVE → STABLE when volatility is high (erratic, not genuinely improving)
  if (volatility === "high" && classification === "POSITIVE") {
    classification = "STABLE";
  }

  // Score modifier
  const trendScore =
    classification === "POSITIVE" ? TREND_SCORE_BONUS :
    classification === "NEGATIVE" ? -TREND_SCORE_PENALTY :
    0;

  // Build human-readable explanations
  const explanations: string[] = [];

  if (inflowTrend === "increasing") {
    explanations.push("Inflows are increasing over the assessment period — business revenue is growing.");
  } else if (inflowTrend === "declining") {
    explanations.push("Declining inflow trend detected across the assessment period.");
  }

  if (outflowTrend === "increasing") {
    explanations.push("Outflows are rising month-over-month — costs are increasing.");
  } else if (outflowTrend === "declining") {
    explanations.push("Outflows are declining — cost control is improving.");
  }

  if (netTrend === "improving") {
    explanations.push("Business shows improving monthly net cashflow over the assessment period.");
  } else if (netTrend === "deteriorating") {
    explanations.push("Deteriorating net cashflow trend detected across the assessment period.");
  }

  if (volatility === "high") {
    explanations.push("High month-to-month volatility observed — cashflow patterns are inconsistent.");
  } else if (volatility === "moderate") {
    explanations.push("Moderate month-to-month fluctuations observed.");
  }

  if (explanations.length === 0) {
    explanations.push("Business cashflow is stable with no significant directional trend detected.");
  }

  return {
    monthlyData,
    classification,
    inflowTrend,
    outflowTrend,
    netTrend,
    volatility,
    trendScore,
    explanations,
  };
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
    conLabel =
      adjustedConNorm >= 65 ? "Consistent income" :
      adjustedConNorm >= 45 ? "Moderately consistent income" :
      adjustedConNorm >= 20 ? "Irregular income" :
      "Highly irregular income";
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

  // ── 4. Trend Intelligence ───────────────────────────────────────────────
  const trendAnalysis = computeTrend(rows);

  // ── 5. Total score (weighted factors + trend modifier) ──────────────────
  const baseScore   = cfWeighted + actWeighted + conWeighted;
  const totalScore  = Math.round(Math.min(100, Math.max(0, baseScore + trendAnalysis.trendScore)));

  // ── 6. Confidence layer ─────────────────────────────────────────────────
  const meetsMonths = monthCount >= minMonths;
  const meetsTxn    = transactionCount >= minTransactions;

  let confidence: AssessmentConfidence;
  const confidenceReasons: string[] = [];

  if (meetsMonths && meetsTxn) {
    confidence = "HIGH";
  } else if (meetsMonths || meetsTxn) {
    confidence = "MEDIUM";
    if (!meetsMonths) {
      confidenceReasons.push(
        `Assessment confidence is MEDIUM due to limited monthly history (${monthCount} of ${minMonths} required months).`
      );
    }
    if (!meetsTxn) {
      confidenceReasons.push(
        `Assessment confidence is MEDIUM due to limited transaction activity (${transactionCount} of ${minTransactions} required transactions).`
      );
    }
  } else {
    confidence = "LOW";
    confidenceReasons.push(
      `Assessment confidence is LOW due to insufficient monthly history (${monthCount} of ${minMonths} required months) and insufficient transaction activity (${transactionCount} of ${minTransactions} required transactions).`
    );
  }

  // ── 7. Triggered rules ──────────────────────────────────────────────────
  const triggeredRules: TriggeredRule[] = [];
  const negativeCashflow     = totalOutflow >= totalInflow;
  const highlyIrregular      = (cv !== null && cv >= HIGH_IRREGULARITY_CV) || irregularityScore >= 25;
  const veryHighlyIrregular  = irregularityScore >= 35;

  // Hard gate 1 — negative cashflow
  if (negativeCashflow) {
    triggeredRules.push({
      rule: "NEGATIVE_CASHFLOW",
      effect: "auto-fail",
      description: `Outflows ($${totalOutflow.toLocaleString()}) equal or exceed inflows ($${totalInflow.toLocaleString()}).`,
    });
  }

  // Confidence warnings
  if (!meetsMonths) {
    triggeredRules.push({
      rule: "INSUFFICIENT_MONTHS",
      effect: "confidence-warning",
      description: `Only ${monthCount} month(s) of inflow data found; minimum recommended is ${minMonths}. Score calculated from available data.`,
    });
  }
  if (!meetsTxn) {
    triggeredRules.push({
      rule: "INSUFFICIENT_TRANSACTIONS",
      effect: "confidence-warning",
      description: `Only ${transactionCount} transaction(s) found; minimum recommended is ${minTransactions}. Score calculated from available data.`,
    });
  }

  // Trend rule
  if (trendAnalysis.classification === "POSITIVE") {
    triggeredRules.push({
      rule: "TREND_POSITIVE",
      effect: "score-bonus",
      description: `Positive cashflow trajectory detected (+${TREND_SCORE_BONUS} pts). ${trendAnalysis.explanations[0] ?? ""}`,
    });
  } else if (trendAnalysis.classification === "NEGATIVE") {
    triggeredRules.push({
      rule: "TREND_NEGATIVE",
      effect: "score-penalty",
      description: `Negative cashflow trajectory detected (-${TREND_SCORE_PENALTY} pts). ${trendAnalysis.explanations[0] ?? ""}`,
    });
  }

  // Hard gate 2 — critically irregular income
  if (highlyIrregular) {
    triggeredRules.push({
      rule: "HIGH_IRREGULARITY",
      effect: veryHighlyIrregular ? "auto-fail" : "cap-review",
      description: `Income patterns are too irregular for a reliable assessment. ${irregularityFlags.join(" ")}`,
    });
  }

  // Score-based rules
  if (!negativeCashflow && !highlyIrregular) {
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

  // ── 8. Final decision ───────────────────────────────────────────────────
  let status: "PASS" | "REVIEW" | "FAIL";
  let statusReason: string;

  const confidenceNote = confidence !== "HIGH"
    ? ` (${confidence} confidence — ${confidenceReasons[0] ?? "limited data"})`
    : "";

  const trendNote =
    trendAnalysis.classification === "POSITIVE" ? ` ${trendAnalysis.explanations[0] ?? ""}` :
    trendAnalysis.classification === "NEGATIVE" ? ` ${trendAnalysis.explanations[0] ?? ""}` :
    "";

  if (negativeCashflow) {
    status = "FAIL";
    statusReason = `Net cashflow is negative — outflows equal or exceed inflows. ${cfLabel}.`;
  } else if (veryHighlyIrregular) {
    status = "FAIL";
    statusReason = `Income is critically irregular. Irregularity penalty: ${irregularityScore} pts. ${irregularityFlags.join("; ")}.`;
  } else if (highlyIrregular) {
    status = "REVIEW";
    statusReason = `Highly irregular income pattern requires manual review.${trendNote}${confidenceNote}`;
  } else if (totalScore >= passThreshold) {
    status = "PASS";
    statusReason = `Score ${totalScore}/100 meets the pass threshold (${passThreshold}). ${cfLabel}, ${actLabel.toLowerCase()}, and ${conLabel.toLowerCase()}.${trendNote}${confidenceNote}`;
  } else if (totalScore >= reviewThreshold) {
    status = "REVIEW";
    statusReason = `Score ${totalScore}/100 is below the pass threshold. ${conLabel}.${trendNote}${confidenceNote}`;
  } else {
    status = "FAIL";
    statusReason = `Score ${totalScore}/100 is below the review threshold (${reviewThreshold}).${trendNote}${confidenceNote}`;
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
      confidence,
      confidenceReasons,
      trendAnalysis,
      triggeredRules,
      configSnapshot,
    },
    status,
    confidence,
  };
}
