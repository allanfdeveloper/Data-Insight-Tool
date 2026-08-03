import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation } from "wouter";
import { useSignup, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Building, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const signupSchema = z
  .object({
    email: z.string().email("Enter a valid email"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type SignupForm = z.infer<typeof signupSchema>;

export default function SignupPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const signupMutation = useSignup();

  const form = useForm<SignupForm>({
    resolver: zodResolver(signupSchema),
    defaultValues: { email: "", password: "", confirmPassword: "" },
  });

  const onSubmit = (data: SignupForm) => {
    signupMutation.mutate(
      { data: { email: data.email, password: data.password } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
          setLocation("/dashboard");
        },
        onError: (err: any) => {
          const msg =
            err?.response?.data?.error ?? "Could not create account. Try again.";
          toast({
            title: "Signup failed",
            description: msg,
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="h-14 w-14 rounded-xl bg-primary flex items-center justify-center mb-4">
            <Building className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight leading-snug">SME Credit Intelligence Platform</h1>
          <p className="text-sm text-muted-foreground/75 mt-2 italic">Explainable Alternative Data Credit Assessment</p>
        </div>

        <div className="bg-card border border-card-border rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground mb-1">Register Organisation</h2>
          <p className="text-sm text-muted-foreground mb-6">Register to access the SME Credit Intelligence Platform.</p>

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                placeholder="Enter your email address"
                data-testid="input-email"
                {...form.register("email")}
              />
              {form.formState.errors.email && (
                <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                data-testid="input-password"
                {...form.register("password")}
              />
              {form.formState.errors.password && (
                <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="••••••••"
                data-testid="input-confirm-password"
                {...form.register("confirmPassword")}
              />
              {form.formState.errors.confirmPassword && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.confirmPassword.message}
                </p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={signupMutation.isPending}
              data-testid="button-signup"
            >
              {signupMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating account...
                </>
              ) : (
                "Register Organisation"
              )}
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-muted-foreground mt-4">
          Already have an account?{" "}
          <Link href="/login" className="text-accent hover:underline font-medium">
            Sign in
          </Link>
        </p>

        <div className="text-center mt-6 space-y-0.5">
          <p className="text-[11px] text-muted-foreground/70 tracking-wide font-medium">© 2026 SME Credit Intelligence Platform</p>
          <p className="text-[11px] text-muted-foreground/55 tracking-wide">Version 1.0 (MVP)</p>
        </div>
      </div>
    </div>
  );
}
