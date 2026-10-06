/**
 * Multi-factor credit assessment scoring engine.
 *
 * Evaluation layers (all rule-based, fully explainable):
 *
 *   1. Cashflow Strength      — weighted factor (configurable %)
 *   2. Activity Level         — weighted factor (configurable %)
 *   3. Income Consistency     — weighted factor (configurable %)
 *   4. Trend Intelligence     — additive modifier: POSITIVE +4, NEGATIVE −4
 *   5. Margin Health          — additive modifier: see MARGIN_* constants
 *   6. Revenue Concentration  — additive modifier: HIGH −4, MODERATE −2, LOW 0
 *
 * Confidence layer (data-sufficiency check, does not change verdict):
 *   HIGH   — at least 3 months and 10 transactions
 *   MEDIUM — at least 3 months and 5–9 transactions
 *   LOW    — fewer than 3 months or fewer than 5 transactions
 *
 * Hard gates (override score entirely):
 *   1. Negative cashflow (outflows ≥ inflows) → FAIL
 *   2. Critically irregular income             → FAIL / REVIEW
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

const MAX_INFLOW_GAP_DAYS     = 45;
const SPIKE_RATIO             = 2.5;
const HIGH_IRREGULARITY_CV    = 0.9;
const MODERATE_IRREGULARITY_CV = 0.55;
const CONFIDENCE_MIN_MONTHS   = 3;
const CONFIDENCE_LOW_MIN_TRANSACTIONS  = 5;
const CONFIDENCE_HIGH_MIN_TRANSACTIONS = 10;

// ---------------------------------------------------------------------------
// Trend intelligence constants
// ---------------------------------------------------------------------------

const TREND_SLOPE_THRESHOLD    = 0.05;  // ≥5% per month to count as a directional trend
const RECOVERY_SLOPE_THRESHOLD = 0.03;  // ≥3% on BOTH inflow+net → recovery momentum
const SEVERE_SLOPE_THRESHOLD   = 0.075; // ≥7.5% decline on BOTH signals → severe
const VOLATILITY_HIGH_CV       = 0.60;
const VOLATILITY_MODERATE_CV   = 0.25;
const TREND_SCORE_BONUS        = 4;
const TREND_SCORE_PENALTY      = 4;

// ---------------------------------------------------------------------------
// Revenue concentration constants
// ---------------------------------------------------------------------------

const HIGH_CONCENTRATION_LARGEST_PCT = 40;   // > 40% from single inflow → HIGH
const HIGH_CONCENTRATION_TOP3_PCT    = 80;   // > 80% from top 3         → HIGH
const MOD_CONCENTRATION_LARGEST_PCT  = 25;   // ≥ 25% from single inflow → MODERATE
const MOD_CONCENTRATION_TOP3_PCT     = 60;   // ≥ 60% from top 3         → MODERATE

const CONCENTRATION_MODERATE_PENALTY = 2;
const CONCENTRATION_HIGH_PENALTY     = 4;

// ---------------------------------------------------------------------------
// Margin health constants
// ---------------------------------------------------------------------------

const STRONG_MARGIN_PCT   = 30;  // > 30% net/inflow → Strong
const THIN_MARGIN_PCT     = 15;  // < 15% net/inflow → Thin
const VERY_THIN_MARGIN_PCT = 8;  // < 8%  net/inflow → Very Thin (within Thin class)

const MARGIN_STRONG_BONUS      = 2;
const MARGIN_THIN_PENALTY      = 3;
const MARGIN_VERY_THIN_PENALTY = 5;
const SEVERE_DETERIORATION_PENALTY = 3;
const RECOVERY_BONUS           = 1;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Ordinary least-squares slope for a sequence (index = x axis). */
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

/** Classify slope direction relative to mean magnitude. */
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

function buildMonthlyInflowMap(rows: TransactionRow[]): Map<string, number> {
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

function inflowStats(rows: TransactionRow[], monthlyInflows: number[]) {
  const inflows = rows
    .filter((r) => r.type === "Inflow")
    .map((r) => ({ date: new Date(r.date), amount: r.amount }))
    .filter((r) => !isNaN(r.date.getTime()))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const amounts = inflows.map((i) => i.amount);
  const dates   = inflows.map((i) => i.date);

  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    gaps.push((dates[i].getTime() - dates[i - 1].getTime()) / (1000 * 60 * 60 * 24));
  }

  // Income Consistency CV uses the same monthly inflow observation series as
  // Volatility Intelligence. Transaction-level amounts remain below for
  // spike detection, which intentionally uses individual transactions.
  const monthlyMean = monthlyInflows.length
    ? monthlyInflows.reduce((a, b) => a + b, 0) / monthlyInflows.length
    : 0;
  const cv = monthlyMean > 0 && monthlyInflows.length > 1
    ? stddev(monthlyInflows) / monthlyMean
    : null;
  const maxGapDays   = gaps.length ? Math.max(...gaps) : null;
  const longGapCount = gaps.filter((g) => g > MAX_INFLOW_GAP_DAYS).length;
  const transactionMean = amounts.length
    ? amounts.reduce((a, b) => a + b, 0) / amounts.length
    : 0;
  const spikeCount = transactionMean > 0
    ? amounts.filter((a) => a / transactionMean >= SPIKE_RATIO).length
    : 0;

  return { cv, maxGapDays, longGapCount, spikeCount };
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

export type AssessmentConfidence  = "HIGH" | "MEDIUM" | "LOW";
export type TrendClassification   = "POSITIVE" | "STABLE" | "NEGATIVE";
export type MarginClassification  = "Strong" | "Moderate" | "Thin";
export type ConcentrationRisk     = "LOW" | "MODERATE" | "HIGH";

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
  isSevereDeterioration: boolean;
  hasRecoveryMomentum: boolean;
  /** True when there are fewer than 2 months with inflow activity — no trend penalties are applied. */
  isInsufficientHistory: boolean;
}

export interface MarginHealth {
  marginRatio: number;
  classification: MarginClassification;
  scoreModifier: number;
  observations: string[];
  isSevereDeterioration: boolean;
  isRecovery: boolean;
}

export interface RevenueConcentration {
  inflowCount: number;
  largestInflow: number;
  largestInflowPct: number;
  top3Inflow: number;
  top3Pct: number;
  risk: ConcentrationRisk;
  scoreModifier: number;
  observations: string[];
}

export type ExpenseDependencyRisk = "LOW" | "MODERATE" | "HIGH";

