import { useLocation, useSearch } from "wouter";

type Breakdown = Record<string, { label: string; score: number; max: number }>;

function DecisionIcon({ decision }: { decision: string }) {
  if (decision.startsWith("Execute")) {
    return (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }
  if (decision.startsWith("Place")) {
    return (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }
  if (decision.startsWith("No Trade")) {
    return (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
      </svg>
    );
  }
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  );
}

function decisionStyle(decision: string): { bg: string; border: string; text: string; icon: string } {
  if (decision.startsWith("Execute"))
    return { bg: "bg-emerald-950/40", border: "border-emerald-500/40", text: "text-emerald-400", icon: "text-emerald-400" };
  if (decision.startsWith("Place"))
    return { bg: "bg-blue-950/40", border: "border-blue-500/40", text: "text-blue-400", icon: "text-blue-400" };
  if (decision.startsWith("No Trade"))
    return { bg: "bg-red-950/40", border: "border-red-500/40", text: "text-red-400", icon: "text-red-400" };
  return { bg: "bg-amber-950/40", border: "border-amber-500/40", text: "text-amber-400", icon: "text-amber-400" };
}

function ratingStyle(rating: string) {
  if (rating === "Elite Setup")   return "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
  if (rating === "Tradable Setup") return "text-blue-400 bg-blue-500/10 border-blue-500/30";
  return "text-red-400 bg-red-500/10 border-red-500/30";
}

const MAX_SCORE = 14;

export default function Result() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);

  const score    = Number(params.get("score") ?? 0);
  const rating   = params.get("rating") ?? "—";
  const decision = params.get("decision") ?? "—";
  const breakdown: Breakdown = JSON.parse(params.get("breakdown") ?? "{}");

  const pct = Math.round((score / MAX_SCORE) * 100);
  const style = decisionStyle(decision);

  // Gauge arc helpers
  const r = 54;
  const circ = 2 * Math.PI * r;
  const dashOffset = circ - (pct / 100) * circ;

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
              <p className="text-xs text-gray-500">Setup Analysis Result</p>
            </div>
          </div>
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-amber-400 transition-colors"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-5">
        {/* Score gauge + rating row */}
        <div className="grid grid-cols-2 gap-4">
          {/* Score gauge */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex flex-col items-center">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-4">Total Score</p>
            <div className="relative w-32 h-32">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 128 128">
                {/* Track */}
                <circle cx="64" cy="64" r={r} fill="none" stroke="#1f2937" strokeWidth="10" />
                {/* Fill */}
                <circle
                  cx="64" cy="64" r={r}
                  fill="none"
                  stroke={score >= 10 ? "#10b981" : score >= 7 ? "#3b82f6" : "#ef4444"}
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={circ}
                  strokeDashoffset={dashOffset}
                  className="transition-all duration-700"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-bold text-white">{score}</span>
                <span className="text-xs text-gray-500">/ {MAX_SCORE}</span>
              </div>
            </div>
          </div>

          {/* Rating */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex flex-col justify-between">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Trade Rating</p>
            <div>
              <span className={`inline-flex items-center px-3 py-1.5 rounded-lg border text-sm font-bold ${ratingStyle(rating)}`}>
                {rating}
              </span>
              <div className="mt-4 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-600">10–14</span>
                  <span className="text-emerald-400/70">Elite</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-600">7–9</span>
                  <span className="text-blue-400/70">Tradable</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-600">&lt; 7</span>
                  <span className="text-red-400/70">Avoid</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Decision banner */}
        <div className={`rounded-xl border p-5 ${style.bg} ${style.border}`}>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">System Decision</p>
          <div className={`flex items-center gap-3 ${style.icon}`}>
            <DecisionIcon decision={decision} />
            <p className={`text-lg font-bold ${style.text}`}>{decision}</p>
          </div>
          <p className="text-xs text-gray-500 mt-3 leading-relaxed">
            {decision.startsWith("Execute") &&
              "All criteria met with LTF confirmation. Enter at market price immediately."}
            {decision.startsWith("Place") &&
              "High-quality setup but LTF not yet confirmed. Set a pending order at the zone."}
            {decision.startsWith("No Trade") &&
              "Setup score is too low. Stand aside — protect your capital and wait."}
            {decision.startsWith("Caution") &&
              "Setup has some merit but lacks key confluence. Proceed with extreme caution or skip."}
          </p>
        </div>

        {/* Condition breakdown */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-800">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Condition Breakdown</p>
          </div>
          <div className="divide-y divide-gray-800">
            {Object.entries(breakdown).map(([id, item]) => {
              const earned = item.score;
              const max = item.max;
              const full = max > 0 && earned === max;
              return (
                <div key={id} className="flex items-center justify-between px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className={`h-1.5 w-1.5 rounded-full ${full ? "bg-amber-400" : "bg-gray-700"}`} />
                    <span className="text-sm text-gray-300">{item.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {max > 0 ? (
                      <span className={`text-sm font-mono font-bold ${full ? "text-amber-400" : "text-gray-600"}`}>
                        {earned > 0 ? `+${earned}` : "0"} / {max}
                      </span>
                    ) : (
                      <span className="text-sm font-mono text-gray-600">—</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between px-5 py-3.5 bg-gray-800/50 border-t border-gray-700">
            <span className="text-sm font-semibold text-white">Total</span>
            <span className="text-sm font-bold font-mono text-amber-400">{score} / {MAX_SCORE}</span>
          </div>
        </div>

        {/* CTA */}
        <button
          onClick={() => navigate("/")}
          className="w-full py-3.5 rounded-xl font-semibold text-sm border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-200 transition-colors"
        >
          ← Evaluate Another Setup
        </button>

        {/* Disclaimer */}
        <p className="text-center text-xs text-gray-700 leading-relaxed pb-4">
          This tool enforces discipline and structured decision-making. It does not predict trades.
          Always apply your own risk management.
        </p>
      </main>
    </div>
  );
}
