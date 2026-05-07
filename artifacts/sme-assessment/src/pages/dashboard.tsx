import { useState, useRef } from "react";
import { Link } from "wouter";
import {
  useListAssessments,
  useGetAssessmentSummary,
  useUploadAssessment,
  getListAssessmentsQueryKey,
  getGetAssessmentSummaryQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Layout } from "@/components/layout";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  FileSpreadsheet,
  TrendingUp,
  TrendingDown,
  Activity,
  ChevronRight,
  Loader2,
  CheckCircle2,
  AlertCircle,
  XCircle,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

function StatusBadge({ status }: { status: string }) {
  if (status === "PASS") {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">
        <CheckCircle2 className="h-3 w-3 mr-1" />PASS
      </Badge>
    );
  }
  if (status === "REVIEW") {
    return (
      <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">
        <AlertCircle className="h-3 w-3 mr-1" />REVIEW
      </Badge>
    );
  }
  return (
    <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100">
      <XCircle className="h-3 w-3 mr-1" />FAIL
    </Badge>
  );
}

function ConfidenceBadge({ confidence }: { confidence?: string }) {
  if (!confidence || confidence === "HIGH") {
    return (
      <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 hover:bg-green-50 text-[10px] px-1.5 py-0.5">
        <ShieldCheck className="h-2.5 w-2.5 mr-1" />HIGH
      </Badge>
    );
  }
  if (confidence === "MEDIUM") {
    return (
      <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 hover:bg-amber-50 text-[10px] px-1.5 py-0.5">
        <ShieldAlert className="h-2.5 w-2.5 mr-1" />MED
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-red-700 border-red-300 bg-red-50 hover:bg-red-50 text-[10px] px-1.5 py-0.5">
      <ShieldX className="h-2.5 w-2.5 mr-1" />LOW
    </Badge>
  );
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function DashboardPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const { data: assessments, isLoading: loadingAssessments } = useListAssessments();
  const { data: summary, isLoading: loadingSummary } = useGetAssessmentSummary();
  const uploadMutation = useUploadAssessment();

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
          const msg = err?.data?.error ?? err?.data?.message ?? err?.message ?? "Failed to process file. Please try again.";
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

      {/* Latest Assessment */}
      {summary?.latestAssessment && (
        <div className="bg-card border border-card-border rounded-xl p-5 mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">Latest Assessment</h2>
            <div className="flex items-center gap-2">
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

      {/* Assessments List */}
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
