import { ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, Users, FileText, LogOut, Loader2, Building } from "lucide-react";
import { useLogout, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";

export function Layout({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const logoutMutation = useLogout();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <>{children}</>;
  }

  const handleLogout = () => {
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        setLocation("/login");
      }
    });
  };

  const navItems = [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  ];

  if (user.isAdmin) {
    navItems.push({ label: "Admin Panel", href: "/admin", icon: Users });
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row bg-background">
      {/* Sidebar */}
      <aside className="w-full md:w-64 bg-sidebar text-sidebar-foreground border-r border-sidebar-border shrink-0 flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-sidebar-border gap-3">
          <div className="h-8 w-8 rounded-md bg-accent flex items-center justify-center">
            <Building className="h-5 w-5 text-accent-foreground" />
          </div>
          <span className="font-semibold text-lg tracking-tight">SME Credit Intelligence Platform</span>
        </div>
        
        <div className="p-4 flex-1">
          <nav className="space-y-1">
            {navItems.map((item) => (
              <Link 
                key={item.href} 
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  location.startsWith(item.href) 
                    ? "bg-sidebar-accent text-sidebar-accent-foreground" 
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="p-4 border-t border-sidebar-border">
          <div className="flex items-center justify-between mb-4">
            <div className="flex flex-col overflow-hidden">
              <span className="text-sm font-medium truncate">{user.email}</span>
              <span className="text-xs text-sidebar-foreground/50">{user.isAdmin ? "Administrator" : "Analyst"}</span>
            </div>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            className="w-full justify-start text-sidebar-foreground border-sidebar-border bg-transparent hover:bg-sidebar-accent"
            onClick={handleLogout}
            disabled={logoutMutation.isPending}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex-1 overflow-auto p-4 md:p-8">
          <div className="mx-auto max-w-6xl">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
