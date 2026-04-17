import { useState } from "react";
import { useLocation } from "wouter";

const FIELDS = [
  {
    id: "d1Trend",
    label: "D1 Trend",
    description: "Daily timeframe trend clarity",
    options: [
      { value: "clear", label: "Clear Trend", score: 3 },
      { value: "unclear", label: "Unclear", score: 0 },
    ],
  },
  {
    id: "liquiditySweep",
    label: "Liquidity Sweep",
    description: "Momentum + candle close beyond liquidity required for Strong",
    options: [
      { value: "strong", label: "Strong", score: 3 },
      { value: "weak", label: "Weak", score: 0 },
      { value: "none", label: "None", score: 0 },
    ],
  },
  {
    id: "bosConfirmed",
    label: "BOS Confirmed",
    description: "Break of structure with candle close",
    options: [
      { value: "yes", label: "Yes", score: 2 },
      { value: "no", label: "No", score: 0 },
    ],
  },
  {
    id: "validOrderBlock",
    label: "Valid Order Block",
    description: "Fresh, untested order block present",
    options: [
      { value: "yes", label: "Yes", score: 2 },
      { value: "no", label: "No", score: 0 },
    ],
  },
  {
    id: "fvgConfluence",
    label: "FVG Confluence",
    description: "Fair Value Gap aligns with entry",
    options: [
      { value: "yes", label: "Yes", score: 1 },
      { value: "no", label: "No", score: 0 },
    ],
  },
  {
    id: "sessionAlignment",
    label: "Session (London / NY)",
    description: "Trading during London or New York session",
    options: [
      { value: "yes", label: "Yes", score: 1 },
      { value: "no", label: "No", score: 0 },
    ],
  },
  {
    id: "ltfConfirmation",
    label: "LTF Confirmation (15m)",
    description: "Lower timeframe (15-minute) entry confirmation",
    options: [
      { value: "yes", label: "Yes", score: 2 },
      { value: "no", label: "No", score: 0 },
    ],
  },
] as const;

type FieldId = (typeof FIELDS)[number]["id"];
type FormState = Partial<Record<FieldId, string>>;

const MAX_SCORE = 14; // 3+3+2+2+1+1+2

export default function SetupForm() {
  const [, navigate] = useLocation();
  const [form, setForm] = useState<FormState>({});
  const [errors, setErrors] = useState<Partial<Record<FieldId, true>>>({});

  const handleChange = (id: FieldId, value: string) => {
    setForm((prev) => ({ ...prev, [id]: value }));
    setErrors((prev) => { const next = { ...prev }; delete next[id]; return next; });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const missing: Partial<Record<FieldId, true>> = {};
    for (const f of FIELDS) {
      if (!form[f.id]) missing[f.id] = true;
    }
    if (Object.keys(missing).length > 0) {
      setErrors(missing);
      return;
    }

    // Compute scores
    let totalScore = 0;
    const breakdown: Record<string, { label: string; score: number; max: number }> = {};

    for (const field of FIELDS) {
      const selected = form[field.id];
      const option = field.options.find((o) => o.value === selected);
      const score = option?.score ?? 0;
      const max = Math.max(...field.options.map((o) => o.score));
      totalScore += score;
      breakdown[field.id] = { label: field.label, score, max };
    }

    // Decision logic
    const ltfYes = form.ltfConfirmation === "yes";
    let decision: string;
    if (totalScore >= 10 && ltfYes) {
      decision = "Execute Trade (Instant Execution)";
    } else if (totalScore >= 9 && !ltfYes) {
      decision = "Place Pending Order";
    } else if (totalScore < 7) {
      decision = "No Trade";
    } else {
      decision = "Caution: Not Ideal Setup";
    }

    // Rating
    let rating: string;
    if (totalScore >= 10) {
      rating = "Elite Setup";
    } else if (totalScore >= 7) {
      rating = "Tradable Setup";
    } else {
      rating = "Avoid";
    }

    // Navigate with state encoded in URL params
    const params = new URLSearchParams({
      score: String(totalScore),
      rating,
      decision,
      breakdown: JSON.stringify(breakdown),
    });
    navigate(`/result?${params.toString()}`);
  };

  const filledCount = FIELDS.filter((f) => form[f.id]).length;
  const progress = Math.round((filledCount / FIELDS.length) * 100);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
              <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-bold text-white tracking-wide">SMC Trading Assistant</h1>
              <p className="text-xs text-gray-500">Smart Money Concepts · Discipline Engine</p>
            </div>
          </div>
          <span className="text-xs text-gray-500">Max Score: {MAX_SCORE}</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        {/* Intro */}
        <div className="mb-8">
          <h2 className="text-xl font-bold text-white mb-1">Trade Setup Evaluation</h2>
          <p className="text-sm text-gray-400">
            Answer every condition honestly. The system enforces discipline — not predictions.
          </p>
        </div>

        {/* Progress */}
        <div className="mb-6">
          <div className="flex justify-between text-xs text-gray-500 mb-1.5">
            <span>{filledCount} / {FIELDS.length} conditions reviewed</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="space-y-3">
            {FIELDS.map((field, idx) => {
              const maxScore = Math.max(...field.options.map((o) => o.score));
              const hasError = errors[field.id];
              const selected = form[field.id];

              return (
                <div
                  key={field.id}
                  className={`rounded-xl border p-4 transition-colors ${
                    hasError
                      ? "border-red-500/50 bg-red-950/20"
                      : selected
                      ? "border-amber-500/30 bg-gray-900"
                      : "border-gray-800 bg-gray-900"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-gray-600">{String(idx + 1).padStart(2, "0")}</span>
                        <span className="text-sm font-semibold text-white">{field.label}</span>
                        {maxScore > 0 && (
                          <span className="text-xs text-amber-400/70 font-mono">+{maxScore}</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 ml-6">{field.description}</p>
                    </div>
                    {selected && (
                      <div className="h-5 w-5 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0 mt-0.5">
                        <svg className="h-3 w-3 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 ml-6">
                    {field.options.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => handleChange(field.id as FieldId, opt.value)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                          selected === opt.value
                            ? opt.score > 0
                              ? "bg-amber-500 text-gray-900 shadow-lg shadow-amber-500/20"
                              : "bg-gray-600 text-white"
                            : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
                        }`}
                      >
                        {opt.label}
                        {opt.score > 0 && (
                          <span className={`ml-1.5 font-mono ${selected === opt.value ? "text-gray-900" : "text-gray-600"}`}>
                            +{opt.score}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>

                  {hasError && (
                    <p className="text-xs text-red-400 mt-2 ml-6">Please select a condition</p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Submit */}
          <div className="mt-8">
            <button
              type="submit"
              className="w-full py-3.5 rounded-xl font-semibold text-sm bg-amber-500 hover:bg-amber-400 text-gray-900 transition-colors shadow-lg shadow-amber-500/20 active:scale-[0.99]"
            >
              Evaluate Setup
            </button>
            <p className="text-center text-xs text-gray-600 mt-3">
              All {FIELDS.length} conditions must be set before evaluation
            </p>
          </div>
        </form>
      </main>
    </div>
  );
}
