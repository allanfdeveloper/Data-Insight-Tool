import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  useAdminGetSettings,
  useAdminUpdateSettings,
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { useAuth } from "@/lib/auth";
import {
  ShieldAlert,
  Settings,
  Users,
  Save,
  RotateCcw,
  Info,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

function AdminTabs({ active }: { active: "overview" | "settings" }) {
  return (
    <div className="flex gap-1 border-b border-card-border mb-8">
      <Link href="/admin">
        <button
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            active === "overview"
              ? "border-accent text-accent"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Users className="h-4 w-4" />
          Overview
        </button>
      </Link>
      <Link href="/admin/settings">
        <button
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            active === "settings"
              ? "border-accent text-accent"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Settings className="h-4 w-4" />
          Assessment Rules
        </button>
      </Link>
    </div>
  );
}

function WeightBar({ weights }: { weights: { cashflow: number; activity: number; consistency: number } }) {
  const total = weights.cashflow + weights.activity + weights.consistency;
  const valid = Math.abs(total - 100) <= 0.5;
  return (
    <div>
      <div className="flex h-6 w-full rounded-lg overflow-hidden text-xs font-medium">
        <div
          className="bg-emerald-500 flex items-center justify-center text-white transition-all"
          style={{ width: `${weights.cashflow}%` }}
        >
          {weights.cashflow >= 10 ? `${weights.cashflow}%` : ""}
        </div>
        <div
          className="bg-blue-500 flex items-center justify-center text-white transition-all"
          style={{ width: `${weights.activity}%` }}
        >
          {weights.activity >= 10 ? `${weights.activity}%` : ""}
        </div>
        <div
          className="bg-violet-500 flex items-center justify-center text-white transition-all"
          style={{ width: `${weights.consistency}%` }}
        >
          {weights.consistency >= 10 ? `${weights.consistency}%` : ""}
        </div>
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500 inline-block" />Cashflow</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-blue-500 inline-block" />Activity</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-violet-500 inline-block" />Consistency</span>
        </div>
        <span className={`text-xs font-medium ${valid ? "text-green-600" : "text-red-500"}`}>
          Total: {total.toFixed(1)}%{!valid && " (must equal 100%)"}
        </span>
      </div>
    </div>
  );
}

function FieldRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 py-4 border-b border-card-border last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <div className="shrink-0 w-full sm:w-40">{children}</div>
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
      />
      {suffix && <span className="text-xs text-muted-foreground shrink-0">{suffix}</span>}
    </div>
  );
}

const DEFAULTS: FormState = {
  minMonths: 3,
  minTransactions: 10,
  passThreshold: 65,
  reviewThreshold: 40,
  cashflowWeight: 40,
  activityWeight: 30,
  consistencyWeight: 30,
};

