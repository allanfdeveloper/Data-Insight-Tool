import {
  useAdminListUsers,
  useAdminGetStats,
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { useAuth } from "@/lib/auth";
import { Link, useLocation } from "wouter";
import { useEffect } from "react";
import {
  Users,
  BarChart3,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

function StatusBadge({ status }: { status: string }) {
  if (status === "PASS") {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100 text-xs">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        PASS
      </Badge>
    );
  }
  if (status === "REVIEW") {
    return (
      <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 text-xs">
        <AlertCircle className="h-3 w-3 mr-1" />
        REVIEW
      </Badge>
    );
  }
  return (
    <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100 text-xs">
      <XCircle className="h-3 w-3 mr-1" />
      FAIL
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

  useEffect(() => {
    if (user && !user.isAdmin) {
      setLocation("/dashboard");
    }
  }, [user, setLocation]);

  const { data: users, isLoading: loadingUsers, isError: usersError } = useAdminListUsers();
  const { data: stats, isLoading: loadingStats } = useAdminGetStats();

  if (user && !user.isAdmin) return null;

  return (
    <Layout>
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <ShieldAlert className="h-5 w-5 text-accent" />
          <h1 className="text-2xl font-bold text-foreground">Admin Panel</h1>
        </div>
        <p className="text-sm text-muted-foreground">Platform overview and user management</p>
      </div>

      {/* Platform Stats */}
      {!loadingStats && stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <div className="bg-card border border-card-border rounded-xl p-4" data-testid="admin-stat-users">
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-4 w-4 text-muted-foreground/60" />
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Users</p>
            </div>
            <p className="text-2xl font-bold text-foreground">{stats.totalUsers}</p>
          </div>
          <div className="bg-card border border-card-border rounded-xl p-4" data-testid="admin-stat-assessments">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground/60" />
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total</p>
            </div>
            <p className="text-2xl font-bold text-foreground">{stats.totalAssessments}</p>
          </div>
          <div className="bg-card border border-card-border rounded-xl p-4" data-testid="admin-stat-pass">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pass</p>
            </div>
            <p className="text-2xl font-bold text-green-600">{stats.passCount}</p>
          </div>
          <div className="bg-card border border-card-border rounded-xl p-4" data-testid="admin-stat-review">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="h-4 w-4 text-amber-500" />
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Review</p>
            </div>
            <p className="text-2xl font-bold text-amber-600">{stats.reviewCount}</p>
          </div>
          <div className="bg-card border border-card-border rounded-xl p-4" data-testid="admin-stat-fail">
            <div className="flex items-center gap-2 mb-2">
              <XCircle className="h-4 w-4 text-red-500" />
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Fail</p>
            </div>
            <p className="text-2xl font-bold text-red-600">{stats.failCount}</p>
          </div>
        </div>
      )}

      {/* Users Table */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-card-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">All Users</h2>
          {users && (
            <span className="text-xs text-muted-foreground">{users.length} accounts</span>
          )}
        </div>

        {loadingUsers && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {usersError && (
          <div className="p-6 text-center">
            <p className="text-sm text-destructive">Failed to load users. Admin access required.</p>
          </div>
        )}

        {users && users.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="h-8 w-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">No users registered yet</p>
          </div>
        )}

        {users && users.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-card-border bg-muted/30">
                  <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Email</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Role</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Joined</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Assessments</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Latest Result</th>
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
                        <div className="flex items-center gap-2">
                          <StatusBadge status={u.latestAssessment.status} />
                          <span className="text-xs text-muted-foreground truncate max-w-32">
                            {u.latestAssessment.fileName}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">No assessments</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