export interface ExpenseDependency {
  outflowCount: number;
  largestExpense: number;
  largestExpensePct: number;
  top3Expense: number;
  top3Pct: number;
  risk: ExpenseDependencyRisk;
  scoreModifier: number;
  observations: string[];
}

export interface GovernanceOverride {
  rule:             string;
  triggerCondition: string;
  decisionImpact:   string;
  explanation:      string;
}

export interface GovernanceResult {
  overridesTriggered:  boolean;
  overrides:           GovernanceOverride[];
  provisionalDecision: "PASS" | "REVIEW" | "FAIL";
  finalDecision:       "PASS" | "REVIEW" | "FAIL";
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

export type VolatilityClassification = "LOW" | "MODERATE" | "ELEVATED" | "HIGH" | "SEVERE";

export interface VolatilityIntelligence {
  /** Per-month inflow totals used for the CV calculation. */
  monthlyInflows: { month: string; inflow: number }[];
  meanMonthlyInflow: number;
  stdDev: number;
  /** Coefficient of Variation expressed as a percentage. */
  cv: number;
  classification: VolatilityClassification;
  scoreModifier: number;
  explanations: string[];
  /** True when fewer than 3 months have inflow activity — no penalty is applied. */
  isInsufficientHistory: boolean;
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
  marginHealth: MarginHealth;
  revenueConcentration: RevenueConcentration;
  volatilityIntelligence: VolatilityIntelligence;
  expenseDependency: ExpenseDependency;
  governanceResult: GovernanceResult;
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
      inflow:  Math.round(inflow  * 100) / 100,
      outflow: Math.round(outflow * 100) / 100,
      net:     Math.round((inflow - outflow) * 100) / 100,
    }));

  if (monthlyData.length < 2) {
    return {
      monthlyData,
      classification: "STABLE",
      inflowTrend: "stable",
      outflowTrend: "stable",
      netTrend: "stable",
      volatility: "low",
      trendScore: 0,
      explanations: ["Trend cannot be evaluated due to insufficient monthly history — at least 2 months with inflow activity are required."],
      isSevereDeterioration: false,
      hasRecoveryMomentum: false,
      isInsufficientHistory: true,
    };
  }

  // Only months that actually contain inflow activity count toward trend eligibility.
  // An outflow-only month (e.g. expenses in a month before the first payment arrives)
  // is NOT evidence of declining revenue — missing future data is not deterioration.
  const monthsWithInflows = monthlyData.filter((m) => m.inflow > 0).length;

  if (monthsWithInflows < 2) {
    return {
      monthlyData,
      classification: "STABLE",
      inflowTrend: "stable",
      outflowTrend: "stable",
      netTrend: "stable",
      volatility: "low",
      trendScore: 0,
      explanations: [
        "Trend cannot be evaluated due to insufficient monthly history — at least 2 months with inflow activity are required.",
        "Months containing only outflows (no revenue) are not treated as evidence of decline.",
      ],
      isSevereDeterioration: false,
      hasRecoveryMomentum: false,
      isInsufficientHistory: true,
    };
  }

  // Compute slopes
  const inflows  = monthlyData.map((m) => m.inflow);
  const outflows = monthlyData.map((m) => m.outflow);
  const nets     = monthlyData.map((m) => m.net);

  const meanInflow   = inflows.reduce((a, b) => a + b, 0) / inflows.length;
  const meanOutflow  = outflows.reduce((a, b) => a + b, 0) / outflows.length;
  const meanAbsNet   = nets.map(Math.abs).reduce((a, b) => a + b, 0) / nets.length;

  const inflowSlope  = linearSlope(inflows);
  const outflowSlope = linearSlope(outflows);
  const netSlope     = linearSlope(nets);

  // Relative slopes (normalised to mean magnitude)
  const inflowRelSlope  = meanInflow  > 0 ? inflowSlope  / meanInflow  : 0;
  const outflowRelSlope = meanOutflow > 0 ? outflowSlope / meanOutflow : 0;
  const netRelSlope     = (meanAbsNet || 1) > 0 ? netSlope / (meanAbsNet || 1) : 0;

  const inflowTrend  = directionOf(inflowSlope,  meanInflow);
  const outflowTrend = directionOf(outflowSlope, meanOutflow);
  const rawNetDir    = directionOf(netSlope, meanAbsNet || 1);
  const netTrend: TrendAnalysis["netTrend"] =
    rawNetDir === "increasing" ? "improving" :
    rawNetDir === "declining"  ? "deteriorating" :
    "stable";

  // Volatility: CV of monthly net cashflow
  const netMean = nets.reduce((a, b) => a + b, 0) / nets.length;
  const netCV   = netMean !== 0
    ? Math.abs(stddev(nets) / netMean)
    : stddev(nets) > 0 ? 1 : 0;
  const volatility: TrendAnalysis["volatility"] =
    netCV > VOLATILITY_HIGH_CV     ? "high" :
    netCV > VOLATILITY_MODERATE_CV ? "moderate" :
    "low";

  // Recovery momentum: BOTH inflow and net improving at lower threshold, non-volatile
  const hasRecoveryMomentum =
    inflowRelSlope > RECOVERY_SLOPE_THRESHOLD &&
    netRelSlope    > RECOVERY_SLOPE_THRESHOLD &&
    volatility !== "high";

  // Severe deterioration: BOTH inflow and net declining significantly
  const isSevereDeterioration =
    inflowRelSlope < -SEVERE_SLOPE_THRESHOLD &&
    netRelSlope    < -SEVERE_SLOPE_THRESHOLD;

  // Overall classification
  const netImproving     = netTrend === "improving";
  const netDeteriorating = netTrend === "deteriorating";
  const inflowUp         = inflowTrend === "increasing";
  const inflowDown       = inflowTrend === "declining";
  const outflowUp        = outflowTrend === "increasing";

  let classification: TrendClassification;

  if (netImproving || (inflowUp && !outflowUp) || hasRecoveryMomentum) {
    classification = "POSITIVE";
  } else if (netDeteriorating || (inflowDown && outflowUp)) {
    classification = "NEGATIVE";
  } else {
    classification = "STABLE";
  }

  // Downgrade POSITIVE → STABLE when volatility is high (erratic ≠ improving)
  if (volatility === "high" && classification === "POSITIVE") {
    classification = "STABLE";
  }

  const trendScore =
    classification === "POSITIVE" ? TREND_SCORE_BONUS  :
    classification === "NEGATIVE" ? -TREND_SCORE_PENALTY :
    0;

  // Build human-readable explanations
  const explanations: string[] = [];

  // Recovery momentum takes priority for POSITIVE explanation
  if (hasRecoveryMomentum && classification === "POSITIVE") {
    explanations.push("Positive recovery trajectory detected — monthly operational performance is improving consistently.");
  } else if (inflowTrend === "increasing") {
    explanations.push("Inflows are increasing over the assessment period — business revenue is growing.");
  } else if (inflowTrend === "declining") {
    explanations.push("Declining inflow trend detected across the assessment period.");
  }

  if (isSevereDeterioration) {
    explanations.push("Severe deterioration risk identified — inflows are declining sharply while net cashflow worsens significantly.");
  } else if (outflowTrend === "increasing") {
    explanations.push("Outflows are rising month-over-month — costs are increasing.");
  } else if (outflowTrend === "declining") {
    explanations.push("Outflows are declining — cost control is improving.");
  }

  if (netTrend === "improving" && !hasRecoveryMomentum) {
    explanations.push("Business shows improving monthly net cashflow over the assessment period.");
  } else if (netTrend === "deteriorating" && !isSevereDeterioration) {
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
    isSevereDeterioration,
    hasRecoveryMomentum,
    isInsufficientHistory: false,
  };
}

