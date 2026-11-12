"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ShieldAlert, Lock, Mail, ArrowLeft, AlertTriangle, Loader2 } from "lucide-react";
import { loginUnitHead } from "@/actions/authActions";

export default function UnitHeadLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("unithead@neco.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError("Please enter the administrator password.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const res = await loginUnitHead(password, email);
      if (!res.success) {
        setError(res.error || "Invalid Unit Head credentials.");
        setIsSubmitting(false);
        return;
      }

      router.push("/");
      router.refresh();
    } catch (err) {
      console.error("Login submission error:", err);
      setError("An unexpected error occurred. Please try again.");
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-4 sm:p-6 relative selection:bg-emerald-600 selection:text-white">
      {/* Background ambient industrial gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black pointer-events-none -z-10" />

      <div className="w-full max-w-md bg-slate-900/90 border border-slate-800 rounded-xl shadow-2xl p-6 sm:p-8 backdrop-blur-sm space-y-6">
        {/* Top Header Badge */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-950/80 border border-emerald-800/80 text-emerald-400 text-[11px] font-mono font-bold tracking-wider uppercase">
              <ShieldAlert className="w-3.5 h-3.5 text-emerald-400" />
              RESTRICTED OVERRIDE
            </span>
            <span className="text-[11px] font-mono text-slate-500">AMD-AUTH-V2</span>
          </div>

          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              NECO AMD — Unit Head Override Portal
            </h1>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Restricted management console. Grants administrative authority to override active shift logs, system targets, and master records.
            </p>
          </div>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="bg-rose-950/60 border border-rose-800/80 text-rose-200 text-xs px-3.5 py-2.5 rounded-lg flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span className="leading-snug">{error}</span>
          </div>
        )}

        {/* Override Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Optional Email Override */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-300">
              Administrator Email <span className="text-slate-500 font-normal">(Optional)</span>
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="unithead@neco.com"
                disabled={isSubmitting}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-200 font-mono placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors disabled:opacity-50"
              />
            </div>
            <p className="text-[10px] text-slate-500 font-mono">
              Defaults to pre-configured Unit Head identity.
            </p>
          </div>

          {/* Master Password */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-slate-300">
                Master Override Password <span className="text-rose-400">*</span>
              </label>
              <span className="text-[10px] text-slate-500">Case-sensitive</span>
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter access key..."
                autoFocus
                required
                disabled={isSubmitting}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors disabled:opacity-50"
              />
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting || !password}
            className="w-full mt-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-all shadow-md hover:shadow-emerald-900/30 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                <span>Verifying Credentials...</span>
              </>
            ) : (
              <>
                <Lock className="w-3.5 h-3.5 text-slate-950" />
                <span>Authenticate &amp; Override</span>
              </>
            )}
          </button>
        </form>

        {/* Footer Return Link */}
        <div className="pt-2 border-t border-slate-800/80 text-center">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors py-1 group"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-slate-500 group-hover:-translate-x-0.5 transition-transform" />
            <span>← Return to Shop Floor Sheet</span>
          </Link>
        </div>
      </div>

      {/* Discreet bottom security notice */}
      <div className="mt-8 text-center text-[11px] text-slate-600 font-mono">
        NECO AMD Industrial Automation &bull; Authorized Personnel Only
      </div>
    </main>
  );
}
