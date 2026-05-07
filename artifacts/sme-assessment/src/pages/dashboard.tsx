import { useState, useRef } from "react";
import { Link } from "wouter";
import {
  useListAssessments,
  useGetAssessmentSummary,
  useUploadAssessment,
  useGetAssessment,
  getListAssessmentsQueryKey,
  getGetAssessmentSummaryQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Layout } from "@/components/layout";
import { useToast } from "@/hooks/use-toast";
import {
  Upload, FileSpreadsheet, Activity, ChevronRight, Loader2,
  CheckCircle2, AlertCircle, XCircle, ShieldCheck, ShieldAlert,
  ShieldX, TrendingUp, TrendingDown, Minus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
} from "recharts";

// ---------- Badges ----------

function StatusBadge({ status }: { status: string }) {
  if (status === "PASS")
    return <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100"><CheckCircle2 className="h-3 w-3 mr-1" />PASS</Badge>;
  if (status === "REVIEW")
    return <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100"><AlertCircle className="h-3 w-3 mr-1" />REVIEW</Badge>;
  return <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100"><XCircle className="h-3 w-3 mr-1" />FAIL</Badge>;
}

function ConfidenceBadge({ confidence }: { confidence?: string }) {
  if (!confidence || confidence === "HIGH")
    return <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 hover:bg-green-50 text-[10px] px-1.5 py-0.5"><ShieldCheck className="h-2.5 w-2.5 mr-1" />HIGH</Badge>;
  if (confidence === "MEDIUM")
    return <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 hover:bg-amber-50 text-[10px] px-1.5 py-0.5"><ShieldAlert className="h-2.5 w-2.5 mr-1" />MED</Badge>;
  return <Badge variant="outline" className="text-red-700 border-red-300 bg-red-50 hover:bg-red-50 text-[10px] px-1.5 py-0.5"><ShieldX className="h-2.5 w-2.5 mr-1" />LOW</Badge>;
}

function TrendBadge({ classification }: { classification?: string }) {
  if (classification === "POSITIVE")
    return <Badge variant="outline" className="text-emerald-700 border-emerald-300 bg-emerald-50 hover:bg-emerald-50 text-[10px] px-1.5 py-0.5"><TrendingUp className="h-2.5 w-2.5 mr-1" />↑</Badge>;
  if (classification === "NEGATIVE")
    return <Badge variant="outline" className="text-red-700 border-red-300 bg-red-50 hover:bg-red-50 text-[10px] px-1.5 py-0.5"><TrendingDown className="h-2.5 w-2.5 mr-1" />↓</Badge>;
  if (!classification) return null;
  return <Badge variant="outline" className="text-slate-600 border-slate-300 bg-slate-50 hover:bg-slate-50 text-[10px] px-1.5 py-0.5"><Minus className="h-2.5 w-2.5 mr-1" />—</Badge>;
}

// ---------- Helpers ----------

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

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

// ---------- Mini trend chart ----------

