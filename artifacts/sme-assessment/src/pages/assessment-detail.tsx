import { useState } from "react";
import { Link, useParams } from "wouter";
import {
  useGetAssessment, getGetAssessmentQueryKey,
  useGetStatementMeta, usePreviewStatement,
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import {
  ArrowLeft, CheckCircle2, AlertCircle, XCircle, Loader2,
  TrendingUp, TrendingDown, Hash, Calendar, FileSpreadsheet,
  Activity, BarChart3, RefreshCw, AlertTriangle, ShieldX,
  ShieldCheck, ShieldAlert, Info, ArrowUpRight, ArrowDownRight,
  Minus, Zap, Shield, PieChart, Eye, ScrollText,
  Download, FileText, HardDrive, Lock, X, Table2,
  ClipboardList, Landmark,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose,
} from "@/components/ui/dialog";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
  Legend,
} from "recharts";

// ---------- Types ----------

type Confidence = "HIGH" | "MEDIUM" | "LOW";
type TrendClassification = "POSITIVE" | "STABLE" | "NEGATIVE";
type MarginClassification = "Strong" | "Moderate" | "Thin";

interface MonthlyDataPoint {
  month: string;
  inflow: number;
  outflow: number;
  net: number;
}

interface TrendAnalysisData {
  monthlyData: MonthlyDataPoint[];
  classification: TrendClassification;
  inflowTrend: "increasing" | "stable" | "declining";
  outflowTrend: "increasing" | "stable" | "declining";
  netTrend: "improving" | "stable" | "deteriorating";
  volatility: "low" | "moderate" | "high";
  trendScore: number;
  explanations: string[];
  isSevereDeterioration?: boolean;
  hasRecoveryMomentum?: boolean;
  isInsufficientHistory?: boolean;
}

interface MarginHealthData {
  marginRatio: number;
  classification: MarginClassification;
  scoreModifier: number;
  observations: string[];
  isSevereDeterioration: boolean;
  isRecovery: boolean;
}

type ConcentrationRisk = "LOW" | "MODERATE" | "HIGH";

interface RevenueConcentrationData {
  inflowCount: number;
  largestInflow: number;
  largestInflowPct: number;
  top3Inflow: number;
  top3Pct: number;
  risk: ConcentrationRisk;
  scoreModifier: number;
  observations: string[];
}

interface VolatilityIntelligenceData {
  monthlyInflows: { month: string; inflow: number }[];
  meanMonthlyInflow: number;
  stdDev: number;
  cv: number;
  classification: "LOW" | "MODERATE" | "ELEVATED" | "HIGH" | "SEVERE";
  scoreModifier: number;
  explanations: string[];
  isInsufficientHistory: boolean;
}

interface ExpenseDependencyData {
  outflowCount: number;
  largestExpense: number;
  largestExpensePct: number;
  top3Expense: number;
  top3Pct: number;
  risk: "LOW" | "MODERATE" | "HIGH";
  scoreModifier: number;
  observations: string[];
}

interface GovernanceOverrideData {
  rule:             string;
  triggerCondition: string;
  decisionImpact:   string;
  explanation:      string;
}

interface GovernanceResultData {
  overridesTriggered:  boolean;
  overrides:           GovernanceOverrideData[];
  provisionalDecision: "PASS" | "REVIEW" | "FAIL";
  finalDecision:       "PASS" | "REVIEW" | "FAIL";
}

interface TriggeredRule {
  rule: string;
  effect: "auto-fail" | "cap-review" | "score-penalty" | "score-bonus" | "passed" | "confidence-warning";
  description: string;
}

interface ScorecardFactor {
  score: number;
  maxScore: number;
  label: string;
  normalizedScore: number;
  weight: number;
}

interface ScorecardData {
  cashflowStrength: ScorecardFactor & { netRatio: number; netCashflow: number };
  activityLevel: ScorecardFactor & { transactionCount: number };
  consistency: ScorecardFactor & {
    cv: number | null;
    monthCount: number;
    irregularityScore: number;
    irregularityFlags: string[];
  };
  totalScore: number;
  maxScore: number;
  statusReason: string;
  confidence: Confidence;
  confidenceReasons: string[];
  trendAnalysis?: TrendAnalysisData;
  marginHealth?: MarginHealthData;
  revenueConcentration?: RevenueConcentrationData;
  volatilityIntelligence?: VolatilityIntelligenceData;
  expenseDependency?: ExpenseDependencyData;
  governanceResult?: GovernanceResultData;
  triggeredRules: TriggeredRule[];
  configSnapshot?: {
    passThreshold: number;
    reviewThreshold: number;
    minMonths: number;
    minTransactions: number;
    cashflowWeight: number;
    activityWeight: number;
    consistencyWeight: number;
  };
}

// ---------- Helpers ----------

function formatMonth(m: string): string {
  const [year, month] = m.split("-");
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function formatK(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function formatPct(n: number) {
  return (n * 100).toFixed(1) + "%";
}

// ---------- Small UI pieces ----------

function StatusBadge({ status }: { status: string }) {
  if (status === "PASS")
    return <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100 text-sm px-3 py-1"><CheckCircle2 className="h-4 w-4 mr-1.5" />PASS</Badge>;
  if (status === "REVIEW")
    return <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 text-sm px-3 py-1"><AlertCircle className="h-4 w-4 mr-1.5" />REVIEW</Badge>;
  return <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100 text-sm px-3 py-1"><XCircle className="h-4 w-4 mr-1.5" />FAIL</Badge>;
}

function ConfidenceBadge({ confidence }: { confidence?: Confidence }) {
  if (!confidence || confidence === "HIGH")
    return <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100 text-sm px-3 py-1"><ShieldCheck className="h-4 w-4 mr-1.5" />HIGH Confidence</Badge>;
  if (confidence === "MEDIUM")
    return <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 text-sm px-3 py-1"><ShieldAlert className="h-4 w-4 mr-1.5" />MEDIUM Confidence</Badge>;
  return <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100 text-sm px-3 py-1"><ShieldX className="h-4 w-4 mr-1.5" />LOW Confidence</Badge>;
}

function TrendBadge({ classification, isInsufficientHistory }: { classification?: TrendClassification; isInsufficientHistory?: boolean }) {
  if (isInsufficientHistory)
    return <Badge className="bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-100 text-sm px-3 py-1"><Info className="h-4 w-4 mr-1.5" />Insufficient History</Badge>;
  if (classification === "POSITIVE")
    return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100 text-sm px-3 py-1"><TrendingUp className="h-4 w-4 mr-1.5" />POSITIVE Trend</Badge>;
  if (classification === "NEGATIVE")
    return <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100 text-sm px-3 py-1"><TrendingDown className="h-4 w-4 mr-1.5" />NEGATIVE Trend</Badge>;
  return <Badge className="bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-100 text-sm px-3 py-1"><Minus className="h-4 w-4 mr-1.5" />STABLE Trend</Badge>;
}

function DirectionPill({ label, value }: { label: string; value: string }) {
  const isPositive = value === "increasing" || value === "improving" || value === "declining" && label === "Outflows";
  const isNegative = value === "declining" && label !== "Outflows" || value === "deteriorating" || value === "increasing" && label === "Outflows";
  const icon =
    value === "increasing" || value === "improving" ? <ArrowUpRight className="h-3 w-3" /> :
    value === "declining" || value === "deteriorating" ? <ArrowDownRight className="h-3 w-3" /> :
    <Minus className="h-3 w-3" />;
  const color =
    label === "Outflows"
      ? value === "declining" ? "text-green-700 bg-green-50 border-green-200"
        : value === "increasing" ? "text-red-700 bg-red-50 border-red-200"
        : "text-slate-600 bg-slate-50 border-slate-200"
      : isPositive ? "text-green-700 bg-green-50 border-green-200"
      : isNegative ? "text-red-700 bg-red-50 border-red-200"
      : "text-slate-600 bg-slate-50 border-slate-200";

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${color}`}>
      {icon} {label}: {value}
    </span>
  );
}

function ScoreBar({ score, maxScore, color }: { score: number; maxScore: number; color: string }) {
  const pct = Math.max(0, Math.min(100, (score / maxScore) * 100));
  return (
    <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function FactorCard({
  icon, title, score, maxScore, label, barColor, weight, normalizedScore, children,
}: {
  icon: React.ReactNode; title: string; score: number; maxScore: number;
  label: string; barColor: string; weight: number; normalizedScore: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-card-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">{icon}<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</p></div>
        <div className="text-right">
          <span className="text-sm font-bold text-foreground">{score.toFixed(1)}<span className="text-muted-foreground font-normal">/{maxScore}</span></span>
          <p className="text-[10px] text-muted-foreground">{weight}% weight</p>
        </div>
      </div>
      <ScoreBar score={normalizedScore} maxScore={100} color={barColor} />
      <p className="text-xs text-muted-foreground mt-2">{label}</p>
      {children && <div className="mt-3 pt-3 border-t border-card-border">{children}</div>}
    </div>
  );
}

function RuleChip({ rule }: { rule: TriggeredRule }) {
  const styles: Record<string, { bg: string; icon: React.ReactNode }> = {
    "auto-fail":          { bg: "bg-red-50 border-red-200 text-red-800",       icon: <ShieldX className="h-3.5 w-3.5 shrink-0 text-red-500" /> },
    "cap-review":         { bg: "bg-amber-50 border-amber-200 text-amber-800", icon: <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" /> },
    "score-penalty":      { bg: "bg-orange-50 border-orange-200 text-orange-800", icon: <TrendingDown className="h-3.5 w-3.5 shrink-0 text-orange-500" /> },
    "score-bonus":        { bg: "bg-emerald-50 border-emerald-200 text-emerald-800", icon: <TrendingUp className="h-3.5 w-3.5 shrink-0 text-emerald-500" /> },
    "passed":             { bg: "bg-green-50 border-green-200 text-green-800", icon: <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-green-500" /> },
    "confidence-warning": { bg: "bg-blue-50 border-blue-200 text-blue-800",   icon: <Info className="h-3.5 w-3.5 shrink-0 text-blue-500" /> },
  };
  const s = styles[rule.effect] ?? styles["cap-review"];
  const effectLabel: Record<string, string> = {
    "auto-fail":          "Auto-Fail",
    "cap-review":         "Capped to Review",
    "score-penalty":      "Score Penalty",
    "score-bonus":        "Score Bonus",
    "passed":             "Passed",
    "confidence-warning": "Confidence Warning",
  };
  return (
    <div className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 ${s.bg}`}>
      {s.icon}
      <div className="min-w-0">
        <span className="text-[10px] font-semibold uppercase tracking-wide block mb-0.5 opacity-70">{effectLabel[rule.effect] ?? rule.effect}</span>
        <p className="text-xs leading-relaxed">{rule.description}</p>
      </div>
    </div>
  );
}