export default function AdminSettingsPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    if (user && !user.isAdmin) setLocation("/dashboard");
  }, [user, setLocation]);

  const { data: settings, isLoading } = useAdminGetSettings();
  const updateMutation = useAdminUpdateSettings();

  const [form, setForm] = useState(DEFAULTS);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settings) {
      setForm({
        minMonths: settings.minMonths,
        minTransactions: settings.minTransactions,
        passThreshold: settings.passThreshold,
        reviewThreshold: settings.reviewThreshold,
        cashflowWeight: settings.cashflowWeight,
        activityWeight: settings.activityWeight,
        consistencyWeight: settings.consistencyWeight,
      });
      setDirty(false);
    }
  }, [settings]);

  const set = (key: keyof typeof form, value: number) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const totalWeight = form.cashflowWeight + form.activityWeight + form.consistencyWeight;
  const weightsValid = Math.abs(totalWeight - 100) <= 0.5;
  const thresholdsValid = form.passThreshold > form.reviewThreshold;
  const canSave = dirty && weightsValid && thresholdsValid && !updateMutation.isPending;

  const handleReset = () => {
    setForm(DEFAULTS);
    setDirty(true);
  };

  const handleSave = () => {
    updateMutation.mutate(
      { data: form },
      {
        onSuccess: () => {
          toast({ title: "Settings saved", description: "Assessment rules updated successfully." });
          setDirty(false);
        },
        onError: (err: any) => {
          toast({
            title: "Save failed",
            description: err?.response?.data?.error ?? "Could not save settings.",
            variant: "destructive",
          });
        },
      }
    );
  };

  if (user && !user.isAdmin) return null;

  return (
    <Layout>
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <ShieldAlert className="h-5 w-5 text-accent" />
          <h1 className="text-2xl font-bold text-foreground">Admin Panel</h1>
        </div>
        <p className="text-sm text-muted-foreground">Configure scoring rules and decision thresholds</p>
      </div>

      <AdminTabs active="settings" />

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">Loading settings…</div>
      ) : (
        <div className="space-y-6">
          {/* Info banner */}
          <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <p>Changes take effect immediately for all new assessments. Existing assessments are not re-scored.</p>
          </div>

          {/* Data Requirements */}
          <div className="bg-card border border-card-border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-card-border">
              <h2 className="text-sm font-semibold text-foreground">Minimum Data Requirements</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Files that don't meet these thresholds are automatically classified as REVIEW with an explanation.</p>
            </div>
            <div className="px-5">
              <FieldRow
                label="Minimum months of data"
                description="Minimum calendar months with inflow transactions required for a full assessment."
              >
                <NumberInput value={form.minMonths} onChange={(v) => set("minMonths", v)} min={1} max={24} suffix="months" />
              </FieldRow>
              <FieldRow
                label="Minimum transactions"
                description="Minimum total number of transactions required for a PASS verdict."
              >
                <NumberInput value={form.minTransactions} onChange={(v) => set("minTransactions", v)} min={1} max={500} suffix="txns" />
              </FieldRow>
            </div>
          </div>

          {/* Decision Thresholds */}
          <div className="bg-card border border-card-border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-card-border">
              <h2 className="text-sm font-semibold text-foreground">Decision Thresholds</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Score cutoffs (out of 100) that determine the final verdict.</p>
            </div>
            <div className="px-5">
              <FieldRow
                label="PASS threshold"
                description="Score must be ≥ this value to receive a PASS verdict."
              >
                <NumberInput value={form.passThreshold} onChange={(v) => set("passThreshold", v)} min={1} max={100} suffix="/100" />
              </FieldRow>
              <FieldRow
                label="REVIEW threshold"
                description="Score must be ≥ this value (but below PASS) to receive REVIEW. Below this → FAIL."
              >
                <NumberInput value={form.reviewThreshold} onChange={(v) => set("reviewThreshold", v)} min={0} max={99} suffix="/100" />
              </FieldRow>
            </div>
            {!thresholdsValid && (
              <div className="mx-5 mb-4 flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Pass threshold must be greater than review threshold.
              </div>
            )}

            {/* Score scale illustration */}
            <div className="mx-5 mb-5">
              <div className="relative h-7 bg-muted rounded-full overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-red-400 transition-all"
                  style={{ width: `${form.reviewThreshold}%` }}
                />
                <div
                  className="absolute inset-y-0 bg-amber-400 transition-all"
                  style={{ left: `${form.reviewThreshold}%`, width: `${form.passThreshold - form.reviewThreshold}%` }}
                />
                <div
                  className="absolute inset-y-0 right-0 bg-green-500 transition-all"
                  style={{ left: `${form.passThreshold}%` }}
                />
                <div className="absolute inset-0 flex items-center justify-around text-xs font-semibold text-white px-3">
                  <span>FAIL</span>
                  <span>REVIEW</span>
                  <span>PASS</span>
                </div>
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1 px-0.5">
                <span>0</span>
                <span className="text-amber-600">{form.reviewThreshold}</span>
                <span className="text-green-600">{form.passThreshold}</span>
                <span>100</span>
              </div>
            </div>
          </div>

          {/* Factor Weights */}
          <div className="bg-card border border-card-border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-card-border">
              <h2 className="text-sm font-semibold text-foreground">Factor Weights</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Percentage contribution of each factor to the final score. Must sum to 100%.</p>
            </div>
            <div className="px-5">
              <FieldRow
                label="Cashflow strength"
                description="Weight applied to net cashflow ratio. Higher = cashflow matters more."
              >
                <NumberInput value={form.cashflowWeight} onChange={(v) => set("cashflowWeight", v)} min={0} max={100} step={1} suffix="%" />
              </FieldRow>
              <FieldRow
                label="Transaction activity"
                description="Weight applied to transaction volume. Higher = activity matters more."
              >
                <NumberInput value={form.activityWeight} onChange={(v) => set("activityWeight", v)} min={0} max={100} step={1} suffix="%" />
              </FieldRow>
              <FieldRow
                label="Income consistency"
                description="Weight applied to income regularity. Higher = stability matters more."
              >
                <NumberInput value={form.consistencyWeight} onChange={(v) => set("consistencyWeight", v)} min={0} max={100} step={1} suffix="%" />
              </FieldRow>
            </div>
            <div className="px-5 pb-5">
              <WeightBar
                weights={{
                  cashflow: form.cashflowWeight,
                  activity: form.activityWeight,
                  consistency: form.consistencyWeight,
                }}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={handleReset} className="gap-2">
              <RotateCcw className="h-3.5 w-3.5" />
              Restore defaults
            </Button>
            <div className="flex items-center gap-3">
              {!dirty && settings && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  Saved
                </span>
              )}
              <Button onClick={handleSave} disabled={!canSave} className="gap-2">
                <Save className="h-4 w-4" />
                {updateMutation.isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
