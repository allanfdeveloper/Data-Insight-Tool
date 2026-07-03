import { useState, useMemo, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAdminListAssessments,
  useDeleteAssessment,
  getAdminListAssessmentsQueryKey,
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { useAuth } from "@/lib/auth";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  FileSpreadsheet, Loader2, Trash2, Eye, Search, CheckCircle2,
  AlertCircle, XCircle, Users, Settings, BarChart3,
} from "lucide-react";

function AdminTabs({ active }: { active: "overview" | "assessments" | "settings" }) {
  const tabCls = (isActive: boolean) =>
    `flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
      isActive ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground"
    }`;
  return (
    <div className="flex gap-1 border-b border-card-border mb-8">
      <Link href="/admin">
        <button className={tabCls(active === "overview")}>
          <Users className="h-4 w-4" />Overview
        </button>
      </Link>
      <Link href="/admin/assessments">
        <button className={tabCls(active === "assessments")}>
          <FileSpreadsheet className="h-4 w-4" />Assessments
        </button>
      </Link>
      <Link href="/admin/settings">
        <button className={tabCls(active === "settings")}>
          <Settings className="h-4 w-4" />Assessment Rules
        </button>
      </Link>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "PASS") return <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100 text-xs"><CheckCircle2 className="h-3 w-3 mr-1" />PASS</Badge>;
  if (status === "REVIEW") return <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 text-xs"><AlertCircle className="h-3 w-3 mr-1" />REVIEW</Badge>;
  return <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100 text-xs"><XCircle className="h-3 w-3 mr-1" />FAIL</Badge>;
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  if (confidence === "HIGH") return <Badge variant="outline" className="text-green-700 border-green-300 text-xs">High</Badge>;
  if (confidence === "MEDIUM") return <Badge variant="outline" className="text-amber-700 border-amber-300 text-xs">Med</Badge>;
  return <Badge variant="outline" className="text-red-700 border-red-300 text-xs">Low</Badge>;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatNet(n: number) {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

export default function AdminAssessmentsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!authLoading && user && !user.isAdmin) setLocation("/dashboard");
  }, [user, authLoading, setLocation]);

  const { data: assessments, isLoading } = useAdminListAssessments();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [confidenceFilter, setConfidenceFilter] = useState("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [deleteAlsoFile, setDeleteAlsoFile] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteAlsoFile, setBulkDeleteAlsoFile] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const deleteMutation = useDeleteAssessment({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getAdminListAssessmentsQueryKey() });
      },
    },
  });

  const filtered = useMemo(() => {
    if (!assessments) return [];
    const s = search.toLowerCase();
    return assessments.filter((a) => {
      const matchSearch = !s || a.fileName.toLowerCase().includes(s) || a.userEmail.toLowerCase().includes(s);
      const matchStatus = statusFilter === "all" || a.status === statusFilter;
      const matchConf = confidenceFilter === "all" || a.confidence === confidenceFilter;
      return matchSearch && matchStatus && matchConf;
    });
  }, [assessments, search, statusFilter, confidenceFilter]);

  const allSelected = filtered.length > 0 && filtered.every((a) => selected.has(a.id));
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) filtered.forEach((a) => next.delete(a.id));
      else filtered.forEach((a) => next.add(a.id));
      return next;
    });
  };
  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteMutation.mutateAsync({ id: deleteTarget.id, params: deleteAlsoFile ? { deleteFile: true } : undefined });
    setDeleteTarget(null);
    setDeleteAlsoFile(false);
    setSelected((prev) => { const next = new Set(prev); next.delete(deleteTarget.id); return next; });
  };

  const handleBulkDelete = async () => {
    setIsBulkDeleting(true);
    try {
      for (const id of selected) {
        await deleteMutation.mutateAsync({ id, params: bulkDeleteAlsoFile ? { deleteFile: true } : undefined });
      }
      setSelected(new Set());
      setBulkDeleteOpen(false);
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const stats = useMemo(() => {
    if (!assessments) return null;
    return {
      total: assessments.length,
      pass:   assessments.filter((a) => a.status === "PASS").length,
      review: assessments.filter((a) => a.status === "REVIEW").length,
      fail:   assessments.filter((a) => a.status === "FAIL").length,
    };
  }, [assessments]);

  if (authLoading || (user && !user.isAdmin)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <AdminTabs active="assessments" />

        {/* Stats row */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {[
              { label: "Total Assessments", value: stats.total, cls: "text-foreground" },
              { label: "Pass",   value: stats.pass,   cls: "text-green-700" },
              { label: "Review", value: stats.review, cls: "text-amber-700" },
              { label: "Fail",   value: stats.fail,   cls: "text-red-700"   },
            ].map(({ label, value, cls }) => (
              <div key={label} className="bg-card border border-card-border rounded-xl p-5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
                <p className={`text-2xl font-bold ${cls}`}>{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Main panel */}
        <div className="bg-card border border-card-border rounded-xl">
          {/* Toolbar */}
          <div className="px-5 py-4 border-b border-card-border flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold text-foreground mr-2">Uploaded Assessments</h2>

            <div className="relative flex-1 min-w-44">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search filename or user…"
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-input rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="text-sm border border-input rounded-lg px-3 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="all">All Results</option>
              <option value="PASS">PASS</option>
              <option value="REVIEW">REVIEW</option>
              <option value="FAIL">FAIL</option>
            </select>

            <select
              value={confidenceFilter}
              onChange={(e) => setConfidenceFilter(e.target.value)}
              className="text-sm border border-input rounded-lg px-3 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="all">All Confidence</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>

            {selected.size > 0 && (
              <Button
                size="sm"
                variant="destructive"
                className="ml-auto"
                onClick={() => setBulkDeleteOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                Delete {selected.size}
              </Button>
            )}
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                <FileSpreadsheet className="h-8 w-8 opacity-30" />
                <p className="text-sm">No assessments found</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-muted/30">
                    <th className="px-4 py-3 text-left w-10">
                      <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Filename</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">User</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Result</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Confidence</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Score</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Net</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border">
                  {filtered.map((a) => (
                    <tr
                      key={a.id}
                      className={`hover:bg-muted/20 transition-colors ${selected.has(a.id) ? "bg-blue-50/50" : ""}`}
                    >
                      <td className="px-4 py-3.5">
                        <Checkbox checked={selected.has(a.id)} onCheckedChange={() => toggleOne(a.id)} />
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                          <span className="font-medium text-foreground truncate max-w-52">{a.fileName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-muted-foreground text-xs truncate max-w-36">{a.userEmail}</td>
                      <td className="px-4 py-3.5 text-muted-foreground whitespace-nowrap">{formatDate(a.createdAt)}</td>
                      <td className="px-4 py-3.5"><StatusBadge status={a.status} /></td>
                      <td className="px-4 py-3.5"><ConfidenceBadge confidence={a.confidence} /></td>
                      <td className="px-4 py-3.5">
                        {a.totalScore != null ? (
                          <span className={`font-semibold ${a.totalScore >= 65 ? "text-green-700" : a.totalScore >= 40 ? "text-amber-700" : "text-red-700"}`}>
                            {a.totalScore}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`font-medium text-xs ${a.totalInflow - a.totalOutflow >= 0 ? "text-green-700" : "text-red-700"}`}>
                          {formatNet(a.totalInflow - a.totalOutflow)}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-end gap-1">
                          <Link href={`/assessment/${a.id}`}>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          </Link>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={() => setDeleteTarget({ id: a.id, name: a.fileName })}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer */}
          {!isLoading && (assessments?.length ?? 0) > 0 && (
            <div className="px-5 py-3 border-t border-card-border">
              <p className="text-xs text-muted-foreground">
                Showing {filtered.length} of {assessments?.length ?? 0} assessment{(assessments?.length ?? 0) !== 1 ? "s" : ""}
                {selected.size > 0 && ` · ${selected.size} selected`}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Single delete dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteAlsoFile(false); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this assessment?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> and all scoring records will be permanently removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1 pb-2">
            <label className="flex items-start gap-3 cursor-pointer group">
              <Checkbox
                checked={deleteAlsoFile}
                onCheckedChange={(v) => setDeleteAlsoFile(!!v)}
                className="mt-0.5"
              />
              <div>
                <p className="text-sm font-medium text-foreground group-hover:text-foreground">Also delete the uploaded file</p>
                <p className="text-xs text-muted-foreground mt-0.5">Permanently removes the original bank statement from storage. If unchecked, the file is kept but unlinked.</p>
              </div>
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              onClick={handleDelete}
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete{deleteAlsoFile ? " + File" : " assessment"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete dialog */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={(open) => { if (!isBulkDeleting) { setBulkDeleteOpen(open); if (!open) setBulkDeleteAlsoFile(false); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} assessment{selected.size !== 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              All {selected.size} selected assessment{selected.size !== 1 ? "s" : ""} and their scoring records will be permanently removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1 pb-2">
            <label className="flex items-start gap-3 cursor-pointer group">
              <Checkbox
                checked={bulkDeleteAlsoFile}
                onCheckedChange={(v) => setBulkDeleteAlsoFile(!!v)}
                className="mt-0.5"
              />
              <div>
                <p className="text-sm font-medium text-foreground">Also delete all uploaded files</p>
                <p className="text-xs text-muted-foreground mt-0.5">Permanently removes all original bank statements from storage.</p>
              </div>
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              onClick={handleBulkDelete}
              disabled={isBulkDeleting}
            >
              {isBulkDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete {selected.size}{bulkDeleteAlsoFile ? " + files" : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