// Custom chart tooltip
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-card-border rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-foreground mb-1.5">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 mb-0.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
          <span className="text-muted-foreground capitalize">{p.name}:</span>
          <span className="font-medium" style={{ color: p.color }}>{formatK(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- Concentration Section ----------

function ConcentrationRiskBadge({ risk }: { risk: ConcentrationRisk }) {
  if (risk === "LOW")
    return <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100 text-sm px-3 py-1"><CheckCircle2 className="h-4 w-4 mr-1.5" />LOW RISK</Badge>;
  if (risk === "MODERATE")
    return <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 text-sm px-3 py-1"><AlertCircle className="h-4 w-4 mr-1.5" />MODERATE RISK</Badge>;
  return <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100 text-sm px-3 py-1"><AlertTriangle className="h-4 w-4 mr-1.5" />HIGH RISK</Badge>;
}

function ConcentrationSection({ rc }: { rc: RevenueConcentrationData }) {
  const bgBorder =
    rc.risk === "LOW"      ? "bg-green-50 border-green-200" :
    rc.risk === "MODERATE" ? "bg-amber-50 border-amber-200" :
                              "bg-red-50 border-red-200";

  const modifierColor = rc.scoreModifier < 0 ? "text-orange-700" : "text-slate-500";

  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <PieChart className="h-4 w-4 text-violet-500" />
        Revenue Concentration
      </h2>

      <div className={`rounded-xl border px-5 py-4 ${bgBorder}`}>
        {/* Header row */}
        <div className="flex items-start gap-4 flex-wrap justify-between mb-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Concentration Risk</p>
            <ConcentrationRiskBadge risk={rc.risk} />
          </div>
          {rc.scoreModifier !== 0 && (
            <span className={`text-sm font-semibold ${modifierColor} mt-1`}>
              {rc.scoreModifier} pts applied
            </span>
          )}
        </div>

        {/* Metrics grid */}
        {rc.inflowCount > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="bg-white/60 rounded-lg px-3 py-2.5 border border-white">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Largest Source</p>
              <p className="text-base font-bold text-foreground">{formatCurrency(rc.largestInflow)}</p>
            </div>
            <div className="bg-white/60 rounded-lg px-3 py-2.5 border border-white">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Largest Source %</p>
              <p className={`text-base font-bold ${rc.largestInflowPct > HIGH_CONCENTRATION_LARGEST_PCT ? "text-red-700" : rc.largestInflowPct >= MOD_CONCENTRATION_LARGEST_PCT ? "text-amber-700" : "text-green-700"}`}>
                {rc.largestInflowPct.toFixed(1)}%
              </p>
            </div>
            <div className="bg-white/60 rounded-lg px-3 py-2.5 border border-white">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Top 3 Sources</p>
              <p className="text-base font-bold text-foreground">{formatCurrency(rc.top3Inflow)}</p>
            </div>
            <div className="bg-white/60 rounded-lg px-3 py-2.5 border border-white">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Top 3 %</p>
              <p className={`text-base font-bold ${rc.top3Pct > HIGH_CONCENTRATION_TOP3_PCT ? "text-red-700" : rc.top3Pct >= MOD_CONCENTRATION_TOP3_PCT ? "text-amber-700" : "text-green-700"}`}>
                {rc.top3Pct.toFixed(1)}%
              </p>
            </div>
          </div>
        ) : null}

        {/* Observations */}
        <ul className="space-y-1">
          {rc.observations.map((obs, i) => (
            <li key={i} className="text-xs text-muted-foreground leading-relaxed flex items-start gap-1.5">
              <span className="mt-1.5 h-1 w-1 rounded-full bg-muted-foreground/50 shrink-0" />
              {obs}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// Thresholds referenced in JSX (mirroring engine constants for coloring)
const HIGH_CONCENTRATION_LARGEST_PCT = 40;
const MOD_CONCENTRATION_LARGEST_PCT  = 25;
const HIGH_CONCENTRATION_TOP3_PCT    = 80;
const MOD_CONCENTRATION_TOP3_PCT     = 60;
const HIGH_EXPENSE_LARGEST_PCT       = 40;
const MOD_EXPENSE_LARGEST_PCT        = 25;

// ---------- Expense Dependency Section ----------

function ExpenseRiskBadge({ risk }: { risk: "LOW" | "MODERATE" | "HIGH" }) {
  if (risk === "HIGH")
    return <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100 text-sm px-3 py-1"><AlertTriangle className="h-4 w-4 mr-1.5" />HIGH Risk</Badge>;
  if (risk === "MODERATE")
    return <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 text-sm px-3 py-1"><AlertCircle className="h-4 w-4 mr-1.5" />MODERATE Risk</Badge>;
  return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100 text-sm px-3 py-1"><CheckCircle2 className="h-4 w-4 mr-1.5" />LOW Risk</Badge>;
}

function ExpenseDependencySection({ ed }: { ed: ExpenseDependencyData }) {
  const bgBorder =
    ed.risk === "LOW"      ? "bg-green-50 border-green-200" :
    ed.risk === "MODERATE" ? "bg-amber-50 border-amber-200" :
                              "bg-red-50 border-red-200";

  const modifierColor = ed.scoreModifier < 0 ? "text-orange-700" : "text-slate-500";

  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-orange-500" />
        Expense Dependency
      </h2>

      <div className={`rounded-xl border px-5 py-4 ${bgBorder}`}>
        {/* Header row */}
        <div className="flex items-start gap-4 flex-wrap justify-between mb-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Dependency Risk</p>
            <ExpenseRiskBadge risk={ed.risk} />
          </div>
          {ed.scoreModifier !== 0 && (
            <span className={`text-sm font-semibold ${modifierColor} mt-1`}>
              {ed.scoreModifier} pts applied
            </span>
          )}
        </div>

        {/* Metrics grid */}
        {ed.outflowCount > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="bg-white/60 rounded-lg px-3 py-2.5 border border-white">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Largest Expense</p>
              <p className="text-base font-bold text-foreground">{formatCurrency(ed.largestExpense)}</p>
            </div>
            <div className="bg-white/60 rounded-lg px-3 py-2.5 border border-white">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Largest Expense %</p>
              <p className={`text-base font-bold ${ed.largestExpensePct > HIGH_EXPENSE_LARGEST_PCT ? "text-red-700" : ed.largestExpensePct >= MOD_EXPENSE_LARGEST_PCT ? "text-amber-700" : "text-green-700"}`}>
                {ed.largestExpensePct.toFixed(1)}%
              </p>
            </div>
            <div className="bg-white/60 rounded-lg px-3 py-2.5 border border-white">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Top 3 Expenses</p>
              <p className="text-base font-bold text-foreground">{formatCurrency(ed.top3Expense)}</p>
            </div>
            <div className="bg-white/60 rounded-lg px-3 py-2.5 border border-white">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Top 3 %</p>
              <p className="text-base font-bold text-foreground">{ed.top3Pct.toFixed(1)}%</p>
            </div>
          </div>
        )}

        {/* Observations */}
        <ul className="space-y-1">
          {ed.observations.map((obs, i) => (
            <li key={i} className="text-xs text-muted-foreground leading-relaxed flex items-start gap-1.5">
              <span className="mt-1.5 h-1 w-1 rounded-full bg-muted-foreground/50 shrink-0" />
              {obs}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------- Volatility Intelligence Section ----------

function VolatilityBadge({ classification, isInsufficientHistory }: { classification?: "LOW" | "MODERATE" | "ELEVATED" | "HIGH" | "SEVERE"; isInsufficientHistory?: boolean }) {
  if (isInsufficientHistory)
    return <Badge className="bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-100 text-sm px-3 py-1"><Info className="h-4 w-4 mr-1.5" />Insufficient History</Badge>;
  if (classification === "SEVERE")
    return <Badge className="bg-red-100 text-red-900 border-red-300 hover:bg-red-100 text-sm px-3 py-1"><Activity className="h-4 w-4 mr-1.5" />SEVERE Volatility</Badge>;
  if (classification === "HIGH")
    return <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100 text-sm px-3 py-1"><Activity className="h-4 w-4 mr-1.5" />HIGH Volatility</Badge>;
  if (classification === "ELEVATED")
    return <Badge className="bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-100 text-sm px-3 py-1"><Activity className="h-4 w-4 mr-1.5" />ELEVATED Volatility</Badge>;
  if (classification === "MODERATE")
    return <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 text-sm px-3 py-1"><Activity className="h-4 w-4 mr-1.5" />MODERATE Volatility</Badge>;
  return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100 text-sm px-3 py-1"><Activity className="h-4 w-4 mr-1.5" />LOW Volatility</Badge>;
}

function VolatilitySection({ vi }: { vi: VolatilityIntelligenceData }) {
  const insufficient = vi.isInsufficientHistory;

  const bgBorder =
    insufficient              ? "bg-slate-50 border-slate-200" :
    vi.classification === "SEVERE"   ? "bg-red-50 border-red-300" :
    vi.classification === "HIGH"     ? "bg-red-50 border-red-200" :
    vi.classification === "ELEVATED" ? "bg-orange-50 border-orange-200" :
    vi.classification === "MODERATE" ? "bg-amber-50 border-amber-200" :
                                       "bg-emerald-50 border-emerald-200";

  const chartData = vi.monthlyInflows.map((m) => ({
    label: formatMonth(m.month),
    inflow: m.inflow,
  }));

  const cvColor =
    vi.cv >= 50 ? "text-red-700" :
    vi.cv >= 20 ? "text-amber-700" :
                  "text-emerald-700";

  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <Activity className="h-4 w-4 text-cyan-500" />
        Cashflow Volatility
      </h2>

      <div className={`rounded-xl border px-5 py-4 ${bgBorder}`}>
        {/* Header row */}
        <div className="flex items-start gap-4 flex-wrap justify-between mb-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Volatility Classification</p>
            <VolatilityBadge classification={vi.classification} isInsufficientHistory={insufficient} />
          </div>
          {!insufficient && vi.scoreModifier !== 0 && (
            <span className="text-sm font-semibold text-orange-700 mt-1">
              {vi.scoreModifier} pts applied
            </span>
          )}
        </div>

        {/* Metrics grid */}
        {!insufficient && vi.monthlyInflows.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            <div className="bg-white/60 rounded-lg px-3 py-2.5 border border-white">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Mean Monthly Inflow</p>
              <p className="text-base font-bold text-foreground">{formatCurrency(vi.meanMonthlyInflow)}</p>
            </div>
            <div className="bg-white/60 rounded-lg px-3 py-2.5 border border-white">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Std Deviation</p>
              <p className="text-base font-bold text-foreground">{formatCurrency(vi.stdDev)}</p>
            </div>
            <div className="bg-white/60 rounded-lg px-3 py-2.5 border border-white">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Coeff. of Variation</p>
              <p className={`text-base font-bold ${cvColor}`}>{vi.cv.toFixed(1)}%</p>
            </div>
          </div>
        )}

        {/* Monthly inflow bar chart */}
        {!insufficient && chartData.length >= 2 && (
          <div className="mb-4">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Monthly Inflow Totals</p>
            <ResponsiveContainer width="100%" height={140}>
              <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                <YAxis
                  tickFormatter={(v: number) => formatK(v)}
                  tick={{ fontSize: 10, fill: "#6b7280" }}
                  axisLine={false} tickLine={false} width={52}
                />
                <Tooltip
                  formatter={(v: number) => [formatCurrency(v), "Inflow"]}
                  labelStyle={{ fontSize: 11, fontWeight: 600 }}
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e5e7eb" }}
                />
                <Bar dataKey="inflow" fill="#06b6d4" radius={[3, 3, 0, 0]} name="Inflow" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Explanations */}
        <ul className="space-y-1">
          {vi.explanations.map((e, i) => (
            <li key={i} className="text-xs text-muted-foreground leading-relaxed flex items-start gap-1.5">
              <span className="mt-1.5 h-1 w-1 rounded-full bg-muted-foreground/50 shrink-0" />
              {e}
            </li>
          ))}
        </ul>
        {insufficient && (
          <p className="text-xs text-slate-500 mt-2 italic">
            No volatility penalty is applied when inflow history is insufficient.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------- Governance Overrides Section ----------

function GovernanceOverridesSection({ gr }: { gr: GovernanceResultData }) {
  if (!gr.overridesTriggered || gr.overrides.length === 0) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 px-5 py-3.5 flex items-center gap-3 mb-4">
        <ShieldCheck className="h-4 w-4 text-green-600 shrink-0" />
        <div>
          <p className="text-xs font-semibold text-green-800 uppercase tracking-wide">Governance</p>
          <p className="text-xs text-green-700 mt-0.5">No governance overrides applied.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-amber-600" />
        Governance Overrides
      </h2>
      <div className="space-y-3">
        {gr.overrides.map((ov, i) => (
          <div key={i} className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
            <div className="flex items-start gap-3 mb-3">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide mb-0.5">Governance Override Applied</p>
                <p className="text-sm font-bold text-foreground">{ov.rule}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 ml-7">
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Trigger Condition</p>
                <p className="text-xs text-foreground leading-relaxed">{ov.triggerCondition}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Decision Impact</p>
                <p className="text-xs font-semibold text-amber-700">{ov.decisionImpact}</p>
              </div>
            </div>
            <div className="ml-7 mt-3">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Explanation</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{ov.explanation}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Credit Narrative Generator ----------

interface GovernanceNarrativeItem {
  rule: string;
  trigger: string;
  decisionImpact: string;
  explanation: string;
}

interface ReviewArea {
  title: string;
  items: string[];
}

interface CreditNarrative {
  executiveSummary: string[];
  financialStrength: string;
  revenueQuality: string;
  expenseStructure: string;
  stability: string;
  trend: string;
  creditRisk: string;
  governanceItems: GovernanceNarrativeItem[];
  governanceConclusion: string;
  finalRecommendation: string;
  manualReviewAreas: ReviewArea[];
  assessmentConclusion: string;
  showReviewSection: boolean;
}

function generateCreditNarrative(
  sc: ScorecardData,
  status: "PASS" | "REVIEW" | "FAIL",
): CreditNarrative {
  const margin = sc.marginHealth;
  const rc     = sc.revenueConcentration;
  const ed     = sc.expenseDependency;
  const vi     = sc.volatilityIntelligence;
  const ta     = sc.trendAnalysis;
  const gov    = sc.governanceResult;
  const cf     = sc.cashflowStrength;
  const cons   = sc.consistency;

  // netRatio stored as 0–1 decimal; marginRatio stored as 0–100 percent
  const netRatioPct = (cf.netRatio * 100).toFixed(1);
  const marginPct   = margin ? margin.marginRatio.toFixed(1) : null;
  const passThresh  = sc.configSnapshot?.passThreshold ?? 70;

  // ── Derived risk/strength signals used for reconciliation throughout ─────
  const isMarginStrong      = margin ? margin.marginRatio >= 50 : cf.netRatio >= 0.5;
  const isMarginOk          = margin ? margin.marginRatio >= 25 : cf.netRatio >= 0.25;
  const hasInsufficientHistory = !!(vi?.isInsufficientHistory) || cons.monthCount < 3;
  const hasSevereVolatility = !!(vi && !vi.isInsufficientHistory && vi.classification === "SEVERE");
  const hasHighVolatility   = !!(vi && !vi.isInsufficientHistory && vi.classification === "HIGH");
  const hasElevatedVolatility = !!(vi && !vi.isInsufficientHistory && vi.classification === "ELEVATED");
  const hasModVolatility    = !!(vi && !vi.isInsufficientHistory && vi.classification === "MODERATE");
  const hasMaterialVolatility = hasElevatedVolatility || hasHighVolatility || hasSevereVolatility;
  const isConsistencyWeak   = typeof cons.normalizedScore === "number" && cons.normalizedScore < 45;
  const hasTrendPositive    = !!(ta && !ta.isInsufficientHistory && ta.classification === "POSITIVE");
  const hasTrendDeterior    = !!(ta && !ta.isInsufficientHistory && ta.classification === "NEGATIVE");
  const hasGovOverride      = !!(gov?.overridesTriggered);

  // Collect strengths and risks for the synthesis and recommendation sections
  const strengthFactors: string[] = [];
  const riskFactors: string[]     = [];

  if (isMarginStrong)  strengthFactors.push("strong operating cash generation");
  else if (isMarginOk) strengthFactors.push("positive operating surplus");
  if (!hasMaterialVolatility && !isConsistencyWeak && !hasInsufficientHistory) {
    strengthFactors.push("stable and predictable revenue patterns");
  }
  if (rc && rc.risk === "LOW")  strengthFactors.push("diversified revenue sources");
  if (ed && ed.risk === "LOW")  strengthFactors.push("a well-distributed expense structure");
  if (hasTrendPositive)         strengthFactors.push("an improving financial trajectory");

  if (hasSevereVolatility)
    riskFactors.push(`severe revenue volatility (CV: ${vi!.cv.toFixed(1)}%) materially limits repayment predictability`);
  else if (hasHighVolatility)
    riskFactors.push(`high cashflow volatility (CV: ${vi!.cv.toFixed(1)}%) limits repayment predictability`);
  else if (hasElevatedVolatility)
    riskFactors.push(`elevated revenue volatility (CV: ${vi!.cv.toFixed(1)}%) limits repayment predictability`);
  else if (hasModVolatility)
    riskFactors.push("moderate cashflow volatility introduces uncertainty in consistent repayment capacity");
  if (isConsistencyWeak)
    riskFactors.push("irregular income patterns reduce confidence in sustained cashflow");
  if (rc && rc.risk === "HIGH")
    riskFactors.push(`elevated revenue concentration (${rc.largestInflowPct.toFixed(1)}% from a single source) creates counterparty dependency risk`);
  else if (rc && rc.risk === "MODERATE")
    riskFactors.push(`moderate revenue concentration (${rc.largestInflowPct.toFixed(1)}% from the largest source) warrants monitoring`);
  if (ed && ed.risk === "HIGH")
    riskFactors.push("high expense dependency introduces cost-side vulnerability");
  if (hasTrendDeterior)
    riskFactors.push("a deteriorating performance trend raises concerns about forward-looking repayment capacity");
  if (ta?.isSevereDeterioration)
    riskFactors.push("severe cashflow deterioration has been identified");
  if (margin && margin.classification === "Thin")
    riskFactors.push("thin operational margins provide limited buffer for debt servicing under adverse conditions");

  // ── Section: Financial Strength ──────────────────────────────────────────
  const cashDesc = marginPct
    ? `a net operating margin of ${marginPct}%`
    : `a net cashflow ratio of ${netRatioPct}%`;

  let financialStrength: string;
  if (isMarginStrong) {
    if (hasHighVolatility || hasSevereVolatility || isConsistencyWeak || hasInsufficientHistory) {
      financialStrength = `The business currently generates strong operating cash surpluses, with ${cashDesc} indicating healthy retention of revenue after expenses. This reflects sound operational management and confirms that the business is profitable on a current basis. However, operational profitability and repayment reliability are distinct credit considerations. Strong margins confirm the business can generate surplus, but they do not in themselves guarantee that this surplus will be generated consistently and predictably over the term of a debt obligation.`;
    } else if (hasElevatedVolatility) {
      financialStrength = `The business demonstrates strong operational financial performance, with ${cashDesc} reflecting robust cash generation relative to total inflows. Margins are healthy and indicate the business retains a significant share of its revenue after meeting expenses. Elevated variation in monthly revenue limits confidence that this surplus will remain consistent throughout a lending period.`;
    } else if (hasModVolatility) {
      financialStrength = `The business demonstrates strong operational financial performance, with ${cashDesc} reflecting robust cash generation relative to total inflows. Margins are healthy and indicate the business retains a significant share of its revenue after meeting expenses. Some moderate variation in monthly cashflow is noted, but this does not materially detract from the overall strength of the financial position.`;
    } else {
      financialStrength = `The business demonstrates strong operational financial performance, with ${cashDesc} reflecting robust cash generation relative to total inflows. The level of surplus indicates healthy operational efficiency and supports confidence in the business's capacity to service debt obligations from ongoing cash generation.`;
    }
  } else if (isMarginOk) {
    if (hasHighVolatility || hasSevereVolatility || isConsistencyWeak || hasInsufficientHistory) {
      financialStrength = `The business maintains a positive operating surplus, with ${cashDesc} indicating satisfactory cash generation. While operations are currently profitable, the financial headroom is moderate. Combined with the revenue variability identified elsewhere in this assessment, the current margin level provides a limited buffer against fluctuations in revenue or unforeseen cost pressures that could affect debt serviceability.`;
    } else if (hasElevatedVolatility) {
      financialStrength = `The business maintains a positive operating surplus, with ${cashDesc} indicating satisfactory cash generation. Current profitability is positive, but elevated variation in monthly revenue limits the certainty of future debt serviceability.`;
    } else {
      financialStrength = `The business maintains a positive operating surplus, with ${cashDesc} indicating satisfactory cash generation. Margins are adequate and suggest the business is financially sustainable under current operating conditions, though the available headroom may reduce flexibility during periods of stress.`;
    }
  } else {
    financialStrength = `Financial performance is constrained, with ${cashDesc} indicating limited operating surplus relative to total inflows. The business is generating positive cashflow, but the narrow margin provides very limited capacity to absorb adverse conditions or sustain regular debt repayment without revenue remaining stable. Any deterioration in revenue would place immediate pressure on debt serviceability.`;
  }

  // ── Section: Revenue Quality ─────────────────────────────────────────────
  let revenueQuality: string;
  if (!rc) {
    revenueQuality = "Revenue concentration analysis is not available for this assessment.";
  } else if (rc.risk === "LOW") {
    const diverseNote = `Revenue sources appear reasonably diversified across ${rc.inflowCount} distinct inflow sources, with the largest single source representing ${rc.largestInflowPct.toFixed(1)}% of total receipts, presenting no material concentration risk.`;
    revenueQuality = hasMaterialVolatility
      ? `${diverseNote} However, diversification of inflow sources does not eliminate repayment risk where the volume of those inflows fluctuates significantly between periods. The combination of diverse but volatile revenue streams still creates uncertainty for consistent debt servicing.`
      : hasInsufficientHistory
      ? `${diverseNote} The available history is insufficient to establish stable or predictable revenue behaviour over a lending period.`
      : `${diverseNote} This distribution does not create material exposure to the loss of any single revenue source, which supports confidence in the stability of the business's income base.`;
  } else if (rc.risk === "MODERATE") {
    revenueQuality = `Revenue concentration risk is present and warrants monitoring. The largest single inflow source represents ${rc.largestInflowPct.toFixed(1)}% of total receipts${rc.top3Pct ? `, with the top three sources accounting for ${rc.top3Pct.toFixed(1)}%` : ""}. This level of dependency introduces counterparty and client concentration risk — a material reduction in activity from the dominant revenue source could directly affect cashflow available for debt servicing.`;
  } else {
    revenueQuality = `Revenue concentration risk is elevated and represents a material credit concern. The business appears highly dependent on a limited number of inflow sources, with the largest single source accounting for ${rc.largestInflowPct.toFixed(1)}% of total receipts${rc.top3Pct ? ` and the top three sources comprising ${rc.top3Pct.toFixed(1)}%` : ""}. The loss or reduction of the dominant revenue source would likely have an immediate and severe impact on the business's ability to service any debt obligation.`;
  }

  // ── Section: Expense Structure ───────────────────────────────────────────
  let expenseStructure: string;
  if (!ed) {
    expenseStructure = "Expense structure analysis is not available for this assessment.";
  } else if (ed.risk === "LOW") {
    expenseStructure = `The expense base appears well-distributed across ${ed.outflowCount} distinct expense categories, with the largest single item representing ${ed.largestExpensePct.toFixed(1)}% of total outflows. This diversification reduces the risk of operational disruption from the loss of a single supplier or a spike in any one cost category, supporting overall operational resilience.`;
  } else if (ed.risk === "MODERATE") {
    expenseStructure = `The expense structure shows moderate concentration, with the largest cost item representing ${ed.largestExpensePct.toFixed(1)}% of total outflows${ed.top3Pct ? ` and the top three expense categories accounting for ${ed.top3Pct.toFixed(1)}%` : ""}. This warrants monitoring, as a disruption to or significant increase in the dominant cost category could constrain available cashflow and reduce debt servicing capacity.`;
  } else {
    expenseStructure = `Expense dependency risk is elevated. The business demonstrates high reliance on a small number of cost categories or suppliers, with the largest single expense representing ${ed.largestExpensePct.toFixed(1)}% of total outflows${ed.top3Pct ? ` and the top three items comprising ${ed.top3Pct.toFixed(1)}%` : ""}. A significant disruption or cost increase in the dominant expense category would place direct pressure on net cashflow and debt serviceability.`;
  }

  // ── Section: Stability & Volatility ──────────────────────────────────────
  const irregFlagsSummary = cons.irregularityFlags && cons.irregularityFlags.length > 0
    ? cons.irregularityFlags.join("; ")
    : null;

  let stability: string;
  if (!vi || vi.isInsufficientHistory) {
    stability = "Revenue stability and volatility analysis could not be established because fewer than three months contain inflow activity. Current cashflow performance may be positive, but the limited history does not support a conclusion about predictable revenue over a lending period.";
  } else if (vi.classification === "LOW") {
    stability = `Revenue patterns are stable and predictable, with cashflow volatility measured at a low coefficient of variation of ${vi.cv.toFixed(1)}%. Consistent monthly revenue generation is a positive indicator for repayment predictability, as it reduces the risk of cashflow shortfalls during the repayment period.${irregFlagsSummary ? ` Despite low statistical volatility, the following irregularities were identified in the inflow pattern: ${irregFlagsSummary}. These should be considered alongside the overall stability picture.` : ""}`;
  } else if (vi.classification === "MODERATE") {
    stability = `Monthly cashflow shows moderate variation, with a coefficient of variation of ${vi.cv.toFixed(1)}% indicating manageable but noticeable fluctuations in revenue. This level of variability does not preclude lending but warrants careful consideration of repayment structure. A conservative debt service coverage ratio may be appropriate to accommodate periods of lower-than-average cashflow.${irregFlagsSummary ? ` Additional income irregularities noted: ${irregFlagsSummary}.` : ""}`;
  } else if (vi.classification === "ELEVATED") {
    stability = `Monthly cashflow shows elevated variation, with a coefficient of variation of ${vi.cv.toFixed(1)}% indicating material fluctuations in revenue. This level of variability limits confidence in consistent repayment capacity and warrants careful review of the business's revenue drivers and repayment structure.${irregFlagsSummary ? ` Additional income irregularities noted: ${irregFlagsSummary}.` : ""}`;
  } else {
    const marginReconcile = isMarginStrong
      ? " It is important to distinguish between current profitability and future repayment reliability: strong current margins indicate the business can generate surplus today, but high cashflow volatility means this level of surplus cannot be relied upon consistently over a lending period."
      : isMarginOk
        ? " This volatility, combined with moderate margins, reduces confidence in the business's ability to maintain consistent repayment throughout a lending period."
        : " This high volatility, alongside constrained margins, presents a compounding credit risk — both the level and consistency of surplus cashflow are uncertain.";
    const severity = vi.classification === "SEVERE" ? "severely unpredictable" : "highly unpredictable";
    stability = `Revenue patterns are ${severity}, with a coefficient of variation of ${vi.cv.toFixed(1)}% indicating significant month-to-month fluctuation in inflows. This level of volatility limits confidence in the business's ability to generate consistent cashflow for debt repayment.${marginReconcile}${irregFlagsSummary ? ` The following income irregularities were also identified: ${irregFlagsSummary}.` : ""}`;
  }

  // ── Section: Trend ───────────────────────────────────────────────────────
  let trend: string;
  if (!ta || ta.isInsufficientHistory) {
    trend = "Trend analysis could not be completed due to insufficient historical data. At least two months of inflow activity are required to assess the directional trajectory of the business. The absence of trend data limits forward-looking assessment confidence.";
  } else if (ta.classification === "POSITIVE") {
    const detail = ta.explanations[0] ?? "Revenue and cashflow indicators show a positive trajectory over the assessment period.";
    const cautionNote = hasMaterialVolatility
      ? " However, the positive trajectory should be interpreted in the context of material cashflow volatility identified elsewhere in this assessment. An improving average trend does not eliminate the risk of significant cashflow shortfalls in individual months, which could affect timely debt repayment."
      : "";
    trend = `${detail} An improving financial trajectory is a positive forward-looking indicator, suggesting the business is strengthening its operating position and may have increasing capacity to service debt obligations.${cautionNote}`;
  } else if (ta.classification === "STABLE") {
    const detail = ta.explanations[0] ?? "Revenue and cashflow metrics have remained broadly consistent over the assessment period.";
    trend = `${detail} The absence of a deteriorating trend is a neutral-to-positive finding, indicating that current financial performance levels are sustainable under recent operating conditions. Stable historical performance does not guarantee continued stability, particularly where other credit risk factors are present.`;
  } else {
    const detail = ta.explanations[0] ?? "Revenue and cashflow indicators show a declining trajectory over the assessment period.";
    const severeNote = ta.isSevereDeterioration
      ? " Deterioration is classified as severe, with both inflows and net cashflow declining at a rate that, if sustained, would materially impair the business's capacity to service a debt obligation within a standard lending period."
      : "";
    trend = `${detail}${severeNote} A deteriorating trend is a significant credit concern, as it raises questions about the sustainability of current performance and the business's ability to maintain cashflow sufficient for debt repayment over the agreed term.`;
  }

  // ── Section: Credit Risk Synthesis ───────────────────────────────────────
  // Reconciles operational strengths with lending risk factors into one picture.
  let creditRisk: string;
  if (strengthFactors.length > 0 && riskFactors.length > 0) {
    const strengthText = strengthFactors.length === 1
      ? strengthFactors[0]
      : strengthFactors.slice(0, -1).join(", ") + " and " + strengthFactors[strengthFactors.length - 1];
    const riskList = riskFactors.map((r, i) => `(${i + 1}) ${r}`).join("; ");
    creditRisk = `The credit risk profile presents a combination of operational strengths and lending concerns that must be assessed together. On the positive side, the business demonstrates ${strengthText}. However, the following credit risk factors have been identified: ${riskList}. These risk factors do not negate the financial strengths above, but they introduce material uncertainty about the consistency and predictability of future cashflow — which is the primary determinant of repayment reliability.`;
  } else if (riskFactors.length > 0) {
    const riskList = riskFactors.map((r, i) => `(${i + 1}) ${r}`).join("; ");
    creditRisk = `The credit risk assessment identifies the following concerns: ${riskList}. These factors collectively indicate elevated uncertainty about the business's ability to generate consistent cashflow for debt repayment. The assessment outcome reflects this risk level.`;
  } else {
    creditRisk = `No material credit risk factors have been identified beyond those already reflected in the overall assessment score. The business presents a relatively clean risk profile, with no significant concerns identified around cashflow predictability, revenue dependency, or trend deterioration.`;
  }

  // ── Section: Governance Items (structured per-override) ─────────────────
  const governanceItems: GovernanceNarrativeItem[] = gov?.overridesTriggered && gov.overrides.length > 0
    ? gov.overrides.map(ov => ({
        rule: ov.rule,
        trigger: ov.triggerCondition,
        decisionImpact: ov.decisionImpact,
        explanation: ov.explanation,
      }))
    : [];

  // ── Section: Governance Conclusion (consolidated) ────────────────────────
  let governanceConclusion = "";
  if (gov?.overridesTriggered && gov.overrides.length > 0) {
    const primaryRiskNames = gov.overrides.map(o => o.rule.replace(/_/g, " ").toLowerCase()).join(" and ");
    const opNote = isMarginStrong || isMarginOk
      ? "these governance conditions do not invalidate the financial strengths identified in this assessment — the positive cashflow and operational performance characteristics remain valid and should be considered by the reviewing underwriter as supporting evidence"
      : "these governance conditions confirm that the identified risk factors exceed the thresholds for automated approval";
    governanceConclusion = `Collectively, the governance conditions triggered (${primaryRiskNames}) indicate that, while the business may demonstrate positive operational characteristics, the stability and predictability of future cashflows remain outside the platform's acceptable automated lending thresholds. Specifically, ${opNote}. The Governance Rules Engine does not constitute an overall negative financial assessment — it exists to ensure that automated approval is only granted where repayment risk can be assessed with sufficient confidence. Manual credit assessment is therefore required before any lending commitment can be made.`;
  }

  // ── Section: Executive Summary (concise, integrated credit story) ────────
  const execParas: string[] = [];
  const netPositive = cf.netCashflow >= 0;

  // Single leading paragraph: operational performance → credit risk → decision → reason
  let opStatement: string;
  if (isMarginStrong) {
    opStatement = `The business demonstrates strong operating profitability${marginPct ? `, with a net margin of ${marginPct}%` : ""}, retaining a substantial share of revenue after meeting all operational expenses`;
  } else if (isMarginOk) {
    opStatement = `The business maintains a positive operating surplus${marginPct ? ` with a net margin of ${marginPct}%` : ""}, indicating satisfactory financial performance under current operating conditions`;
  } else if (!netPositive) {
    opStatement = `The business is operating with a negative net cashflow position, with total outflows equalling or exceeding total inflows`;
  } else {
    opStatement = `The business is generating positive cashflow but with constrained margins${marginPct ? ` (net margin: ${marginPct}%)` : ""}, providing limited financial buffer for debt service obligations`;
  }

  const primaryRisksExec: string[] = [];
  if (hasSevereVolatility) primaryRisksExec.push(`severe revenue volatility (CV: ${vi!.cv.toFixed(1)}%)`);
  else if (hasHighVolatility) primaryRisksExec.push(`high revenue volatility (CV: ${vi!.cv.toFixed(1)}%)`);
  else if (hasElevatedVolatility) primaryRisksExec.push(`elevated revenue volatility (CV: ${vi!.cv.toFixed(1)}%)`);
  else if (hasModVolatility) primaryRisksExec.push("moderate revenue volatility");
  if (isConsistencyWeak || (cons.irregularityFlags && cons.irregularityFlags.length > 0))
    primaryRisksExec.push("irregular income patterns");
  if (hasTrendDeterior) primaryRisksExec.push(`a${ta?.isSevereDeterioration ? " severe" : ""} deteriorating performance trend`);
  if (rc && rc.risk === "HIGH") primaryRisksExec.push(`elevated revenue concentration (${rc.largestInflowPct.toFixed(1)}% from a single source)`);
  if (margin && margin.classification === "Thin") primaryRisksExec.push("thin operational margins");
  if (ed && ed.risk === "HIGH") primaryRisksExec.push("high expense dependency");
  if (!netPositive) primaryRisksExec.push("a negative net cashflow position");

  let riskStatement: string;
  if (primaryRisksExec.length === 0) {
    riskStatement = "No material credit risk factors have been identified that would reduce confidence in future repayment capacity.";
  } else if (primaryRisksExec.length === 1) {
    riskStatement = `However, ${primaryRisksExec[0]} materially reduces confidence in future repayment consistency.`;
  } else {
    const listed = primaryRisksExec.slice(0, -1).join(", ") + " and " + primaryRisksExec[primaryRisksExec.length - 1];
    riskStatement = `However, ${listed} collectively reduce confidence in future repayment consistency.`;
  }

  let decisionStatement: string;
  if (status === "PASS") {
    decisionStatement = `The business satisfies the platform's automated lending thresholds with a score of ${sc.totalScore}/${sc.maxScore} and is assessed as suitable to proceed to credit approval.`;
  } else if (status === "REVIEW") {
    if (hasGovOverride) {
      decisionStatement = `Although financially ${isMarginStrong || isMarginOk ? "sound from an operational perspective" : "generating positive cashflow"}, the business does not currently satisfy the platform's automated lending thresholds. The Governance Rules Engine identified elevated lending risk conditions and assigned a final decision of REVIEW — manual credit assessment is required before any lending commitment can be made.`;
    } else {
      decisionStatement = `Although ${isMarginStrong ? "operationally profitable" : "generating positive cashflow"}, the business does not currently satisfy the platform's automated lending thresholds (score: ${sc.totalScore}/${sc.maxScore}; pass threshold: ${passThresh}) and therefore requires manual credit review before any lending decision is made.`;
    }
  } else {
    decisionStatement = !netPositive
      ? `The negative cashflow position represents a hard constraint that automatically disqualifies the business from automated approval at this time. A lending decision should not be made without further financial evidence and full manual assessment.`
      : `The business does not satisfy the platform's minimum creditworthiness requirements (score: ${sc.totalScore}/${sc.maxScore}) and is not currently suitable for a positive lending decision.`;
  }

  execParas.push(`${opStatement}. ${riskStatement} ${decisionStatement}`);

  // Supporting paragraph: score, consistency, trend, confidence
  const trendSummary = ta && !ta.isInsufficientHistory
    ? ta.classification === "POSITIVE"
      ? " The performance trend is positive over the assessment window."
      : ta.classification === "NEGATIVE"
        ? ` A${ta.isSevereDeterioration ? " severe" : ""} deteriorating trend has been identified over the assessment window.`
        : ""
    : "";
  const confidenceSuffix = sc.confidence !== "HIGH"
    ? ` Assessment confidence is ${sc.confidence}${sc.confidenceReasons && sc.confidenceReasons.length > 0 ? " — " + sc.confidenceReasons[0] : ""}.`
    : "";
  const consistencyNarrative = cons.monthCount < 2 || cons.cv === null
    ? "Income consistency could not be assessed reliably"
    : cons.normalizedScore >= 85
      ? "The business demonstrates a highly consistent revenue pattern"
      : cons.normalizedScore >= 65
        ? "Revenue patterns are consistent"
        : cons.normalizedScore >= 45
          ? "Revenue patterns show moderate consistency"
          : cons.normalizedScore >= 20
            ? "Revenue patterns are irregular"
            : "Revenue patterns show significant variability";

  execParas.push(
    `Assessment score: ${sc.totalScore}/${sc.maxScore} (pass threshold: ${passThresh}). ${consistencyNarrative}, measured across ${cons.monthCount} month${cons.monthCount !== 1 ? "s" : ""} of transaction data.${trendSummary}${confidenceSuffix}`
  );

  // ── Section: Final Recommendation ────────────────────────────────────────
  const strengthText = strengthFactors.length > 0
    ? strengthFactors.length === 1
      ? strengthFactors[0]
      : strengthFactors.slice(0, -1).join(", ") + " and " + strengthFactors[strengthFactors.length - 1]
    : null;
  const riskText = riskFactors.length > 0
    ? riskFactors.length === 1
      ? riskFactors[0]
      : riskFactors.slice(0, -1).join("; ") + "; and " + riskFactors[riskFactors.length - 1]
    : null;

  let finalRecommendation: string;
  if (status === "PASS") {
    finalRecommendation = strengthText
      ? `This business demonstrates ${strengthText}.${riskText ? ` While ${riskText}, these factors remain within acceptable automated assessment thresholds.` : ""} The business satisfies all assessment requirements and may proceed to credit approval, subject to standard due diligence and documentation review.`
      : "The business satisfies automated assessment requirements. Subject to standard due diligence, the application may proceed to credit approval.";
  } else if (status === "REVIEW") {
    finalRecommendation = strengthText && riskText
      ? `This business demonstrates ${strengthText}. However, ${riskText}. ${hasGovOverride ? "The Governance Rules Engine preserved the positive financial assessment but restricted the final decision because repayment predictability falls outside acceptable automated lending thresholds. " : ""}Manual underwriter assessment is recommended before any lending decision, with particular attention to the risk factors identified in this report.`
      : riskText
        ? `The assessment identified the following risk factors that prevent automatic approval: ${riskText}. Manual underwriter assessment is required before any lending or funding decision is made.`
        : hasGovOverride
          ? `Manual underwriter review is required before a lending or funding decision is made. Governance overrides were applied — an underwriter should review the flagged conditions and any supporting documentation before proceeding.`
          : "Manual review is required. The assessment score or data quality did not meet the threshold for automatic approval.";
  } else {
    finalRecommendation = strengthText
      ? `Although the business demonstrates ${strengthText}, the following critical risk factors prevent automated approval: ${riskText ?? "fundamental assessment thresholds were not met"}. A lending decision should not proceed without further financial evidence, a full manual underwriter assessment, and additional documentation addressing the identified concerns.`
      : "The business does not currently satisfy minimum assessment requirements. A lending or funding decision should not proceed without further financial evidence and a full manual underwriter assessment.";
  }

  // ── Section: Manual Review Areas (dynamic, evidence-based) ───────────────
  const showReviewSection = status === "REVIEW" || hasGovOverride;
  const manualReviewAreas: ReviewArea[] = [];

  if (showReviewSection) {
    if (hasMaterialVolatility || hasModVolatility) {
      manualReviewAreas.push({
        title: "Revenue Volatility",
        items: [
          `Determine whether the identified revenue volatility (CV: ${vi!.cv.toFixed(1)}%) is seasonal in nature or reflects a structural characteristic of the business model.`,
          "Request at least 12 months of bank statements to assess the full revenue cycle and identify any seasonal patterns.",
          "Obtain management commentary on the key drivers of month-to-month revenue variation.",
          "Request future revenue projections and the assumptions underpinning them.",
          ...(hasHighVolatility || hasSevereVolatility ? ["Consider whether a variable repayment structure aligned to cashflow cycles would be more appropriate than a fixed monthly instalment."] : []),
        ],
      });
    }

    if (isConsistencyWeak || (cons.irregularityFlags && cons.irregularityFlags.length > 0)) {
      manualReviewAreas.push({
        title: "Income Irregularity",
        items: [
          "Verify the existence and terms of recurring customer contracts or scheduled payment agreements.",
          "Confirm the forward revenue pipeline, including contracted and prospective revenue.",
          "Assess the payment behaviour and reliability of the business's key customers.",
          "Request a debtor aging analysis to evaluate the quality and timeliness of receivables.",
          ...(cons.irregularityFlags && cons.irregularityFlags.length > 0
            ? [`Review the following flagged income irregularities with management: ${cons.irregularityFlags.join("; ")}.`]
            : []),
        ],
      });
    }

    if (hasTrendDeterior) {
      manualReviewAreas.push({
        title: ta?.isSevereDeterioration ? "Severe Performance Deterioration" : "Deteriorating Performance Trend",
        items: [
          "Request a management explanation for the identified decline in revenue and/or net cashflow.",
          "Investigate whether the deterioration reflects a temporary disruption or a structural business challenge.",
          "If applicable, review the business's turnaround strategy, including timeline and key milestones.",
          "Assess whether the business has sufficient working capital to sustain operations during the review period.",
          ...(ta?.isSevereDeterioration
            ? ["Given the severity of the deterioration, management accounts and forward cashflow projections should be treated as mandatory supporting documents."]
            : []),
        ],
      });
    }

    if (rc && rc.risk === "HIGH") {
      manualReviewAreas.push({
        title: "Revenue Concentration",
        items: [
          `Verify the nature and contractual basis of the relationship with the dominant revenue source (${rc.largestInflowPct.toFixed(1)}% of total receipts).`,
          "Assess the stability, tenure, and contractual security of the key customer or revenue counterparty.",
          "Request evidence of customer diversification activity or a pipeline of alternative revenue sources.",
          "Evaluate the likely impact on monthly cashflow should the dominant revenue source reduce or cease.",
        ],
      });
    } else if (rc && rc.risk === "MODERATE") {
      manualReviewAreas.push({
        title: "Revenue Concentration",
        items: [
          `Monitor the dependency on the largest inflow source (${rc.largestInflowPct.toFixed(1)}% of total receipts).`,
          "Confirm whether the business has active plans to broaden its customer base.",
          "Request confirmation of the contractual relationship with the top revenue counterparties.",
        ],
      });
    }

    if (ed && ed.risk === "HIGH") {
      manualReviewAreas.push({
        title: "Expense Dependency",
        items: [
          `Assess the business's dependency on its largest supplier or cost category (${ed.largestExpensePct.toFixed(1)}% of total outflows).`,
          "Request details of alternative supplier arrangements or documented contingency plans.",
          "Evaluate the operational and cashflow impact should the dominant expense counterparty be disrupted or repriced.",
        ],
      });
    }

    if (!netPositive) {
      manualReviewAreas.push({
        title: "Negative Cashflow Position",
        items: [
          "Obtain a detailed management explanation for why outflows are meeting or exceeding inflows.",
          "Review the business's current liquidity position and any available credit facilities.",
          "Assess the working capital position and any upcoming significant payment obligations.",
          "Request a cashflow forecast demonstrating the business's path to a sustainable positive cashflow position.",
        ],
      });
    }

    if (sc.confidence === "LOW" || sc.confidence === "MEDIUM") {
      manualReviewAreas.push({
        title: "Data Sufficiency",
        items: [
          `Only ${cons.monthCount} month${cons.monthCount !== 1 ? "s" : ""} of transaction data was assessed — request additional bank statements to improve the reliability of this assessment.`,
          sc.confidence === "LOW"
            ? "A minimum of 6 months of bank statements is recommended to enable a comprehensive credit assessment."
            : "Where possible, extend the assessment period to cover at least 6 months of trading activity.",
          "Consider whether the limited data window accurately represents the business's typical trading activity and whether the period assessed was atypical.",
        ],
      });
    }
  }

  // ── Section: Assessment Conclusion ───────────────────────────────────────
  const opStrengthLabel = isMarginStrong
    ? `strong operating profitability${marginPct ? ` (net margin: ${marginPct}%)` : ""} and healthy cash generation`
    : isMarginOk
      ? `a positive operating surplus${marginPct ? ` (net margin: ${marginPct}%)` : ""} with satisfactory financial performance`
      : `limited operational profitability${marginPct ? ` (net margin: ${marginPct}%)` : ""}`;

  const opWeaknesses: string[] = [];
  if (margin && margin.classification === "Thin") opWeaknesses.push("thin operational margins");
  if (rc && rc.risk === "HIGH") opWeaknesses.push("high revenue concentration");
  else if (rc && rc.risk === "MODERATE") opWeaknesses.push("moderate revenue concentration");
  if (ed && ed.risk === "HIGH") opWeaknesses.push("elevated expense dependency");

  const creditRisksConclusion: string[] = [];
  if (hasSevereVolatility) creditRisksConclusion.push("severe revenue volatility");
  else if (hasHighVolatility) creditRisksConclusion.push("high revenue volatility");
  else if (hasElevatedVolatility) creditRisksConclusion.push("elevated revenue volatility");
  else if (hasModVolatility) creditRisksConclusion.push("moderate cashflow volatility");
  if (isConsistencyWeak) creditRisksConclusion.push("irregular income patterns");
  if (hasTrendDeterior) creditRisksConclusion.push(`a${ta?.isSevereDeterioration ? " severe" : ""} deteriorating performance trend`);
  if (!netPositive) creditRisksConclusion.push("a negative cashflow position");

  let conclusionDecisionReason: string;
  if (status === "PASS") {
    conclusionDecisionReason = "The business satisfies all automated assessment criteria. No material credit risks were identified that would prevent approval.";
  } else if (status === "REVIEW") {
    conclusionDecisionReason = hasGovOverride
      ? `The Governance Rules Engine identified conditions that prevent automated approval (${gov!.overrides.map(o => o.rule).join("; ")}). While the operational financial position is ${isMarginStrong || isMarginOk ? "sound" : "acceptable"}, the stability and predictability of future cashflows remain outside acceptable automated lending thresholds.`
      : `The assessment score of ${sc.totalScore}/${sc.maxScore} does not meet the automated pass threshold of ${passThresh}. The identified risk factors reduce confidence in consistent future repayment capacity.`;
  } else {
    conclusionDecisionReason = !netPositive
      ? "The negative cashflow position represents a hard constraint that disqualifies the business from automated approval at this time."
      : `The assessment score of ${sc.totalScore}/${sc.maxScore} falls below the minimum review threshold. The identified risk profile does not support a positive lending recommendation.`;
  }

  let conclusionNextAction: string;
  if (status === "PASS") {
    conclusionNextAction = "Subject to satisfactory completion of standard due diligence and documentation, the application may proceed to credit approval.";
  } else if (status === "REVIEW") {
    const topAreas = manualReviewAreas.slice(0, 2).map(a => a.title.toLowerCase());
    conclusionNextAction = topAreas.length > 0
      ? `Subject to satisfactory clarification of the identified risks during manual underwriter review — particularly regarding ${topAreas.join(" and ")} — the business may still represent an acceptable lending opportunity.`
      : "Subject to satisfactory clarification of the identified risk factors during manual underwriter review, the business may still represent an acceptable lending opportunity.";
  } else {
    conclusionNextAction = "A lending decision should not proceed without further financial evidence, a complete manual underwriter assessment, and — where applicable — demonstrable improvement in the business's financial position.";
  }

  const weaknessClause = opWeaknesses.length > 0
    ? ` Operational weaknesses identified include ${opWeaknesses.join(", ")}.`
    : "";
  const riskClause = creditRisksConclusion.length > 0
    ? ` From a credit risk perspective, ${creditRisksConclusion.length === 1 ? creditRisksConclusion[0] : creditRisksConclusion.slice(0, -1).join(", ") + " and " + creditRisksConclusion[creditRisksConclusion.length - 1]} reduce${creditRisksConclusion.length === 1 ? "s" : ""} confidence in consistent future repayment capacity.`
    : " No material credit risk factors were identified.";

  const assessmentConclusion = `The assessment identified a business with ${opStrengthLabel}.${weaknessClause}${riskClause} ${conclusionDecisionReason} ${conclusionNextAction}`;

  return {
    executiveSummary: execParas,
    financialStrength,
    revenueQuality,
    expenseStructure,
    stability,
    trend,
    creditRisk,
    governanceItems,
    governanceConclusion,
    finalRecommendation,
    manualReviewAreas,
    assessmentConclusion,
    showReviewSection,
  };
}

function NarrativeBlock({ title, text, accent }: { title: string; text: string; accent?: string }) {
  return (
    <div className={`rounded-lg border p-4 ${accent ?? "border-border bg-muted/20"}`}>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{title}</p>
      <p className="text-xs text-foreground leading-relaxed">{text}</p>
    </div>
  );
}

// ---------- Statement Viewer Modal ----------

function StatementPreviewTable({ assessmentId }: { assessmentId: number }) {
  const { data, isLoading, isError } = usePreviewStatement(assessmentId);
  if (isLoading) return (
    <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
  );
  if (isError || !data) return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
      <Table2 className="h-8 w-8 opacity-30" />
      <p className="text-sm">Unable to load preview</p>
    </div>
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-auto max-h-[50vh] rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              {data.headers.map((h) => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.rows.map((row, i) => (
              <tr key={i} className="hover:bg-muted/20">
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-2 text-foreground whitespace-nowrap max-w-48 overflow-hidden text-ellipsis">{String(cell ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.totalRows > data.previewRows && (
        <p className="text-xs text-muted-foreground text-center">
          Showing first {data.previewRows} of {data.totalRows} rows — download the full file to see all data.
        </p>
      )}
    </div>
  );
}

function StatementViewerModal({
  open, onClose, assessmentId, fileName, fileType,
}: {
  open: boolean;
  onClose: () => void;
  assessmentId: number;
  fileName: string;
  fileType: string;
}) {
  const isPdf = fileType === "pdf";
  const viewUrl = `/api/assessments/${assessmentId}/statement/view`;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl w-full max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b border-border flex flex-row items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
              <FileText className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold text-foreground truncate max-w-xl">{fileName}</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Original Bank Statement Preview</p>
            </div>
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </DialogClose>
        </DialogHeader>
        <div className="flex-1 overflow-hidden">
          {isPdf ? (
            <iframe
              src={viewUrl}
              title="Bank Statement"
              className="w-full h-full min-h-[60vh]"
              style={{ border: "none" }}
            />
          ) : (
            <div className="p-6 overflow-auto">
              <StatementPreviewTable assessmentId={assessmentId} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Statement Section ----------

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function fileTypeLabel(type: string): string {
  return type.toUpperCase();
}

function StatementSection({ assessmentId }: { assessmentId: number }) {
  const { data: meta, isLoading, isError } = useGetStatementMeta(assessmentId);
  const [viewerOpen, setViewerOpen] = useState(false);

  const downloadUrl = `/api/assessments/${assessmentId}/statement/download`;

  if (isLoading) {
    return (
      <div className="bg-card border border-card-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-5 w-5 rounded bg-muted animate-pulse" />
          <div className="h-3 w-40 rounded bg-muted animate-pulse" />
        </div>
        <div className="h-16 rounded-lg bg-muted animate-pulse" />
      </div>
    );
  }

  return (
    <div className="bg-card border border-card-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <FileText className="h-4 w-4 text-muted-foreground/70" />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Original Bank Statement</p>
      </div>

      {isError || !meta ? (
        <div className="flex items-center gap-3 py-3 px-4 rounded-lg bg-muted/30 border border-dashed border-border">
          <Lock className="h-4 w-4 text-muted-foreground/50" />
          <div>
            <p className="text-sm font-medium text-muted-foreground">Statement not available</p>
            <p className="text-xs text-muted-foreground/70 mt-0.5">This assessment was uploaded before file storage was enabled.</p>
          </div>
          <Badge variant="outline" className="ml-auto text-xs text-muted-foreground">Unavailable</Badge>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
            {[
              { icon: <FileSpreadsheet className="h-3.5 w-3.5" />, label: "Filename", value: meta.fileName },
              { icon: <Calendar className="h-3.5 w-3.5" />, label: "Uploaded", value: new Date(meta.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) },
              { icon: <HardDrive className="h-3.5 w-3.5" />, label: "File Size", value: formatFileSize(meta.fileSize) },
              { icon: <Hash className="h-3.5 w-3.5" />, label: "File Type", value: fileTypeLabel(meta.fileType) },
            ].map(({ icon, label, value }) => (
              <div key={label} className="flex flex-col gap-1">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  {icon}{label}
                </p>
                <p className="text-sm font-medium text-foreground truncate" title={value}>{value}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-4 border-t border-card-border">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setViewerOpen(true)}
            >
              <Eye className="h-3.5 w-3.5" />
              View Statement
            </Button>
            <a href={downloadUrl} download={meta.fileName}>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Download className="h-3.5 w-3.5" />
                Download
              </Button>
            </a>
            <Badge variant="outline" className="ml-auto text-green-700 border-green-300 text-xs">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Statement Available
            </Badge>
          </div>
        </>
      )}

      {meta && (
        <StatementViewerModal
          open={viewerOpen}
          onClose={() => setViewerOpen(false)}
          assessmentId={assessmentId}
          fileName={meta.fileName}
          fileType={meta.fileType}
        />
      )}
    </div>
  );
}

function CreditNarrativeSection({ sc, status }: { sc: ScorecardData; status: "PASS" | "REVIEW" | "FAIL" }) {
  const narrative = generateCreditNarrative(sc, status);
  const isGovOverride = narrative.governanceItems.length > 0;

  const recBorderClass = status === "PASS"
    ? "border-green-200 bg-green-50"
    : status === "REVIEW"
      ? "border-amber-200 bg-amber-50"
      : "border-red-200 bg-red-50";

  const recTextClass = status === "PASS" ? "text-green-800"
    : status === "REVIEW" ? "text-amber-800"
    : "text-red-800";

  const conclusionBorderClass = status === "PASS"
    ? "border-green-300 bg-green-50"
    : status === "REVIEW"
      ? "border-blue-200 bg-blue-50"
      : "border-red-200 bg-red-50";

  const conclusionTextClass = status === "PASS" ? "text-green-900"
    : status === "REVIEW" ? "text-blue-900"
    : "text-red-900";

  return (
    <div className="bg-card border border-card-border rounded-xl mb-6">
      <div className="px-5 py-4 border-b border-card-border flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <ScrollText className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Credit Narrative</h2>
        </div>
        <Badge variant="outline" className="text-[10px] text-muted-foreground font-normal">
          Auto-Generated
        </Badge>
      </div>

      <div className="px-5 py-5 space-y-6">

        {/* 1. Executive Summary */}
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Executive Summary</p>
          <div className="space-y-2">
            {narrative.executiveSummary.map((para, i) => (
              <p key={i} className={`leading-relaxed ${i === 0 ? "text-sm text-foreground font-medium" : "text-xs text-muted-foreground"}`}>{para}</p>
            ))}
          </div>
        </div>

        <div className="border-t border-card-border" />

        {/* 2. Detailed Commentary */}
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Detailed Commentary</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <NarrativeBlock title="Financial Strength" text={narrative.financialStrength} />
            <NarrativeBlock title="Revenue Quality" text={narrative.revenueQuality} />
            <NarrativeBlock title="Expense Structure" text={narrative.expenseStructure} />
            <NarrativeBlock title="Stability &amp; Volatility" text={narrative.stability} />
            <NarrativeBlock
              title="Trend Analysis"
              text={narrative.trend}
              accent={
                sc.trendAnalysis?.classification === "POSITIVE" ? "border-green-200 bg-green-50"
                : sc.trendAnalysis?.classification === "NEGATIVE" ? "border-red-200 bg-red-50"
                : undefined
              }
            />
            <NarrativeBlock
              title="Credit Risk"
              text={narrative.creditRisk}
              accent={
                status === "FAIL" ? "border-red-200 bg-red-50"
                : status === "REVIEW" ? "border-amber-200 bg-amber-50"
                : "border-blue-200 bg-blue-50"
              }
            />
          </div>
        </div>

        {/* 3. Governance Commentary (structured per override + consolidated conclusion) */}
        {isGovOverride && (
          <>
            <div className="border-t border-card-border" />
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <ShieldAlert className="h-3 w-3 text-amber-600" />
                Governance Commentary
              </p>
              <div className="space-y-3">
                {narrative.governanceItems.map((item, i) => (
                  <div key={i} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-2">
                    <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wide">
                      {item.rule.replace(/_/g, " ")}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
                      <div>
                        <span className="font-semibold text-amber-800">Trigger: </span>
                        <span className="text-amber-900">{item.trigger}</span>
                      </div>
                      <div>
                        <span className="font-semibold text-amber-800">Decision impact: </span>
                        <span className="text-amber-900">{item.decisionImpact}</span>
                      </div>
                    </div>
                    <p className="text-xs text-amber-900 leading-relaxed">{item.explanation}</p>
                  </div>
                ))}
                {narrative.governanceConclusion && (
                  <div className="rounded-lg border border-amber-300 bg-amber-100 px-4 py-3">
                    <p className="text-[10px] font-bold text-amber-800 uppercase tracking-wide mb-1.5">Governance Conclusion</p>
                    <p className="text-xs text-amber-900 leading-relaxed">{narrative.governanceConclusion}</p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        <div className="border-t border-card-border" />

        {/* 4. Final Recommendation */}
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Final Recommendation</p>
          <div className={`rounded-lg border px-4 py-3 ${recBorderClass}`}>
            <p className={`text-sm font-medium leading-relaxed ${recTextClass}`}>{narrative.finalRecommendation}</p>
          </div>
        </div>

        {/* 5. Recommended Manual Review Areas (REVIEW or gov override only) */}
        {narrative.showReviewSection && narrative.manualReviewAreas.length > 0 && (
          <>
            <div className="border-t border-card-border" />
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <ClipboardList className="h-3 w-3 text-muted-foreground" />
                Recommended Manual Review Areas
              </p>
              <div className="space-y-3">
                {narrative.manualReviewAreas.map((area, i) => (
                  <div key={i} className="rounded-lg border border-border bg-muted/10 px-4 py-3">
                    <p className="text-[10px] font-bold text-foreground uppercase tracking-wide mb-2">{area.title}</p>
                    <ul className="space-y-1.5">
                      {area.items.map((item, j) => (
                        <li key={j} className="text-xs text-foreground leading-relaxed flex gap-2">
                          <span className="text-muted-foreground mt-0.5 shrink-0">•</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* 6. Assessment Conclusion */}
        <>
          <div className="border-t border-card-border" />
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Landmark className="h-3 w-3 text-muted-foreground" />
              Assessment Conclusion
            </p>
            <div className={`rounded-lg border px-4 py-4 ${conclusionBorderClass}`}>
              <p className={`text-sm leading-relaxed ${conclusionTextClass}`}>{narrative.assessmentConclusion}</p>
            </div>
          </div>
        </>

      </div>
    </div>
  );
}

// ---------- Assessment Diagnostics ----------

function AssessmentDiagnostics({ sc }: { sc: ScorecardData }) {
  const rc = sc.revenueConcentration;
  const mh = sc.marginHealth;
  const ta = sc.trendAnalysis;
  const vi = sc.volatilityIntelligence;
  const ed = sc.expenseDependency;

  const insufficient = !!ta?.isInsufficientHistory;
  const insufficientAssessmentHistory =
    sc.confidence === "LOW" || sc.consistency.monthCount < 3 || !!vi?.isInsufficientHistory;

  const positiveSignals: { label: string; detail: string }[] = [];
  const riskSignals:     { label: string; detail: string }[] = [];
  const infoSignals:     { label: string; detail: string }[] = [];

  // ── Positive signals ─────────────────────────────────────────────────
  if (sc.cashflowStrength.normalizedScore >= 70) {
    positiveSignals.push({
      label:  "Strong Cashflow",
      detail: `Net cashflow ratio ${(sc.cashflowStrength.netRatio * 100).toFixed(1)}% — business retains a healthy surplus from operations.`,
    });
  }
  if (!insufficientAssessmentHistory && sc.consistency.normalizedScore >= 65) {
    positiveSignals.push({
      label:  "Consistent Income",
      detail: "Regular and predictable inflow patterns detected across the assessment period.",
    });
  }
  // Positive trend: only shown when history is sufficient (classification is POSITIVE only when !insufficient)
  if (!insufficient && ta?.classification === "POSITIVE") {
    positiveSignals.push({
      label:  "Positive Trend",
      detail: ta.explanations[0] ?? "Cashflow is improving over the assessment period.",
    });
  }
  if (mh?.classification === "Strong" && !mh?.isSevereDeterioration) {
    positiveSignals.push({
      label:  "Strong Resilience",
      detail: `Operational margins at ${mh.marginRatio.toFixed(1)}% — healthy financial buffer above operating costs.`,
    });
  }
  // Volatility positive signal: only when sufficient history and LOW classification
  if (!vi?.isInsufficientHistory && vi?.classification === "LOW") {
    positiveSignals.push({
      label:  "Stable Revenue Patterns",
      detail: `Revenue patterns are stable and predictable (CV: ${vi.cv.toFixed(1)}%).`,
    });
  }
  // Expense dependency positive signal
  if (ed && ed.risk === "LOW" && ed.outflowCount > 0) {
    positiveSignals.push({
      label:  "Diversified Expense Structure",
      detail: `Expense structure appears diversified. Largest single expense represents ${ed.largestExpensePct.toFixed(1)}% of total outflows.`,
    });
  }

  // ── Risk signals ─────────────────────────────────────────────────────
  if (rc && rc.risk !== "LOW" && rc.inflowCount > 0) {
    riskSignals.push({
      label:  `Revenue Concentration (${rc.risk})`,
      detail: rc.observations[0] ?? "Dependence on a small number of inflows detected.",
    });
  }
  if (mh?.classification === "Thin") {
    riskSignals.push({
      label:  "Thin Margins",
      detail: mh.observations[0] ?? "Limited financial buffer for operational disruptions.",
    });
  }
  // Volatility risk signals driven by VolatilityIntelligence (not trendAnalysis.volatility)
  if (!vi?.isInsufficientHistory && vi?.classification === "SEVERE") {
    riskSignals.push({
      label:  "Severe Revenue Volatility",
      detail: `Revenue is severely unpredictable and varies significantly between months (CV: ${vi.cv.toFixed(1)}%).`,
    });
  } else if (!vi?.isInsufficientHistory && vi?.classification === "HIGH") {
    riskSignals.push({
      label:  "High Revenue Volatility",
      detail: `Revenue is highly unpredictable and varies significantly between months (CV: ${vi.cv.toFixed(1)}%).`,
    });
  } else if (!vi?.isInsufficientHistory && vi?.classification === "ELEVATED") {
    riskSignals.push({
      label:  "Elevated Revenue Volatility",
      detail: `Material fluctuations in monthly revenue detected (CV: ${vi.cv.toFixed(1)}%).`,
    });
  } else if (!vi?.isInsufficientHistory && vi?.classification === "MODERATE") {
    riskSignals.push({
      label:  "Moderate Revenue Volatility",
      detail: `Moderate fluctuations in monthly revenue detected (CV: ${vi.cv.toFixed(1)}%).`,
    });
  }
  // Expense dependency risk signals
  if (ed && ed.risk === "HIGH" && ed.outflowCount > 0) {
    riskSignals.push({
      label:  "High Expense Dependency",
      detail: `Business appears highly dependent on a small number of expenses. Operational disruption risk is elevated. Largest expense: ${ed.largestExpensePct.toFixed(1)}% of total outflows.`,
    });
  } else if (ed && ed.risk === "MODERATE" && ed.outflowCount > 0) {
    riskSignals.push({
      label:  "Moderate Expense Dependency",
      detail: `Business shows moderate reliance on a small number of expense categories. Largest expense: ${ed.largestExpensePct.toFixed(1)}% of total outflows.`,
    });
  }
  // Deterioration: only valid when sufficient trend history
  if (!insufficient && (ta?.isSevereDeterioration || ta?.classification === "NEGATIVE")) {
    riskSignals.push({
      label:  ta?.isSevereDeterioration ? "Severe Deterioration" : "Negative Trend",
      detail: ta?.explanations[0] ?? "Cashflow is showing a declining trajectory.",
    });
  }

  // ── Information signals ───────────────────────────────────────────────
  if (insufficient) {
    infoSignals.push({
      label:  "Insufficient History for Trend Analysis",
      detail: "Fewer than 2 months of inflow activity were detected — trend direction and deterioration risk cannot be reliably evaluated. No trend-related penalties are applied.",
    });
  }
  if (vi?.isInsufficientHistory) {
    infoSignals.push({
      label:  "Insufficient History for Volatility Analysis",
      detail: "Fewer than 3 months of inflow activity were detected — inflow volatility cannot be reliably evaluated. No volatility penalties are applied.",
    });
  }

  const hasAny = positiveSignals.length > 0 || riskSignals.length > 0 || infoSignals.length > 0;
  if (!hasAny) return null;

  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <Eye className="h-4 w-4 text-slate-500" />
        Assessment Diagnostics
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Positive Signals */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" /> Positive Signals
          </p>
          {positiveSignals.length > 0 ? (
            <div className="space-y-2.5">
              {positiveSignals.map((s, i) => (
                <div key={i} className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-emerald-900">{s.label}</p>
                    <p className="text-xs text-emerald-700 leading-relaxed">{s.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-emerald-700 italic">No strong positive signals detected for this assessment.</p>
          )}
        </div>

        {/* Risk Signals */}
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-orange-800 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" /> Risk Signals
          </p>
          {riskSignals.length > 0 ? (
            <div className="space-y-2.5">
              {riskSignals.map((s, i) => (
                <div key={i} className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-orange-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-orange-900">{s.label}</p>
                    <p className="text-xs text-orange-700 leading-relaxed">{s.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-orange-700 italic">No significant risk signals detected for this assessment.</p>
          )}
        </div>
      </div>

      {/* Information Signals — only shown when relevant */}
      {infoSignals.length > 0 && (
        <div className="mt-3 bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide mb-2.5 flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5" /> Information Signals
          </p>
          <div className="space-y-2">
            {infoSignals.map((s, i) => (
              <div key={i} className="flex items-start gap-2">
                <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-blue-900">{s.label}</p>
                  <p className="text-xs text-blue-700 leading-relaxed">{s.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Resilience Section ----------

function MarginBadge({ classification }: { classification: MarginClassification }) {
  if (classification === "Strong")
    return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100 text-sm px-3 py-1"><Shield className="h-4 w-4 mr-1.5" />Strong Margin</Badge>;
  if (classification === "Moderate")
    return <Badge className="bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100 text-sm px-3 py-1"><Shield className="h-4 w-4 mr-1.5" />Moderate Margin</Badge>;
  return <Badge className="bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-100 text-sm px-3 py-1"><Shield className="h-4 w-4 mr-1.5" />Thin Margin</Badge>;
}

function ResilienceSection({ mh }: { mh: MarginHealthData }) {
  const bgBorder =
    mh.classification === "Strong"   ? "bg-emerald-50 border-emerald-200" :
    mh.classification === "Moderate" ? "bg-blue-50 border-blue-200" :
                                        "bg-orange-50 border-orange-200";

  const modifierColor = mh.scoreModifier > 0 ? "text-emerald-700" : mh.scoreModifier < 0 ? "text-orange-700" : "text-slate-500";

  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <Shield className="h-4 w-4 text-blue-500" />
        Financial Resilience
      </h2>

      <div className={`rounded-xl border px-5 py-4 ${bgBorder}`}>
        <div className="flex items-start gap-4 flex-wrap justify-between mb-3">
          {/* Margin ratio */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Margin Ratio</p>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-bold text-foreground">
                {mh.marginRatio !== null ? `${mh.marginRatio.toFixed(1)}%` : "—"}
              </span>
              <span className="text-xs text-muted-foreground">net / inflow</span>
            </div>
          </div>
          {/* Classification + score modifier */}
          <div className="flex items-center gap-2 flex-wrap">
            <MarginBadge classification={mh.classification} />
            {mh.scoreModifier !== 0 && (
              <span className={`text-sm font-semibold ${modifierColor}`}>
                {mh.scoreModifier > 0 ? `+${mh.scoreModifier}` : mh.scoreModifier} pts applied
              </span>
            )}
          </div>
        </div>

        {/* Status indicators */}
        <div className="flex flex-wrap gap-2 mb-3">
          {mh.isSevereDeterioration && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium bg-red-50 border-red-200 text-red-700">
              <TrendingDown className="h-3.5 w-3.5" /> Severe Deterioration
            </span>
          )}
          {mh.isRecovery && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium bg-emerald-50 border-emerald-200 text-emerald-700">
              <TrendingUp className="h-3.5 w-3.5" /> Recovery Momentum
            </span>
          )}
          {!mh.isSevereDeterioration && !mh.isRecovery && mh.classification === "Strong" && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium bg-emerald-50 border-emerald-200 text-emerald-700">
              <ShieldCheck className="h-3.5 w-3.5" /> Strong Operational Resilience
            </span>
          )}
          {!mh.isSevereDeterioration && !mh.isRecovery && mh.classification === "Thin" && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium bg-orange-50 border-orange-200 text-orange-700">
              <AlertCircle className="h-3.5 w-3.5" /> Operationally Fragile
            </span>
          )}
        </div>

        {/* Observations */}
        <ul className="space-y-1">
          {mh.observations.map((obs, i) => (
            <li key={i} className="text-xs text-muted-foreground leading-relaxed flex items-start gap-1.5">
              <span className="mt-1.5 h-1 w-1 rounded-full bg-muted-foreground/50 shrink-0" />
              {obs}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------- Trend Section ----------

function TrendSection({ trend }: { trend: TrendAnalysisData }) {
  const chartData = trend.monthlyData.map((m) => ({
    ...m,
    label: formatMonth(m.month),
  }));

  const hasData = chartData.length >= 2;
  const insufficient = !!trend.isInsufficientHistory;

  const trendColors = {
    POSITIVE: { bg: "bg-emerald-50", border: "border-emerald-200", icon: <TrendingUp className="h-4 w-4 text-emerald-600" /> },
    STABLE:   { bg: "bg-slate-50",   border: "border-slate-200",   icon: <Minus className="h-4 w-4 text-slate-500" /> },
    NEGATIVE: { bg: "bg-red-50",     border: "border-red-200",     icon: <TrendingDown className="h-4 w-4 text-red-600" /> },
  };
  const tc = insufficient
    ? { bg: "bg-slate-50", border: "border-slate-200", icon: <Info className="h-4 w-4 text-slate-400" /> }
    : trendColors[trend.classification];

  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <Zap className="h-4 w-4 text-amber-500" />
        Trend Intelligence
      </h2>

      {/* Classification banner */}
      <div className={`rounded-xl px-5 py-4 mb-4 border ${tc.bg} ${tc.border}`}>
        <div className="flex items-start gap-3">
          <div className="shrink-0 mt-0.5">{tc.icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Trend Classification</p>
              <TrendBadge classification={trend.classification} isInsufficientHistory={insufficient} />
              {!insufficient && trend.trendScore !== 0 && (
                <span className={`text-xs font-semibold ${trend.trendScore > 0 ? "text-emerald-700" : "text-red-700"}`}>
                  {trend.trendScore > 0 ? `+${trend.trendScore}` : trend.trendScore} pts applied
                </span>
              )}
            </div>
            {/* Direction pills — only shown when sufficient history exists */}
            {!insufficient && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                <DirectionPill label="Inflows"    value={trend.inflowTrend} />
                <DirectionPill label="Outflows"   value={trend.outflowTrend} />
                <DirectionPill label="Net"        value={trend.netTrend} />
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${
                  trend.volatility === "high"     ? "text-red-700 bg-red-50 border-red-200" :
                  trend.volatility === "moderate" ? "text-amber-700 bg-amber-50 border-amber-200" :
                                                    "text-green-700 bg-green-50 border-green-200"
                }`}>
                  <Activity className="h-3 w-3" /> Volatility: {trend.volatility}
                </span>
              </div>
            )}
            {/* Explanations */}
            <ul className="space-y-1">
              {trend.explanations.map((e, i) => (
                <li key={i} className="text-xs text-muted-foreground leading-relaxed flex items-start gap-1.5">
                  <span className="mt-1.5 h-1 w-1 rounded-full bg-muted-foreground/50 shrink-0" />
                  {e}
                </li>
              ))}
            </ul>
            {insufficient && (
              <p className="text-xs text-slate-500 mt-2 italic">
                No trend penalties, volatility flags, or deterioration warnings are applied when history is insufficient.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Charts */}
      {hasData ? (
        <div className="space-y-4">
          {/* Combined inflow / outflow bar chart */}
          <div className="bg-card border border-card-border rounded-xl p-5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">Monthly Inflows vs Outflows</p>
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={formatK} tick={{ fontSize: 10 }} width={52} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="inflow"  name="Inflow"  fill="#10b981" opacity={0.85} radius={[3,3,0,0]} />
                <Bar dataKey="outflow" name="Outflow" fill="#f87171" opacity={0.85} radius={[3,3,0,0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Net cashflow line chart */}
          <div className="bg-card border border-card-border rounded-xl p-5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">Monthly Net Cashflow Trend</p>
            <ResponsiveContainer width="100%" height={180}>
              <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={formatK} tick={{ fontSize: 10 }} width={52} />
                <Tooltip content={<ChartTooltip />} />
                <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 2" />
                <Bar dataKey="net" name="Net" radius={[3,3,0,0]}
                  fill="#6366f1"
                  opacity={0.7}
                />
                <Line
                  type="monotone"
                  dataKey="net"
                  name="Net trend"
                  stroke={trend.classification === "POSITIVE" ? "#10b981" : trend.classification === "NEGATIVE" ? "#ef4444" : "#64748b"}
                  strokeWidth={2}
                  dot={{ r: 3, fill: "white", strokeWidth: 2 }}
                  activeDot={{ r: 5 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <div className="bg-card border border-card-border rounded-xl p-8 text-center text-muted-foreground text-sm">
          Not enough monthly data to render trend charts (minimum 2 months required).
        </div>
      )}
    </div>
  );
}

// ---------- Page ----------

export default function AssessmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const numId = Number(id);

  const { data: assessment, isLoading, isError } = useGetAssessment(numId, {
    query: { enabled: !!numId, queryKey: getGetAssessmentQueryKey(numId) },
  });

  const sc = (assessment as any)?.scorecard as ScorecardData | null | undefined;
  const confidence: Confidence | undefined = (assessment as any)?.confidence ?? sc?.confidence;
  const trend = sc?.trendAnalysis;

  return (
    <Layout>
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="mb-4 -ml-2">
          <Link href="/dashboard"><ArrowLeft className="h-4 w-4 mr-1.5" />Back to Dashboard</Link>
        </Button>
        <h1 className="text-2xl font-bold text-foreground">Assessment Detail</h1>
      </div>

      {isLoading && <div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}

      {isError && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-6 text-center">
          <XCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
          <p className="text-sm text-destructive font-medium">Assessment not found</p>
        </div>
      )}

      {assessment && (
        <>
          {/* ── Status banner ───────────────────────────────────────── */}
          {(() => {
            const gov = sc?.governanceResult;
            const isGovOverride = !!(gov?.overridesTriggered && gov.finalDecision !== gov.provisionalDecision);
            return (
              <div
                className={`rounded-xl p-5 mb-4 border ${
                  assessment.status === "PASS" ? "bg-green-50 border-green-200"
                  : assessment.status === "REVIEW" ? "bg-amber-50 border-amber-200"
                  : "bg-red-50 border-red-200"
                }`}
                data-testid="assessment-status"
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    {isGovOverride ? (
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Final Result</p>
                          <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 text-[10px] px-1.5 py-0 h-4">
                            <ShieldAlert className="h-2.5 w-2.5 mr-0.5" />Gov Override
                          </Badge>
                        </div>
                        <StatusBadge status={assessment.status} />
                      </div>
                    ) : (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Assessment Result</p>
                        <StatusBadge status={assessment.status} />
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    {sc && (
                      <>
                        <p className="text-xs text-muted-foreground mb-1">Overall Score</p>
                        <p className="text-2xl font-bold text-foreground">{sc.totalScore}<span className="text-sm font-normal text-muted-foreground">/{sc.maxScore}</span></p>
                        {isGovOverride && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">Score-based: <span className="font-semibold">{gov?.provisionalDecision}</span></p>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {sc && <p className="text-xs text-muted-foreground mt-3 leading-relaxed">{sc.statusReason}</p>}
              </div>
            );
          })()}

          {/* ── Confidence banner ────────────────────────────────────── */}
          {confidence && (
            <div
              className={`rounded-xl px-5 py-3.5 mb-4 border flex items-start gap-3 ${
                confidence === "HIGH"   ? "bg-green-50 border-green-200"
                : confidence === "MEDIUM" ? "bg-amber-50 border-amber-200"
                : "bg-red-50 border-red-200"
              }`}
            >
              <div className="shrink-0 mt-0.5">
                {confidence === "HIGH"   ? <ShieldCheck className="h-4 w-4 text-green-600" />
                : confidence === "MEDIUM" ? <ShieldAlert className="h-4 w-4 text-amber-600" />
                : <ShieldX className="h-4 w-4 text-red-600" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Assessment Confidence</p>
                  <ConfidenceBadge confidence={confidence} />
                </div>
                {sc?.confidenceReasons?.length ? (
                  <ul className="mt-1.5 space-y-0.5">
                    {sc.confidenceReasons.map((r, i) => <li key={i} className="text-xs text-muted-foreground">{r}</li>)}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">All minimum data requirements are met.</p>
                )}
              </div>
            </div>
          )}

          {/* ── Governance Overrides ─────────────────────────────────── */}
          {sc?.governanceResult && <GovernanceOverridesSection gr={sc.governanceResult} />}

          {/* ── Credit Narrative ─────────────────────────────────────── */}
          {sc && <CreditNarrativeSection sc={sc} status={assessment.status as "PASS" | "REVIEW" | "FAIL"} />}

          {/* ── Key metrics ──────────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-card border border-card-border rounded-xl p-5" data-testid="metric-inflow">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-8 w-8 rounded-lg bg-green-100 flex items-center justify-center"><TrendingUp className="h-4 w-4 text-green-600" /></div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Inflow</p>
              </div>
              <p className="text-2xl font-bold text-green-600">{formatCurrency(assessment.totalInflow)}</p>
            </div>
            <div className="bg-card border border-card-border rounded-xl p-5" data-testid="metric-outflow">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-8 w-8 rounded-lg bg-red-100 flex items-center justify-center"><TrendingDown className="h-4 w-4 text-red-600" /></div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Outflow</p>
              </div>
              <p className="text-2xl font-bold text-red-600">{formatCurrency(assessment.totalOutflow)}</p>
            </div>
            <div className="bg-card border border-card-border rounded-xl p-5" data-testid="metric-transactions">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-8 w-8 rounded-lg bg-blue-100 flex items-center justify-center"><Hash className="h-4 w-4 text-blue-600" /></div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Transactions</p>
              </div>
              <p className="text-2xl font-bold text-foreground">{assessment.transactionCount}</p>
            </div>
          </div>

          {/* ── Net cash ─────────────────────────────────────────────── */}
          <div className="bg-card border border-card-border rounded-xl p-5 mb-6">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Net Cash Position</p>
            <div className="flex items-baseline gap-2">
              <p className={`text-3xl font-bold ${assessment.totalInflow - assessment.totalOutflow >= 0 ? "text-green-600" : "text-red-600"}`} data-testid="metric-net">
                {formatCurrency(assessment.totalInflow - assessment.totalOutflow)}
              </p>
              <p className="text-sm text-muted-foreground">net position</p>
            </div>
            {sc && <p className="text-xs text-muted-foreground mt-1">Net ratio: {formatPct(sc.cashflowStrength.netRatio)} of total inflow</p>}
          </div>

          {/* ── Financial Resilience ─────────────────────────────────── */}
          {sc?.marginHealth && <ResilienceSection mh={sc.marginHealth} />}

          {/* ── Revenue Concentration ────────────────────────────────── */}
          {sc?.revenueConcentration && <ConcentrationSection rc={sc.revenueConcentration} />}

          {/* ── Expense Dependency ───────────────────────────────────── */}
          {sc?.expenseDependency && <ExpenseDependencySection ed={sc.expenseDependency} />}

          {/* ── Cashflow Volatility ──────────────────────────────────── */}
          {sc?.volatilityIntelligence && <VolatilitySection vi={sc.volatilityIntelligence} />}

          {/* ── Trend Intelligence ───────────────────────────────────── */}
          {trend && <TrendSection trend={trend} />}

          {/* ── Assessment Diagnostics ───────────────────────────────── */}
          {sc && <AssessmentDiagnostics sc={sc} />}

          {/* ── Scorecard breakdown ──────────────────────────────────── */}
          {sc && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-foreground">Decision Engine Breakdown</h2>
                {sc.configSnapshot && <span className="text-xs text-muted-foreground">Pass threshold: {sc.configSnapshot.passThreshold} pts</span>}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <FactorCard
                  icon={<div className="h-7 w-7 rounded-lg bg-emerald-100 flex items-center justify-center"><BarChart3 className="h-3.5 w-3.5 text-emerald-600" /></div>}
                  title="Cashflow Strength" score={sc.cashflowStrength.score} maxScore={sc.cashflowStrength.maxScore}
                  label={sc.cashflowStrength.label}
                  barColor={sc.cashflowStrength.normalizedScore >= 70 ? "bg-emerald-500" : sc.cashflowStrength.normalizedScore >= 40 ? "bg-amber-500" : "bg-red-500"}
                  weight={sc.cashflowStrength.weight} normalizedScore={sc.cashflowStrength.normalizedScore}
                >
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs"><span className="text-muted-foreground">Net ratio</span><span className="font-medium">{formatPct(sc.cashflowStrength.netRatio)}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-muted-foreground">Net cashflow</span><span className={`font-medium ${sc.cashflowStrength.netCashflow >= 0 ? "text-green-600" : "text-red-600"}`}>{formatCurrency(sc.cashflowStrength.netCashflow)}</span></div>
                  </div>
                </FactorCard>

                <FactorCard
                  icon={<div className="h-7 w-7 rounded-lg bg-blue-100 flex items-center justify-center"><Activity className="h-3.5 w-3.5 text-blue-600" /></div>}
                  title="Activity Level" score={sc.activityLevel.score} maxScore={sc.activityLevel.maxScore}
                  label={sc.activityLevel.label}
                  barColor={sc.activityLevel.normalizedScore >= 70 ? "bg-blue-500" : sc.activityLevel.normalizedScore >= 40 ? "bg-amber-500" : "bg-red-500"}
                  weight={sc.activityLevel.weight} normalizedScore={sc.activityLevel.normalizedScore}
                >
                  <div className="flex justify-between text-xs"><span className="text-muted-foreground">Transactions</span><span className="font-medium">{sc.activityLevel.transactionCount}</span></div>
                </FactorCard>

                <FactorCard
                  icon={<div className="h-7 w-7 rounded-lg bg-violet-100 flex items-center justify-center"><RefreshCw className="h-3.5 w-3.5 text-violet-600" /></div>}
                  title="Income Consistency" score={sc.consistency.score} maxScore={sc.consistency.maxScore}
                  label={sc.consistency.label}
                  barColor={sc.consistency.normalizedScore >= 65 ? "bg-violet-500" : sc.consistency.normalizedScore >= 40 ? "bg-amber-500" : "bg-red-500"}
                  weight={sc.consistency.weight} normalizedScore={sc.consistency.normalizedScore}
                >
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs"><span className="text-muted-foreground">Months with inflows</span><span className="font-medium">{sc.consistency.monthCount}</span></div>
                    {sc.consistency.cv !== null && (
                      <div className="flex justify-between text-xs"><span className="text-muted-foreground">Variation (CV)</span><span className="font-medium">{(sc.consistency.cv * 100).toFixed(1)}%</span></div>
                    )}
                    {sc.consistency.irregularityScore > 0 && (
                      <div className="flex justify-between text-xs"><span className="text-muted-foreground">Irregularity penalty</span><span className="font-medium text-red-600">-{sc.consistency.irregularityScore} pts</span></div>
                    )}
                    {sc.consistency.irregularityFlags?.length > 0 && (
                      <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 space-y-1">
                        {sc.consistency.irregularityFlags.map((flag) => (
                          <div key={flag} className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /><span>{flag}</span></div>
                        ))}
                      </div>
                    )}
                  </div>
                </FactorCard>
              </div>

              {/* Total score bar */}
              <div className="bg-card border border-card-border rounded-xl p-5 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total Score</p>
                  <div className="flex items-center gap-3">
                    {trend && trend.trendScore !== 0 && (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${trend.trendScore > 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                        Trend: {trend.trendScore > 0 ? "+" : ""}{trend.trendScore} pts
                      </span>
                    )}
                    <span className="text-sm font-bold">{sc.totalScore}<span className="text-muted-foreground font-normal">/{sc.maxScore}</span></span>
                  </div>
                </div>
                <div className="h-3 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${assessment.status === "PASS" ? "bg-green-500" : assessment.status === "REVIEW" ? "bg-amber-500" : "bg-red-500"}`}
                    style={{ width: `${sc.totalScore}%` }}
                  />
                </div>
                {sc.configSnapshot && (
                  <div className="relative mt-1.5 h-4">
                    <div className="absolute top-0 bottom-0 w-px bg-amber-400" style={{ left: `${sc.configSnapshot.reviewThreshold}%` }} />
                    <div className="absolute top-0 bottom-0 w-px bg-green-500" style={{ left: `${sc.configSnapshot.passThreshold}%` }} />
                    <p className="absolute text-[10px] text-amber-600 font-medium" style={{ left: `${sc.configSnapshot.reviewThreshold}%`, transform: "translateX(-50%)" }}>Review ({sc.configSnapshot.reviewThreshold})</p>
                    <p className="absolute text-[10px] text-green-600 font-medium" style={{ left: `${sc.configSnapshot.passThreshold}%`, transform: "translateX(-50%)" }}>Pass ({sc.configSnapshot.passThreshold})</p>
                  </div>
                )}
              </div>

              {/* Triggered rules */}
              {sc.triggeredRules?.length > 0 && (
                <div className="bg-card border border-card-border rounded-xl p-5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Rules That Affected This Decision</p>
                  <div className="space-y-2">
                    {sc.triggeredRules.map((rule, i) => <RuleChip key={i} rule={rule} />)}
                  </div>
                  {sc.configSnapshot && (
                    <div className="mt-4 pt-4 border-t border-card-border flex items-start gap-2 text-xs text-muted-foreground">
                      <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>
                        Scored using rules active at time of upload — pass ≥{sc.configSnapshot.passThreshold}, review ≥{sc.configSnapshot.reviewThreshold},
                        min {sc.configSnapshot.minMonths} months, min {sc.configSnapshot.minTransactions} transactions.
                        Weights: cashflow {sc.configSnapshot.cashflowWeight}%, activity {sc.configSnapshot.activityWeight}%, consistency {sc.configSnapshot.consistencyWeight}%.
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Original Bank Statement ──────────────────────────────── */}
          <StatementSection assessmentId={assessment.id} />
        </>
      )}
    </Layout>
  );
}
