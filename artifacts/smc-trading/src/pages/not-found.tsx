import { useLocation } from "wouter";

export default function NotFound() {
  const [, navigate] = useLocation();
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center text-center px-4">
      <p className="text-6xl font-bold text-gray-800 mb-4">404</p>
      <p className="text-gray-400 mb-6">Page not found</p>
      <button
        onClick={() => navigate("/")}
        className="px-4 py-2 rounded-lg bg-amber-500 text-gray-900 text-sm font-semibold hover:bg-amber-400 transition-colors"
      >
        Go to Setup Form
      </button>
    </div>
  );
}
