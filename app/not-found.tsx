import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center space-y-3 p-6 bg-white border border-slate-200 rounded shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">404 - Page Not Found</h2>
        <p className="text-sm text-slate-500">The requested page could not be found.</p>
        <Link
          href="/"
          className="inline-block px-4 py-2 bg-slate-900 text-white rounded text-sm font-medium hover:bg-slate-800"
        >
          Return to Dashboard
        </Link>
      </div>
    </div>
  );
}