// ---------------------------------------------------------------------------
// Margin health computation
// ---------------------------------------------------------------------------

function computeMarginHealth(
  totalInflow: number,
  netCashflow: number,
  trend: TrendAnalysis
): MarginHealth {
  const marginRatio = totalInflow > 0 ? (netCashflow / totalInflow) * 100 : 0;

  let classification: MarginClassification;
  let baseModifier: number;
  const observations: string[] = [];

  if (marginRatio > STRONG_MARGIN_PCT) {
    classification = "Strong";
    baseModifier   = MARGIN_STRONG_BONUS;
    observations.push(
      `Strong operational margins at ${marginRatio.toFixed(1)}% — business retains a healthy share of revenue.`
    );
  } else if (marginRatio >= THIN_MARGIN_PCT) {
    classification = "Moderate";
    baseModifier   = 0;
    observations.push(
      `Moderate operational margins at ${marginRatio.toFixed(1)}% — financially sustainable operations.`
    );
  } else if (marginRatio >= VERY_THIN_MARGIN_PCT) {
    classification = "Thin";
    baseModifier   = -MARGIN_THIN_PENALTY;
    observations.push(
      `Thin operational margins detected at ${marginRatio.toFixed(1)}% — limited buffer for operational disruptions.`
    );
    if (trend.inflowTrend === "stable" || trend.inflowTrend === "increasing") {
      observations.push("Business appears operationally fragile despite stable revenue.");
    }
  } else if (marginRatio > 0) {
    // Very thin: positive but below 8%
    classification = "Thin";
    baseModifier   = -MARGIN_VERY_THIN_PENALTY;
    observations.push(
      `Extremely thin operational margins at ${marginRatio.toFixed(1)}% — very limited financial buffer.`
    );
    observations.push("Business appears operationally fragile despite stable revenue.");
  } else {
    // Zero or negative net (hard gate handles this, but we still classify)
    classification = "Thin";
    baseModifier   = -MARGIN_VERY_THIN_PENALTY;
    observations.push("Negative or zero net cashflow — no operational margin available.");
  }

  // Severe deterioration: additional caution penalty
  const isSevereDeterioration = trend.isSevereDeterioration;
  if (isSevereDeterioration) {
    baseModifier -= SEVERE_DETERIORATION_PENALTY;
    observations.push(
      "Severe deterioration detected — inflows are declining sharply while net cashflow worsens significantly."
    );
  }

  // Recovery momentum bonus (only meaningful when margin is healthy enough)
  const isRecovery = trend.hasRecoveryMomentum && classification !== "Thin";
  if (isRecovery) {
    baseModifier += RECOVERY_BONUS;
    observations.push(
      "Positive recovery trajectory confirmed — monthly operational performance is strengthening consistently."
    );
  }

  // When thin margin + stable inflows exist together: add explicit fragility note if not already noted
  if (
    classification === "Thin" &&
    !isSevereDeterioration &&
    !isRecovery &&
    observations.length < 2
  ) {
    observations.push("Thin-margin businesses are vulnerable to revenue disruptions — cautious assessment warranted.");
  }

  return {
    marginRatio:          Math.round(marginRatio * 100) / 100,
    classification,
    scoreModifier:        Math.round(baseModifier),
    observations,
    isSevereDeterioration,
    isRecovery,
  };
}

// ---------------------------------------------------------------------------
// Revenue concentration computation
// ---------------------------------------------------------------------------

