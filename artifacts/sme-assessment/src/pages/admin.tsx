import { useState, useEffect } from "react";
import {
  useAdminListUsers,
  useAdminGetStats,
  useAdminDeleteUser,
  getAdminListUsersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { useAuth } from "@/lib/auth";
import { Link, useLocation } from "wouter";
import {
  Users,
  BarChart3,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Loader2,
  ShieldAlert,
  Settings,
  ShieldCheck,
  ShieldX,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { Button } from "@/components/ui/button";

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
  if (status === "PASS") {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100 text-xs">
        <CheckCircle2 className="h-3 w-3 mr-1" />PASS
      </Badge>
    );
  }
  if (status === "REVIEW") {
    return (
      <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 text-xs">
        <AlertCircle className="h-3 w-3 mr-1" />REVIEW
      </Badge>
    );
  }
  return (
    <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100 text-xs">
      <XCircle className="h-3 w-3 mr-1" />FAIL
    </Badge>
  );
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

export default function AdminPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (user && !user.isAdmin) setLocation("/dashboard");
  }, [user, setLocation]);

  const { data: users, isLoading: loadingUsers, isError: usersError } = useAdminListUsers();
  const { data: stats, isLoading: loadingStats } = useAdminGetStats();

  const [deleteTarget, setDeleteTarget] = useState<{ id: number; email: string } | null>(null);

  const deleteMutation = useAdminDeleteUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getAdminListUsersQueryKey() });
        setDeleteTarget(null);
      },
    },
  });

  const handleDeleteUser = async () => {
    if (!deleteTarget) return;
    await deleteMutation.mutateAsync({ id: deleteTarget.id });
  };

  if (user && !user.isAdmin) return null;

  return (
    <Layout>
      <div className="mb-6"></div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <AdminTabs active="overview" />

        {/* Platform stats */}
        {loadingStats ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : stats ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-card border border-card-border rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-8 w-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Users className="h-4 w-4 text-blue-600" />
                </div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Users</p>
              </div>
              <p className="text-2xl font-bold text-foreground">{stats.totalUsers}</p>
            </div>
            <div className="bg-card border border-card-border rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-8 w-8 rounded-lg bg-violet-100 flex items-center justify-center">
                  <BarChart3 className="h-4 w-4 text-violet-600" />
                </div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Assessments</p>
              </div>
              <p className="text-2xl font-bold text-foreground">{stats.totalAssessments}</p>
            </div>
            <div className="bg-card border border-card-border rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-8 w-8 rounded-lg bg-green-100 flex items-center justify-center">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                </div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pass Rate</p>
              </div>
              <p className="text-2xl font-bold text-foreground">
                {stats.totalAssessments > 0
                  ? `${Math.round((stats.passCount / stats.totalAssessments) * 100)}%`
                  : "—"}
              </p>
            </div>
            <div className="bg-card border border-card-border rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-8 w-8 rounded-lg bg-amber-100 flex items-center justify-center">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                </div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Review Rate</p>
              </div>
              <p className="text-2xl font-bold text-foreground">
                {stats.totalAssessments > 0
                  ? `${Math.round((stats.reviewCount / stats.totalAssessments) * 100)}%`
                  : "—"}
              </p>
            </div>
          </div>
        ) : null}

        {/* Decision breakdown */}
        {stats && (
          <div className="bg-card border border-card-border rounded-xl p-5 mb-8">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-4">Decision Breakdown</p>
            <div className="grid grid-cols-3 gap-6">
              {[
                { label: "PASS",   count: stats.passCount,   icon: <ShieldCheck className="h-4 w-4 text-green-600" />, color: "text-green-700" },
                { label: "REVIEW", count: stats.reviewCount, icon: <ShieldAlert className="h-4 w-4 text-amber-600" />, color: "text-amber-700" },
                { label: "FAIL",   count: stats.failCount,   icon: <ShieldX className="h-4 w-4 text-red-600" />,       color: "text-red-700"   },
              ].map(({ label, count, icon, color }) => (
                <div key={label} className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">{icon}</div>
                  <div>
                    <p className={`text-xl font-bold ${color}`}>{count}</p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Users table */}
        <div className="bg-card border border-card-border rounded-xl">
          <div className="px-5 py-4 border-b border-card-border">
            <h2 className="text-sm font-semibold text-foreground">User Accounts</h2>
          </div>

          {loadingUsers ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : usersError ? (
            <p className="px-5 py-8 text-sm text-red-600">Failed to load users.</p>
          ) : !users?.length ? (
            <p className="px-5 py-8 text-sm text-muted-foreground">No users found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-muted/30">
                    <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Email</th>
                    <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Role</th>
                    <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Joined</th>
                    <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Assessments</th>
                    <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Latest Result</th>
                    <th className="text-right px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-muted/20 transition-colors" data-testid={`row-user-${u.id}`}>
                      <td className="px-5 py-4">
                        <p className="font-medium text-foreground">{u.email}</p>
                      </td>
                      <td className="px-5 py-4">
                        {u.isAdmin ? (
                          <Badge variant="secondary" className="text-xs">Admin</Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">Analyst</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-muted-foreground">{formatDate(u.createdAt)}</td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-1.5">
                          <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground/50" />
                          <span className="font-medium text-foreground">{u.assessmentCount}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        {u.latestAssessment ? (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <StatusBadge status={u.latestAssessment.status} />
                              {(u.latestAssessment as any)?.scorecard?.governanceResult?.overridesTriggered && (
                                <Badge className="bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100 text-[10px] px-1.5 py-0 h-4 shrink-0">
                                  <ShieldAlert className="h-2.5 w-2.5 mr-0.5" />Gov
                                </Badge>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground truncate max-w-36">
                              {u.latestAssessment.fileName}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">No assessments</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-2">
                          {!u.isAdmin && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                              title="Delete user"
                              onClick={() => setDeleteTarget({ id: u.id, email: u.email })}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Delete user confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this user permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.email}</strong> and all their assessments, reports, and uploaded data will be permanently removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              onClick={handleDeleteUser}
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
