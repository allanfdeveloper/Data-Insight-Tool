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
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function StatusBadge({ status }: { status: string }) {
  if (status === "PASS") {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100 text-sm px-3 py-1">
        <CheckCircle2 className="h-4 w-4 mr-1.5" />
        PASS
      </Badge>
    );
  }
  if (status === "REVIEW") {
    return (
      <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 text-sm px-3 py-1">
        <AlertCircle className="h-4 w-4 mr-1.5" />
        REVIEW
      </Badge>
    );
  }
  return (
    <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100 text-sm px-3 py-1">
      <XCircle className="h-4 w-4 mr-1.5" />
      FAIL
    </Badge>
  );
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AssessmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const numId = Number(id);

  const { data: assessment, isLoading, isError } = useGetAssessment(numId, {
    query: { enabled: !!numId, queryKey: getGetAssessmentQueryKey(numId) },
  });

  return (
    <Layout>
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="mb-4 -ml-2">
          <Link href="/dashboard">
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Back to Dashboard
          </Link>
        </Button>
        <h1 className="text-2xl font-bold text-foreground">Assessment Detail</h1>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-6 text-center">
          <XCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
          <p className="text-sm text-destructive font-medium">Assessment not found</p>
        </div>
      )}

      {assessment && (
        <>
          {/* Status Banner */}
          <div
            className={`rounded-xl p-5 mb-6 border ${
              assessment.status === "PASS"
                ? "bg-green-50 border-green-200"
                : assessment.status === "REVIEW"
                ? "bg-amber-50 border-amber-200"
                : "bg-red-50 border-red-200"
            }`}
            data-testid="assessment-status"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  Assessment Result
                </p>
                <StatusBadge status={assessment.status} />
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">
                  {assessment.status === "PASS" && "Inflow exceeds outflow with strong transaction volume"}
                  {assessment.status === "REVIEW" && "Moderate transaction volume — manual review recommended"}
                  {assessment.status === "FAIL" && "Outflow exceeds inflow — financial risk identified"}
                </p>
              </div>
            </div>
          </div>

          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-card border border-card-border rounded-xl p-5" data-testid="metric-inflow">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-8 w-8 rounded-lg bg-green-100 flex items-center justify-center">
                  <TrendingUp className="h-4 w-4 text-green-600" />
                </div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Inflow</p>
              </div>
              <p className="text-2xl font-bold text-green-600">{formatCurrency(assessment.totalInflow)}</p>
            </div>

            <div className="bg-card border border-card-border rounded-xl p-5" data-testid="metric-outflow">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-8 w-8 rounded-lg bg-red-100 flex items-center justify-center">
                  <TrendingDown className="h-4 w-4 text-red-600" />
                </div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Outflow</p>
              </div>
              <p className="text-2xl font-bold text-red-600">{formatCurrency(assessment.totalOutflow)}</p>
            </div>

            <div className="bg-card border border-card-border rounded-xl p-5" data-testid="metric-transactions">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-8 w-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Hash className="h-4 w-4 text-blue-600" />
                </div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Transactions</p>
              </div>
              <p className="text-2xl font-bold text-foreground">{assessment.transactionCount}</p>
            </div>
          </div>

          {/* Net Position */}
          <div className="bg-card border border-card-border rounded-xl p-5 mb-6">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Net Cash Position</p>
            <div className="flex items-center gap-2">
              <p
                className={`text-3xl font-bold ${
                  assessment.totalInflow - assessment.totalOutflow >= 0
                    ? "text-green-600"
                    : "text-red-600"
                }`}
                data-testid="metric-net"
              >
                {formatCurrency(assessment.totalInflow - assessment.totalOutflow)}
              </p>
              <p className="text-sm text-muted-foreground">net position</p>
            </div>
          </div>

          {/* File Info */}
          <div className="bg-card border border-card-border rounded-xl p-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">File Information</p>
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="h-5 w-5 text-muted-foreground/50" />
              <div>
                <p className="text-sm font-medium text-foreground" data-testid="assessment-filename">
                  {assessment.fileName}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {formatDate(assessment.createdAt)}
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </Layout>
  );
}
