"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center space-y-3 p-6 bg-white border border-slate-200 rounded shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">Something went wrong</h2>
        <p className="text-sm text-slate-500">{error.message}</p>
        <button
          onClick={reset}
          className="px-4 py-2 bg-slate-900 text-white rounded text-sm font-medium hover:bg-slate-800"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}