function computeRevenueConcentration(rows: TransactionRow[], totalInflow: number): RevenueConcentration {
  const inflowBySource = new Map<string, number>();
  const unlabelledInflowAmounts: number[] = [];

  rows.forEach((row) => {
    if (row.type !== "Inflow" || row.amount <= 0) return;

    // Description is the only source/customer identity currently preserved by
    // the parser. Normalize only whitespace and case; keep blank descriptions
    // separate so unknown sources are never merged into an invented identity.
    const normalizedDescription = row.description.trim().toLowerCase();
    if (!normalizedDescription) {
      unlabelledInflowAmounts.push(row.amount);
      return;
    }

    inflowBySource.set(
      normalizedDescription,
      (inflowBySource.get(normalizedDescription) ?? 0) + row.amount,
    );
  });

  const sourceAmounts = [...inflowBySource.values(), ...unlabelledInflowAmounts]
    .sort((a, b) => b - a);
  const inflowCount = sourceAmounts.length;

  if (inflowCount === 0 || totalInflow <= 0) {
    return {
      inflowCount: 0,
      largestInflow: 0,
      largestInflowPct: 0,
      top3Inflow: 0,
      top3Pct: 0,
      risk: "LOW",
      scoreModifier: 0,
      observations: ["No inflow transactions found — concentration analysis not applicable."],
    };
  }

  const largestInflow    = sourceAmounts[0];
  const largestInflowPct = Math.round((largestInflow / totalInflow) * 10000) / 100;

  const top3Amount = sourceAmounts.slice(0, 3).reduce((a, b) => a + b, 0);
  const top3Pct    = Math.round((top3Amount / totalInflow) * 10000) / 100;

  let risk: ConcentrationRisk;
  let scoreModifier: number;
  const observations: string[] = [];

  if (largestInflowPct > HIGH_CONCENTRATION_LARGEST_PCT || top3Pct > HIGH_CONCENTRATION_TOP3_PCT) {
    risk          = "HIGH";
    scoreModifier = -CONCENTRATION_HIGH_PENALTY;
    observations.push("Business appears highly dependent on a small number of inflows.");
    if (largestInflowPct > HIGH_CONCENTRATION_LARGEST_PCT) {
      observations.push(
        `Largest revenue source represents ${largestInflowPct.toFixed(1)}% of total revenue — significant single-source dependency detected.`
      );
    }
    if (top3Pct > HIGH_CONCENTRATION_TOP3_PCT) {
      observations.push(
        `Top 3 revenue sources account for ${top3Pct.toFixed(1)}% of total revenue — highly concentrated revenue base.`
      );
    }
  } else if (largestInflowPct >= MOD_CONCENTRATION_LARGEST_PCT || top3Pct >= MOD_CONCENTRATION_TOP3_PCT) {
    risk          = "MODERATE";
    scoreModifier = -CONCENTRATION_MODERATE_PENALTY;
    observations.push("Moderate dependence on a small number of inflows detected.");
    if (largestInflowPct >= MOD_CONCENTRATION_LARGEST_PCT) {
      observations.push(
        `Largest revenue source accounts for ${largestInflowPct.toFixed(1)}% of total revenue — monitor for single-customer risk.`
      );
    }
    if (top3Pct >= MOD_CONCENTRATION_TOP3_PCT) {
      observations.push(
        `Top 3 revenue sources represent ${top3Pct.toFixed(1)}% of total revenue — moderate revenue concentration.`
      );
    }
  } else {
    risk          = "LOW";
    scoreModifier = 0;
    observations.push("Revenue sources appear reasonably diversified.");
    observations.push(
      `Largest revenue source represents ${largestInflowPct.toFixed(1)}% of total revenue — within acceptable concentration limits.`
    );
  }

  return {
    inflowCount,
    largestInflow:    Math.round(largestInflow    * 100) / 100,
    largestInflowPct,
    top3Inflow:       Math.round(top3Amount       * 100) / 100,
    top3Pct,
    risk,
    scoreModifier,
    observations,
  };
}

// ---------------------------------------------------------------------------
// Volatility Intelligence computation
// ---------------------------------------------------------------------------

const VOLATILITY_LOW_THRESHOLD:      number = 10;  // CV < 10% → LOW
const VOLATILITY_MODERATE_THRESHOLD: number = 20;  // CV 10–20% → MODERATE
const VOLATILITY_ELEVATED_THRESHOLD: number = 50;  // CV 20–50% → ELEVATED
const VOLATILITY_HIGH_THRESHOLD:     number = 90;  // CV 50–90% → HIGH, >90% → SEVERE
const VOLATILITY_MODERATE_PENALTY:   number = 2;
const VOLATILITY_HIGH_PENALTY:       number = 5;
const VOLATILITY_MIN_MONTHS:         number = 3;   // minimum inflow months required

function computeVolatilityIntelligence(rows: TransactionRow[]): VolatilityIntelligence {
  // Build monthly inflow totals (inflows only)
  const monthMap = new Map<string, number>();
  for (const row of rows) {
    if (row.type !== "Inflow") continue;
    const d = new Date(row.date);
    if (isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthMap.set(key, (monthMap.get(key) ?? 0) + row.amount);
  }

  const monthlyInflows = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, inflow]) => ({
      month,
      inflow: Math.round(inflow * 100) / 100,
    }));

  const inflowValues = monthlyInflows.map((m) => m.inflow);
  const n = inflowValues.length;
  const mean = n > 0 ? inflowValues.reduce((a, b) => a + b, 0) / n : 0;

  if (n < VOLATILITY_MIN_MONTHS) {
    return {
      monthlyInflows,
      meanMonthlyInflow: Math.round(mean * 100) / 100,
      stdDev:  0,
      cv:      0,
      classification:    "LOW",
      scoreModifier:     0,
      explanations: [
        `Insufficient monthly history to evaluate volatility — at least ${VOLATILITY_MIN_MONTHS} months with inflow activity are required.`,
      ],
      isInsufficientHistory: true,
    };
  }

  const variance = inflowValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
  const stdDev   = Math.sqrt(variance);
  const cv       = mean > 0 ? (stdDev / mean) * 100 : 0;
  const cvRounded = Math.round(cv * 10) / 10;
  // Preserve the established scoring modifiers while applying the corrected
  // classification bands independently.
  const scoreModifierForExistingBands =
    cv < VOLATILITY_MODERATE_THRESHOLD
      ? 0
      : cv <= VOLATILITY_ELEVATED_THRESHOLD
      ? -VOLATILITY_MODERATE_PENALTY
      : -VOLATILITY_HIGH_PENALTY;

  let classification: VolatilityClassification;
  let scoreModifier: number;
  const explanations: string[] = [];

  if (cv < VOLATILITY_LOW_THRESHOLD) {
    classification = "LOW";
    scoreModifier  = 0;
    explanations.push("Monthly inflows remain relatively consistent.");
    explanations.push(`Revenue appears stable and predictable (CV: ${cvRounded}%).`);
  } else if (cv < VOLATILITY_MODERATE_THRESHOLD) {
    classification = "MODERATE";
    scoreModifier  = scoreModifierForExistingBands;
    explanations.push("Some month-to-month variation exists but remains manageable.");
    explanations.push(`Some variation in revenue patterns detected (CV: ${cvRounded}%).`);
  } else if (cv < VOLATILITY_ELEVATED_THRESHOLD) {
    classification = "ELEVATED";
    scoreModifier  = scoreModifierForExistingBands;
    explanations.push("Elevated month-to-month variation creates additional revenue uncertainty.");
    explanations.push(`Elevated variation in revenue patterns detected (CV: ${cvRounded}%, −${VOLATILITY_MODERATE_PENALTY} pts).`);
  } else if (cv <= VOLATILITY_HIGH_THRESHOLD) {
    classification = "HIGH";
    scoreModifier  = scoreModifierForExistingBands;
    explanations.push("Large swings in monthly revenue create operational uncertainty.");
    explanations.push(`Revenue fluctuates significantly from month to month (CV: ${cvRounded}%, ${scoreModifierForExistingBands} pts).`);
  } else {
    classification = "SEVERE";
    scoreModifier  = scoreModifierForExistingBands;
    explanations.push("Severe swings in monthly revenue create substantial operational uncertainty.");
    explanations.push(`Revenue fluctuates extremely from month to month (CV: ${cvRounded}%, −${VOLATILITY_HIGH_PENALTY} pts).`);
  }

  return {
    monthlyInflows,
    meanMonthlyInflow: Math.round(mean   * 100) / 100,
    stdDev:            Math.round(stdDev * 100) / 100,
    cv:                cvRounded,
    classification,
    scoreModifier,
    explanations,
    isInsufficientHistory: false,
  };
}

