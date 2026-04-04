import { createContext, useContext, ReactNode, useEffect } from "react";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";

type UserProfile = {
  id: number;
  email: string;
  isAdmin: boolean;
  createdAt: string;
};

type AuthContextType = {
  user: UserProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const { data: user, isLoading, isError } = useGetMe({
    query: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
    }
  });

  const isAuthenticated = !!user && !isError;

  useEffect(() => {
    if (!isLoading) {
      const isAuthRoute = location === "/" || location === "/login" || location === "/signup";
      
      if (!isAuthenticated && !isAuthRoute) {
        setLocation("/login");
      } else if (isAuthenticated && isAuthRoute) {
        setLocation("/dashboard");
      }
    }
  }, [isLoading, isAuthenticated, location, setLocation]);

  return (
    <AuthContext.Provider value={{ user: user || null, isLoading, isAuthenticated }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
