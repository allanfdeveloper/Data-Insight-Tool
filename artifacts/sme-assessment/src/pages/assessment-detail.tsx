import { Link, useParams } from "wouter";
import {
  useGetAssessment,
  getGetAssessmentQueryKey,
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Loader2,
  TrendingUp,
  TrendingDown,
  Hash,
  Calendar,
  FileSpreadsheet,
  Activity,
  BarChart3,
  RefreshCw,
  AlertTriangle,
  ShieldX,
  ShieldCheck,
  ShieldAlert,
  Info,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// ---------- Types ----------

type Confidence = "HIGH" | "MEDIUM" | "LOW";

interface TriggeredRule {
  rule: string;
  effect: "auto-fail" | "cap-review" | "score-penalty" | "passed" | "confidence-warning";
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

function StatusBadge({ status }: { status: string }) {
  if (status === "PASS")
    return <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100 text-sm px-3 py-1"><CheckCircle2 className="h-4 w-4 mr-1.5" /> PASS</Badge>;
  if (status === "REVIEW")
    return <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 text-sm px-3 py-1"><AlertCircle className="h-4 w-4 mr-1.5" /> REVIEW</Badge>;
  return <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100 text-sm px-3 py-1"><XCircle className="h-4 w-4 mr-1.5" /> FAIL</Badge>;
}

function ConfidenceBadge({ confidence }: { confidence?: Confidence }) {
  if (!confidence || confidence === "HIGH")
    return <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100 text-sm px-3 py-1"><ShieldCheck className="h-4 w-4 mr-1.5" /> HIGH Confidence</Badge>;
  if (confidence === "MEDIUM")
    return <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 text-sm px-3 py-1"><ShieldAlert className="h-4 w-4 mr-1.5" /> MEDIUM Confidence</Badge>;
  return <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100 text-sm px-3 py-1"><ShieldX className="h-4 w-4 mr-1.5" /> LOW Confidence</Badge>;
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
  label: string; barColor: string; weight: number; normalizedScore: number; children?: React.ReactNode;
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
    "auto-fail":          { bg: "bg-red-50 border-red-200 text-red-800",     icon: <ShieldX className="h-3.5 w-3.5 shrink-0 text-red-500" /> },
    "cap-review":         { bg: "bg-amber-50 border-amber-200 text-amber-800", icon: <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" /> },
    "score-penalty":      { bg: "bg-orange-50 border-orange-200 text-orange-800", icon: <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-orange-500" /> },
    "passed":             { bg: "bg-green-50 border-green-200 text-green-800", icon: <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-green-500" /> },
    "confidence-warning": { bg: "bg-blue-50 border-blue-200 text-blue-800",  icon: <Info className="h-3.5 w-3.5 shrink-0 text-blue-500" /> },
  };
  const s = styles[rule.effect] ?? styles["cap-review"];
  const effectLabel: Record<string, string> = {
    "auto-fail":          "Auto-Fail",
    "cap-review":         "Capped to Review",
    "score-penalty":      "Score Penalty",
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

// ---------- Page ----------

export default function AssessmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const numId = Number(id);

  const { data: assessment, isLoading, isError } = useGetAssessment(numId, {
    query: { enabled: !!numId, queryKey: getGetAssessmentQueryKey(numId) },
  });

  const sc = (assessment as any)?.scorecard as ScorecardData | null | undefined;
  const confidence: Confidence | undefined = (assessment as any)?.confidence ?? sc?.confidence;

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
          {/* ── Status + Confidence banner ──────────────────────────────── */}
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
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Assessment Result</p>
                <StatusBadge status={assessment.status} />
              </div>
              {sc && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground mb-1">Overall Score</p>
                  <p className="text-2xl font-bold text-foreground">{sc.totalScore}<span className="text-sm font-normal text-muted-foreground">/{sc.maxScore}</span></p>
                </div>
              )}
            </div>
            {sc && <p className="text-xs text-muted-foreground mt-3 leading-relaxed">{sc.statusReason}</p>}
          </div>

          {/* ── Confidence banner ───────────────────────────────────────── */}
          {confidence && (
            <div
              className={`rounded-xl px-5 py-3.5 mb-6 border flex items-start gap-3 ${
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
                {sc?.confidenceReasons && sc.confidenceReasons.length > 0 ? (
                  <ul className="mt-1.5 space-y-0.5">
                    {sc.confidenceReasons.map((r, i) => (
                      <li key={i} className="text-xs leading-relaxed text-muted-foreground">{r}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">All minimum data requirements are met.</p>
                )}
              </div>
            </div>
          )}

          {/* ── Key metrics ────────────────────────────────────────────── */}
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

          {/* ── Net cash position ──────────────────────────────────────── */}
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

          {/* ── Scorecard breakdown ───────────────────────────────────── */}
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
                  <span className="text-sm font-bold">{sc.totalScore}<span className="text-muted-foreground font-normal">/{sc.maxScore}</span></span>
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

          {/* ── File information ──────────────────────────────────────── */}
          <div className="bg-card border border-card-border rounded-xl p-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">File Information</p>
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="h-5 w-5 text-muted-foreground/50" />
              <div>
                <p className="text-sm font-medium text-foreground" data-testid="assessment-filename">{assessment.fileName}</p>
                <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                  <Calendar className="h-3 w-3" />{formatDate(String(assessment.createdAt))}
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </Layout>
  );
}