// ---------------------------------------------------------------------------
// Expense Dependency Intelligence computation
// ---------------------------------------------------------------------------

const HIGH_EXPENSE_LARGEST_PCT = 40;  // > 40% → HIGH
const MOD_EXPENSE_LARGEST_PCT  = 25;  // >= 25% → MODERATE
const EXPENSE_MODERATE_PENALTY = 2;
const EXPENSE_HIGH_PENALTY     = 4;

function computeExpenseDependency(rows: TransactionRow[], totalOutflow: number): ExpenseDependency {
  if (totalOutflow === 0) {
    return {
      outflowCount: 0,
      largestExpense: 0,
      largestExpensePct: 0,
      top3Expense: 0,
      top3Pct: 0,
      risk: "LOW",
      scoreModifier: 0,
      observations: ["No outflow data available for expense dependency analysis."],
    };
  }

  // Sort individual outflow transactions descending by amount
  const outflowAmounts = rows
    .filter((r) => r.type === "Outflow" && r.amount > 0)
    .map((r) => r.amount)
    .sort((a, b) => b - a);

  const outflowCount      = outflowAmounts.length;
  const largestExpense    = outflowAmounts[0] ?? 0;
  const largestExpensePct = (largestExpense / totalOutflow) * 100;
  const top3Amount        = outflowAmounts.slice(0, 3).reduce((a, b) => a + b, 0);
  const top3Pct           = (top3Amount / totalOutflow) * 100;

  let risk: ExpenseDependencyRisk;
  let scoreModifier: number;
  const observations: string[] = [];

  if (largestExpensePct > HIGH_EXPENSE_LARGEST_PCT) {
    risk          = "HIGH";
    scoreModifier = -EXPENSE_HIGH_PENALTY;
    observations.push("Business appears highly dependent on a small number of expenses. Operational disruption risk is elevated.");
    observations.push(
      `Largest single expense represents ${largestExpensePct.toFixed(1)}% of total outflows — significant single-expense dependency detected.`
    );
  } else if (largestExpensePct >= MOD_EXPENSE_LARGEST_PCT) {
    risk          = "MODERATE";
    scoreModifier = -EXPENSE_MODERATE_PENALTY;
    observations.push("Business shows moderate reliance on a small number of expense categories.");
    observations.push(
      `Largest single expense accounts for ${largestExpensePct.toFixed(1)}% of total outflows — monitor for expense concentration.`
    );
  } else {
    risk          = "LOW";
    scoreModifier = 0;
    observations.push("Expense structure appears diversified.");
    observations.push(
      `Largest single expense represents ${largestExpensePct.toFixed(1)}% of total outflows — within acceptable concentration limits.`
    );
  }

  return {
    outflowCount,
    largestExpense:    Math.round(largestExpense    * 100) / 100,
    largestExpensePct: Math.round(largestExpensePct * 10)  / 10,
    top3Expense:       Math.round(top3Amount        * 100) / 100,
    top3Pct:           Math.round(top3Pct           * 10)  / 10,
    risk,
    scoreModifier,
    observations,
  };
}

// ---------------------------------------------------------------------------
// Governance Rules Engine
// ---------------------------------------------------------------------------

const EXTREME_REVENUE_CONCENTRATION_THRESHOLD = 70;  // largestInflowPct >= 70% → extreme
const EXTREME_EXPENSE_DEPENDENCY_THRESHOLD     = 60;  // largestExpensePct >= 60% → extreme
const SEVERE_VOLATILITY_CV_THRESHOLD           = 90;  // CV >= 90% → severe