function MiniTrendChart({ monthlyData, classification }: {
  monthlyData: Array<{ month: string; inflow: number; outflow: number; net: number }>;
  classification?: string;
}) {
  if (!monthlyData || monthlyData.length < 2) return null;

  const data = monthlyData.map((m) => ({ ...m, label: formatMonth(m.month) }));
  const lineColor =
    classification === "POSITIVE" ? "#10b981" :
    classification === "NEGATIVE" ? "#ef4444" :
    "#64748b";

  function TipContent({ active, payload, label }: any) {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-card border border-card-border rounded-lg px-2.5 py-1.5 text-xs shadow-md">
        <p className="font-semibold text-foreground mb-1">{label}</p>
        <div className="flex items-center gap-1.5 mb-0.5 text-green-600"><span>In:</span><span className="font-medium">{formatK(payload[0]?.value ?? 0)}</span></div>
        <div className="flex items-center gap-1.5 mb-0.5 text-red-500"><span>Out:</span><span className="font-medium">{formatK(payload[1]?.value ?? 0)}</span></div>
        <div className="flex items-center gap-1.5" style={{ color: lineColor }}><span>Net:</span><span className="font-medium">{formatK(payload[2]?.value ?? 0)}</span></div>
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-card-border">
      <p className="text-xs font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
        <Activity className="h-3.5 w-3.5" />
        Monthly Cashflow Trend
        {classification && (
          <span className={`ml-1 font-semibold ${
            classification === "POSITIVE" ? "text-emerald-600" :
            classification === "NEGATIVE" ? "text-red-600" :
            "text-slate-500"
          }`}>({classification})</span>
        )}
      </p>

      {/* Inflow vs Outflow bars */}
      <div className="mb-3">
        <p className="text-[10px] text-muted-foreground mb-1.5">Inflows (green) vs Outflows (red)</p>
        <ResponsiveContainer width="100%" height={100}>
          <ComposedChart data={data} margin={{ top: 2, right: 4, left: 4, bottom: 2 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
            <YAxis tickFormatter={formatK} tick={{ fontSize: 9 }} width={40} tickLine={false} axisLine={false} />
            <Tooltip content={<TipContent />} />
            <Bar dataKey="inflow"  fill="#10b981" opacity={0.8} radius={[2,2,0,0]} />
            <Bar dataKey="outflow" fill="#f87171" opacity={0.8} radius={[2,2,0,0]} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Net cashflow line */}
      <div>
        <p className="text-[10px] text-muted-foreground mb-1.5">Monthly Net Cashflow</p>
        <ResponsiveContainer width="100%" height={80}>
          <ComposedChart data={data} margin={{ top: 2, right: 4, left: 4, bottom: 2 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
            <YAxis tickFormatter={formatK} tick={{ fontSize: 9 }} width={40} tickLine={false} axisLine={false} />
            <Tooltip content={<TipContent />} />
            <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 2" />
            <Bar dataKey="net" fill="#6366f1" opacity={0.5} radius={[2,2,0,0]} />
            <Line type="monotone" dataKey="net" stroke={lineColor} strokeWidth={2} dot={{ r: 3, fill: "white", strokeWidth: 2 }} activeDot={{ r: 4 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---------- Page ----------

export default function DashboardPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const { data: assessments, isLoading: loadingAssessments } = useListAssessments();
  const { data: summary, isLoading: loadingSummary } = useGetAssessmentSummary();
  const uploadMutation = useUploadAssessment();

  // Fetch full scorecard for the latest assessment (for trend charts)
  const latestId = (summary?.latestAssessment as any)?.id as number | undefined;
  const { data: latestDetail } = useGetAssessment(latestId!, {
    query: { enabled: !!latestId },
  });
  const latestTrend = (latestDetail as any)?.scorecard?.trendAnalysis;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setSelectedFile(file);
  };

  const handleUpload = () => {
    if (!selectedFile) {
      toast({ title: "No file selected", description: "Please select a .xlsx, .xls, or .csv file first.", variant: "destructive" });
      return;
    }
    uploadMutation.mutate(
      { data: { file: selectedFile } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAssessmentsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetAssessmentSummaryQueryKey() });
          setSelectedFile(null);
          if (fileInputRef.current) fileInputRef.current.value = "";
          toast({ title: "Assessment complete", description: "Your file has been processed successfully." });
        },
        onError: (err: any) => {
          const msg = err?.data?.error ?? err?.data?.message ?? err?.message ?? "Failed to process file.";
          toast({ title: "Upload failed", description: msg, variant: "destructive" });
        },
      }
    );
  };

  return (
    <Layout>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Welcome back, {user?.email}</p>
      </div>

      {/* Summary Stats */}
      {!loadingSummary && summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-card border border-card-border rounded-xl p-4" data-testid="stat-total">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Files</p>
            <p className="text-2xl font-bold text-foreground mt-1">{summary.totalAssessments}</p>
          </div>
          <div className="bg-card border border-card-border rounded-xl p-4" data-testid="stat-pass">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pass</p>
            <p className="text-2xl font-bold text-green-600 mt-1">{summary.passCount}</p>
          </div>
          <div className="bg-card border border-card-border rounded-xl p-4" data-testid="stat-review">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Review</p>
            <p className="text-2xl font-bold text-amber-600 mt-1">{summary.reviewCount}</p>
          </div>
          <div className="bg-card border border-card-border rounded-xl p-4" data-testid="stat-fail">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Fail</p>
            <p className="text-2xl font-bold text-red-600 mt-1">{summary.failCount}</p>
          </div>
        </div>
      )}

      {/* Latest Assessment + Trend Charts */}
      {summary?.latestAssessment && (
        <div className="bg-card border border-card-border rounded-xl p-5 mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">Latest Assessment</h2>
            <div className="flex items-center gap-2">
              <TrendBadge classification={latestTrend?.classification} />
              <ConfidenceBadge confidence={(summary.latestAssessment as any).confidence} />
              <StatusBadge status={summary.latestAssessment.status} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Total Inflow</p>
              <p className="text-lg font-bold text-green-600 mt-0.5">{formatCurrency(summary.latestAssessment.totalInflow)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Outflow</p>
              <p className="text-lg font-bold text-red-600 mt-0.5">{formatCurrency(summary.latestAssessment.totalOutflow)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Transactions</p>
              <p className="text-lg font-bold text-foreground mt-0.5">{summary.latestAssessment.transactionCount}</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            {summary.latestAssessment.fileName} &middot; {formatDate(summary.latestAssessment.createdAt)}
          </p>

          {/* Trend charts inline */}
          {latestTrend?.monthlyData && latestTrend.monthlyData.length >= 2 && (
            <MiniTrendChart
              monthlyData={latestTrend.monthlyData}
              classification={latestTrend.classification}
            />
          )}
        </div>
      )}

      {/* Upload Section */}
      <div className="bg-card border border-card-border rounded-xl p-5 mb-8">
        <h2 className="text-sm font-semibold text-foreground mb-4">Upload Bank Statement</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Upload an Excel (.xlsx, .xls) or CSV file with columns: Date, Description, Type (Inflow/Outflow), Amount
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            onChange={handleFileChange}
            className="hidden"
            id="file-upload"
            data-testid="input-file"
          />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} data-testid="button-select-file">
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            {selectedFile ? selectedFile.name : "Select file (.xlsx, .csv)"}
          </Button>
          <Button size="sm" onClick={handleUpload} disabled={!selectedFile || uploadMutation.isPending} data-testid="button-upload">
            {uploadMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing...</>
            ) : (
              <><Upload className="h-4 w-4 mr-2" />Run Assessment</>
            )}
          </Button>
        </div>
      </div>

      {/* Assessment History */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-card-border">
          <h2 className="text-sm font-semibold text-foreground">Assessment History</h2>
        </div>
        {loadingAssessments ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !assessments || assessments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <Activity className="h-8 w-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">No assessments yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Upload a bank statement to get started</p>
          </div>
        ) : (
          <div className="divide-y divide-card-border">
            {assessments.map((a) => (
              <Link
                key={a.id}
                href={`/assessment/${a.id}`}
                className="flex items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors group"
                data-testid={`row-assessment-${a.id}`}
              >
                <div className="flex items-center gap-4 min-w-0">
                  <FileSpreadsheet className="h-5 w-5 text-muted-foreground/50 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{a.fileName}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{formatDate(a.createdAt)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <ConfidenceBadge confidence={(a as any).confidence} />
                  <StatusBadge status={a.status} />
                  <ChevronRight className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