function computeGovernance(
  data: {
    revenueConcentration:   RevenueConcentration;
    expenseDependency:      ExpenseDependency;
    volatilityIntelligence: VolatilityIntelligence;
    consistency:            ConsistencyFactor;
    confidence:             AssessmentConfidence;
  },
  highlyIrregular: boolean,
  provisionalDecision: "PASS" | "REVIEW" | "FAIL"
): GovernanceResult {
  const overrides: GovernanceOverride[] = [];

  // Rule 1 — Extreme Revenue Concentration
  if (
    data.revenueConcentration.risk === "HIGH" &&
    data.revenueConcentration.largestInflowPct >= EXTREME_REVENUE_CONCENTRATION_THRESHOLD
  ) {
    overrides.push({
      rule:             "Extreme Revenue Concentration",
      triggerCondition: `Revenue Concentration Risk = HIGH and Largest Inflow ≥ ${EXTREME_REVENUE_CONCENTRATION_THRESHOLD}% (actual: ${data.revenueConcentration.largestInflowPct.toFixed(1)}%)`,
      decisionImpact:   "PASS not allowed — maximum result capped to REVIEW",
      explanation:      `Largest inflow represents ${data.revenueConcentration.largestInflowPct.toFixed(1)}% of total revenue. Business is highly dependent on a single revenue source. Result capped to REVIEW pending manual assessment.`,
    });
  }

  // Rule 2 — Extreme Expense Dependency
  if (
    data.expenseDependency.risk === "HIGH" &&
    data.expenseDependency.largestExpensePct >= EXTREME_EXPENSE_DEPENDENCY_THRESHOLD
  ) {
    overrides.push({
      rule:             "Extreme Expense Dependency",
      triggerCondition: `Expense Dependency Risk = HIGH and Largest Expense ≥ ${EXTREME_EXPENSE_DEPENDENCY_THRESHOLD}% (actual: ${data.expenseDependency.largestExpensePct.toFixed(1)}%)`,
      decisionImpact:   "PASS not allowed — maximum result capped to REVIEW",
      explanation:      `Largest expense represents ${data.expenseDependency.largestExpensePct.toFixed(1)}% of total outflows. Business is highly dependent on a single supplier, expense category, or operational cost. Result capped to REVIEW pending manual assessment.`,
    });
  }

  // Rule 3 — Severe Revenue Volatility
  if (
    !data.volatilityIntelligence.isInsufficientHistory &&
    data.volatilityIntelligence.cv >= SEVERE_VOLATILITY_CV_THRESHOLD
  ) {
    overrides.push({
      rule:             "Severe Revenue Volatility",
      triggerCondition: `Coefficient of Variation ≥ ${SEVERE_VOLATILITY_CV_THRESHOLD}% (actual: ${data.volatilityIntelligence.cv.toFixed(1)}%)`,
      decisionImpact:   "PASS not allowed — maximum result capped to REVIEW",
      explanation:      `Revenue volatility exceeds acceptable lending thresholds (CV: ${data.volatilityIntelligence.cv.toFixed(1)}%). Result capped to REVIEW pending manual assessment.`,
    });
  }

  // Rule 4 — Severe Income Irregularity
  if (data.consistency.normalizedScore === 0 || highlyIrregular) {
    overrides.push({
      rule:             "Severe Income Irregularity",
      triggerCondition: `Income Consistency Score = 0 or Highly Irregular Income Pattern detected`,
      decisionImpact:   "PASS not allowed — maximum result capped to REVIEW",
      explanation:      `Income patterns are too irregular for automatic approval. Result capped to REVIEW pending manual assessment.`,
    });
  }

  // Rule 5 — Low Confidence Protection
  if (data.confidence === "LOW") {
    overrides.push({
      rule:             "Low Assessment Confidence",
      triggerCondition: `Assessment Confidence = LOW`,
      decisionImpact:   "PASS not allowed — maximum result capped to REVIEW",
      explanation:      `Insufficient data confidence for automatic approval. Result capped to REVIEW pending manual assessment.`,
    });
  }

  const overridesTriggered = overrides.length > 0;
  const finalDecision: "PASS" | "REVIEW" | "FAIL" =
    overridesTriggered && provisionalDecision === "PASS" ? "REVIEW" : provisionalDecision;

  return { overridesTriggered, overrides, provisionalDecision, finalDecision };
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
  const netRatio    = totalInflow > 0 ? netCashflow / totalInflow : -1;

  const cfNorm     = normalizeCashflow(netRatio);
  const cfWeighted = Math.round((cfNorm * cashflowWeight) / 100 * 10) / 10;

  const cfLabel =
    cfNorm >= 90 ? "Excellent cashflow" :
    cfNorm >= 70 ? "Strong positive cashflow" :
    cfNorm >= 45 ? "Moderate positive cashflow" :
    cfNorm >= 20 ? "Slight positive cashflow" :
    netRatio > 0 ? "Near break-even cashflow" :
    "Negative cashflow";

  const cashflowStrength: CashflowStrengthFactor = {
    score:           cfWeighted,
    maxScore:        Math.round(cashflowWeight),
    label:           cfLabel,
    normalizedScore: cfNorm,
    weight:          cashflowWeight,
    netRatio:        Math.round(netRatio * 10000) / 10000,
    netCashflow,
  };

  // ── 2. Activity Level ───────────────────────────────────────────────────
  const actNorm     = normalizeActivity(transactionCount);
  const actWeighted = Math.round((actNorm * activityWeight) / 100 * 10) / 10;

  const actLabel =
    actNorm >= 85 ? "High activity" :
    actNorm >= 65 ? "Good activity" :
    actNorm >= 45 ? "Moderate activity" :
    actNorm >= 20 ? "Low activity" :
    "Very low activity";

  const activityLevel: ActivityLevelFactor = {
    score:           actWeighted,
    maxScore:        Math.round(activityWeight),
    label:           actLabel,
    normalizedScore: actNorm,
    weight:          activityWeight,
    transactionCount,
  };

  // ── 3. Income Consistency ───────────────────────────────────────────────
  const monthMap   = buildMonthlyInflowMap(rows);
  const monthCount = monthMap.size;
  const monthlyInflows = Array.from(monthMap.values())
    .map((inflow) => Math.round(inflow * 100) / 100);
  const { cv, maxGapDays, longGapCount, spikeCount } =
    inflowStats(rows, monthlyInflows);

  const irregularityFlags: string[] = [];
  let irregularityScore = 0;
  let conNorm: number;
  let conLabel: string;

  if (monthCount < 2 || cv === null) {
    conNorm  = 20;
    conLabel = "Insufficient history for consistency check";
    irregularityFlags.push("Cannot evaluate consistency with less than 2 months of data");
  } else {
    conNorm  = normalizeConsistency(cv);
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
  const conWeighted     = Math.round((adjustedConNorm * consistencyWeight) / 100 * 10) / 10;

  if (irregularityScore > 0 && monthCount >= 2) {
    conLabel =
      adjustedConNorm >= 65 ? "Consistent income" :
      adjustedConNorm >= 45 ? "Moderately consistent income" :
      adjustedConNorm >= 20 ? "Irregular income" :
      "Highly irregular income";
  }

  const consistency: ConsistencyFactor = {
    score:           conWeighted,
    maxScore:        Math.round(consistencyWeight),
    label:           conLabel,
    normalizedScore: adjustedConNorm,
    weight:          consistencyWeight,
    cv:              cv !== null ? Math.round(cv * 10000) / 10000 : null,
    monthCount,
    irregularityScore,
    irregularityFlags,
  };

  // ── 4. Trend Intelligence ───────────────────────────────────────────────
  const trendAnalysis = computeTrend(rows);

  // ── 5. Margin Health Intelligence ──────────────────────────────────────
  const marginHealth = computeMarginHealth(totalInflow, netCashflow, trendAnalysis);

  // ── 5b. Revenue Concentration Analysis ─────────────────────────────────
  const revenueConcentration = computeRevenueConcentration(rows, totalInflow);

  // ── 5c. Volatility Intelligence ─────────────────────────────────────────
  const volatilityIntelligence = computeVolatilityIntelligence(rows);

  // ── 5d. Expense Dependency Intelligence ─────────────────────────────────
  const expenseDependency = computeExpenseDependency(rows, totalOutflow);

  // ── 6. Total score (base + trend + margin + concentration + volatility + expense) ─
  const baseScore   = cfWeighted + actWeighted + conWeighted;
  const totalScore  = Math.round(
    Math.min(100, Math.max(0,
      baseScore
      + trendAnalysis.trendScore
      + marginHealth.scoreModifier
      + revenueConcentration.scoreModifier
      + volatilityIntelligence.scoreModifier
      + expenseDependency.scoreModifier
    ))
  );

  // ── 7. Confidence layer ─────────────────────────────────────────────────
  const meetsMonths = monthCount >= minMonths;
  const meetsTxn    = transactionCount >= minTransactions;
  const meetsConfidenceMonths = monthCount >= CONFIDENCE_MIN_MONTHS;
  const meetsLowConfidenceTransactions =
    transactionCount >= CONFIDENCE_LOW_MIN_TRANSACTIONS;
  const meetsHighConfidenceTransactions =
    transactionCount >= CONFIDENCE_HIGH_MIN_TRANSACTIONS;

  let confidence: AssessmentConfidence;
  const confidenceReasons: string[] = [];

  if (!meetsConfidenceMonths || !meetsLowConfidenceTransactions) {
    confidence = "LOW";
    if (!meetsConfidenceMonths) {
      confidenceReasons.push(
        `Assessment confidence is LOW due to insufficient monthly history (${monthCount} of ${CONFIDENCE_MIN_MONTHS} required months).`
      );
    }
    if (!meetsLowConfidenceTransactions) {
      confidenceReasons.push(
        `Assessment confidence is LOW due to insufficient transaction activity (${transactionCount} of ${CONFIDENCE_LOW_MIN_TRANSACTIONS} required transactions).`
      );
    }
  } else if (!meetsHighConfidenceTransactions) {
    confidence = "MEDIUM";
    confidenceReasons.push(
      `Assessment confidence is MEDIUM due to limited transaction activity (${transactionCount} of ${CONFIDENCE_HIGH_MIN_TRANSACTIONS} required transactions).`
    );
  } else {
    confidence = "HIGH";
  }

  // ── 8. Triggered rules ──────────────────────────────────────────────────
  const triggeredRules: TriggeredRule[] = [];
  const negativeCashflow    = totalOutflow >= totalInflow;
  const highlyIrregular     = (cv !== null && cv >= HIGH_IRREGULARITY_CV) || irregularityScore >= 25;
  const veryHighlyIrregular = irregularityScore >= 35;

  // Hard gate 1 — negative cashflow
  if (negativeCashflow) {
    triggeredRules.push({
      rule:        "NEGATIVE_CASHFLOW",
      effect:      "auto-fail",
      description: `Outflows ($${totalOutflow.toLocaleString()}) equal or exceed inflows ($${totalInflow.toLocaleString()}).`,
    });
  }

  // Confidence warnings
  if (!meetsMonths) {
    triggeredRules.push({
      rule:        "INSUFFICIENT_MONTHS",
      effect:      "confidence-warning",
      description: `Only ${monthCount} month(s) of inflow data found; minimum recommended is ${minMonths}. Score calculated from available data.`,
    });
  }
  if (!meetsTxn) {
    triggeredRules.push({
      rule:        "INSUFFICIENT_TRANSACTIONS",
      effect:      "confidence-warning",
      description: `Only ${transactionCount} transaction(s) found; minimum recommended is ${minTransactions}. Score calculated from available data.`,
    });
  }

  // Margin health rules
  const marginRatio = marginHealth.marginRatio;
  if (marginHealth.classification === "Strong") {
    triggeredRules.push({
      rule:        "MARGIN_STRONG",
      effect:      "score-bonus",
      description: `Strong operational margins at ${marginRatio.toFixed(1)}% of inflows (+${MARGIN_STRONG_BONUS} pts).`,
    });
  } else if (marginRatio >= 0 && marginRatio < VERY_THIN_MARGIN_PCT) {
    triggeredRules.push({
      rule:        "MARGIN_VERY_THIN",
      effect:      "score-penalty",
      description: `Extremely thin operational margins at ${marginRatio.toFixed(1)}% — very limited financial buffer (-${MARGIN_VERY_THIN_PENALTY} pts).`,
    });
  } else if (marginHealth.classification === "Thin") {
    triggeredRules.push({
      rule:        "MARGIN_THIN",
      effect:      "score-penalty",
      description: `Thin operational margins at ${marginRatio.toFixed(1)}% — limited buffer for operational disruptions (-${MARGIN_THIN_PENALTY} pts).`,
    });
  }

  // Trend rules
  if (trendAnalysis.classification === "POSITIVE") {
    triggeredRules.push({
      rule:        "TREND_POSITIVE",
      effect:      "score-bonus",
      description: `Positive cashflow trajectory detected (+${TREND_SCORE_BONUS} pts). ${trendAnalysis.explanations[0] ?? ""}`,
    });
  } else if (trendAnalysis.classification === "NEGATIVE") {
    triggeredRules.push({
      rule:        "TREND_NEGATIVE",
      effect:      "score-penalty",
      description: `Negative cashflow trajectory detected (-${TREND_SCORE_PENALTY} pts). ${trendAnalysis.explanations[0] ?? ""}`,
    });
  }

  // Severe deterioration additional penalty rule
  if (trendAnalysis.isSevereDeterioration) {
    triggeredRules.push({
      rule:        "SEVERE_DETERIORATION",
      effect:      "score-penalty",
      description: `Severe deterioration detected — inflows and net cashflow declining sharply (-${SEVERE_DETERIORATION_PENALTY} additional pts).`,
    });
  }

  // Recovery momentum bonus rule
  if (marginHealth.isRecovery) {
    triggeredRules.push({
      rule:        "RECOVERY_MOMENTUM",
      effect:      "score-bonus",
      description: `Recovery momentum confirmed — consistent improvement across inflows and net cashflow (+${RECOVERY_BONUS} pts).`,
    });
  }

  // Revenue concentration rules
  if (revenueConcentration.risk === "HIGH") {
    triggeredRules.push({
      rule:        "CONCENTRATION_HIGH",
      effect:      "score-penalty",
      description: `High revenue concentration detected — business appears highly dependent on a small number of inflows (-${CONCENTRATION_HIGH_PENALTY} pts). ${revenueConcentration.observations[1] ?? ""}`,
    });
  } else if (revenueConcentration.risk === "MODERATE") {
    triggeredRules.push({
      rule:        "CONCENTRATION_MODERATE",
      effect:      "score-penalty",
      description: `Moderate revenue concentration detected — some dependency on a small number of inflows (-${CONCENTRATION_MODERATE_PENALTY} pts). ${revenueConcentration.observations[1] ?? ""}`,
    });
  } else if (revenueConcentration.inflowCount > 0) {
    triggeredRules.push({
      rule:        "CONCENTRATION_LOW",
      effect:      "passed",
      description: `Revenue concentration is within acceptable limits — inflows appear reasonably diversified. Largest inflow: ${revenueConcentration.largestInflowPct.toFixed(1)}% of total.`,
    });
  }

  // Expense Dependency rules
  if (expenseDependency.risk === "HIGH") {
    triggeredRules.push({
      rule:        "EXPENSE_HIGH",
      effect:      "score-penalty",
      description: `High expense dependency detected — business appears highly dependent on a small number of expenses (-${EXPENSE_HIGH_PENALTY} pts). ${expenseDependency.observations[1] ?? ""}`,
    });
  } else if (expenseDependency.risk === "MODERATE") {
    triggeredRules.push({
      rule:        "EXPENSE_MODERATE",
      effect:      "score-penalty",
      description: `Moderate expense dependency detected — some reliance on a small number of expenses (-${EXPENSE_MODERATE_PENALTY} pts). ${expenseDependency.observations[1] ?? ""}`,
    });
  } else if (expenseDependency.outflowCount > 0) {
    triggeredRules.push({
      rule:        "EXPENSE_LOW",
      effect:      "passed",
      description: `Expense structure is diversified — no significant single-expense dependency detected. Largest expense: ${expenseDependency.largestExpensePct.toFixed(1)}% of total outflows.`,
    });
  }

  // Volatility Intelligence rules
  if (!volatilityIntelligence.isInsufficientHistory) {
    if (
      volatilityIntelligence.classification === "HIGH" ||
      volatilityIntelligence.classification === "SEVERE"
    ) {
      triggeredRules.push({
        rule:        "VOLATILITY_HIGH",
        effect:      "score-penalty",
        description: `${volatilityIntelligence.classification === "SEVERE" ? "Severe" : "High"} inflow volatility detected — revenue fluctuates significantly from month to month (-${VOLATILITY_HIGH_PENALTY} pts). CV: ${volatilityIntelligence.cv}%.`,
      });
    } else if (
      volatilityIntelligence.classification === "MODERATE" ||
      volatilityIntelligence.classification === "ELEVATED"
    ) {
      triggeredRules.push({
        rule:        "VOLATILITY_MODERATE",
        effect:      "score-penalty",
        description: `${volatilityIntelligence.classification === "ELEVATED" ? "Elevated" : "Moderate"} inflow volatility detected — some variation in monthly revenue (-${VOLATILITY_MODERATE_PENALTY} pts). CV: ${volatilityIntelligence.cv}%.`,
      });
    } else {
      triggeredRules.push({
        rule:        "VOLATILITY_LOW",
        effect:      "passed",
        description: `Inflow volatility is low — monthly revenue is stable and predictable. CV: ${volatilityIntelligence.cv}%.`,
      });
    }
  }

  // Hard gate 2 — critically irregular income
  if (highlyIrregular) {
    triggeredRules.push({
      rule:        "HIGH_IRREGULARITY",
      effect:      veryHighlyIrregular ? "auto-fail" : "cap-review",
      description: `Income patterns are too irregular for a reliable assessment. ${irregularityFlags.join(" ")}`,
    });
  }

  // Score determination rule
  if (!negativeCashflow && !highlyIrregular) {
    if (totalScore >= passThreshold) {
      triggeredRules.push({
        rule:        "SCORE_PASS",
        effect:      "passed",
        description: `Score ${totalScore}/100 meets the pass threshold (${passThreshold}).`,
      });
    } else if (totalScore >= reviewThreshold) {
      triggeredRules.push({
        rule:        "SCORE_REVIEW",
        effect:      "cap-review",
        description: `Score ${totalScore}/100 is above the review threshold (${reviewThreshold}) but below pass (${passThreshold}).`,
      });
    } else {
      triggeredRules.push({
        rule:        "SCORE_FAIL",
        effect:      "auto-fail",
        description: `Score ${totalScore}/100 is below the review threshold (${reviewThreshold}).`,
      });
    }
  }

  // ── 9. Final decision ───────────────────────────────────────────────────
  let status: "PASS" | "REVIEW" | "FAIL";
  let statusReason: string;

  const confidenceNote = confidence !== "HIGH"
    ? ` (${confidence} confidence — ${confidenceReasons[0] ?? "limited data"})`
    : "";

  const resilienceNote =
    marginHealth.classification === "Thin"
      ? ` ${marginHealth.observations[0] ?? "Thin operational margins detected."}`
      : marginHealth.isRecovery
      ? " Positive recovery momentum confirmed."
      : "";

  const trendNote =
    trendAnalysis.isSevereDeterioration
      ? " Severe cashflow deterioration detected."
      : trendAnalysis.classification === "POSITIVE" && !marginHealth.isRecovery
      ? ` ${trendAnalysis.explanations[0] ?? ""}`
      : trendAnalysis.classification === "NEGATIVE"
      ? ` ${trendAnalysis.explanations[0] ?? ""}`
      : "";

  if (negativeCashflow) {
    status = "FAIL";
    statusReason = `Net cashflow is negative — outflows equal or exceed inflows. ${cfLabel}.`;
  } else if (veryHighlyIrregular) {
    status = "FAIL";
    statusReason = `Income is critically irregular. Irregularity penalty: ${irregularityScore} pts. ${irregularityFlags.join("; ")}.`;
  } else if (highlyIrregular) {
    status = "REVIEW";
    statusReason = `Highly irregular income pattern requires manual review.${resilienceNote}${trendNote}${confidenceNote}`;
  } else if (totalScore >= passThreshold) {
    status = "PASS";
    statusReason = `Score ${totalScore}/100 meets the pass threshold (${passThreshold}). ${cfLabel}, ${actLabel.toLowerCase()}, and ${conLabel.toLowerCase()}.${resilienceNote}${trendNote}${confidenceNote}`;
  } else if (totalScore >= reviewThreshold) {
    status = "REVIEW";
    statusReason = `Score ${totalScore}/100 is below the pass threshold. ${conLabel}.${resilienceNote}${trendNote}${confidenceNote}`;
  } else {
    status = "FAIL";
    statusReason = `Score ${totalScore}/100 is below the review threshold (${reviewThreshold}).${resilienceNote}${trendNote}${confidenceNote}`;
  }

  // ── 10. Governance Rules Engine ─────────────────────────────────────────
  const governanceResult = computeGovernance(
    { revenueConcentration, expenseDependency, volatilityIntelligence, consistency, confidence },
    highlyIrregular,
    status
  );
  if (governanceResult.finalDecision !== status) {
    status       = governanceResult.finalDecision;
    statusReason = `Governance override applied — ${governanceResult.overrides.map(o => o.rule).join("; ")}. Original decision: ${governanceResult.provisionalDecision}. Score: ${totalScore}/100.`;
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
      marginHealth,
      revenueConcentration,
      volatilityIntelligence,
      expenseDependency,
      governanceResult,
      triggeredRules,
      configSnapshot,
    },
    status,
    confidence,
  };
}
