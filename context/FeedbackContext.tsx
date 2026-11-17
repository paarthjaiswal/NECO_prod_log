"use client";

import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  ReactNode,
} from "react";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";

export interface FeedbackNotification {
  id: number;
  type: "success" | "error";
  title: string;
  detail?: string;
}

export interface RunWithFeedbackOptions {
  loadingMessage?: string;
  successTitle?: string;
  successDetail?: string;
  errorTitle?: string;
  rethrow?: boolean;
}

export interface FeedbackContextValue {
  pendingCount: number;
  loadingMessage: string;
  notification: FeedbackNotification | null;
  startLoading: (message?: string) => void;
  stopLoading: () => void;
  notifySuccess: (title: string, detail?: string) => void;
  notifyError: (title: string, detail?: string) => void;
  clearNotification: () => void;
  runWithFeedback: <T>(
    task: () => Promise<T>,
    options?: RunWithFeedbackOptions
  ) => Promise<T | undefined>;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [pendingCount, setPendingCount] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState("Syncing with server...");
  const [notification, setNotification] = useState<FeedbackNotification | null>(
    null
  );

  const notificationIdRef = useRef(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startLoading = useCallback((message?: string) => {
    if (message) setLoadingMessage(message);
    setPendingCount((prev) => prev + 1);
  }, []);

  const stopLoading = useCallback(() => {
    setPendingCount((prev) => Math.max(0, prev - 1));
  }, []);

  const clearNotification = useCallback(() => {
    clearTimer();
    setNotification(null);
  }, [clearTimer]);

  const notifySuccess = useCallback(
    (title: string, detail?: string) => {
      clearTimer();
      notificationIdRef.current += 1;
      const id = notificationIdRef.current;
      setNotification({ id, type: "success", title, detail });

      timerRef.current = setTimeout(() => {
        setNotification((curr) => (curr?.id === id ? null : curr));
      }, 3000);
    },
    [clearTimer]
  );

  const notifyError = useCallback(
    (title: string, detail?: string) => {
      clearTimer();
      notificationIdRef.current += 1;
      const id = notificationIdRef.current;
      setNotification({ id, type: "error", title, detail });

      timerRef.current = setTimeout(() => {
        setNotification((curr) => (curr?.id === id ? null : curr));
      }, 7000);
    },
    [clearTimer]
  );

  const runWithFeedback = useCallback(
    async <T,>(
      task: () => Promise<T>,
      options?: RunWithFeedbackOptions
    ): Promise<T | undefined> => {
      startLoading(options?.loadingMessage);
      try {
        const result = await task();
        if (options?.successTitle) {
          notifySuccess(options.successTitle, options.successDetail);
        }
        return result;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        notifyError(options?.errorTitle || "Action Failed", message);
        if (options?.rethrow) {
          throw err;
        }
        return undefined;
      } finally {
        stopLoading();
      }
    },
    [startLoading, stopLoading, notifySuccess, notifyError]
  );

  const isLoading = pendingCount > 0;

  return (
    <FeedbackContext.Provider
      value={{
        pendingCount,
        loadingMessage,
        notification,
        startLoading,
        stopLoading,
        notifySuccess,
        notifyError,
        clearNotification,
        runWithFeedback,
      }}
    >
      {/* Slim fixed top progress bar when loading */}
      {isLoading && (
        <div
          role="progressbar"
          aria-label={loadingMessage}
          className="fixed top-0 left-0 right-0 z-50 h-1 bg-amber-500 animate-pulse pointer-events-none"
        />
      )}

      {/* Floating loading status pill */}
      {isLoading && (
        <aside
          role="status"
          aria-live="polite"
          className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white border border-slate-700 shadow-lg rounded-full px-4 py-2 flex items-center gap-2.5 text-xs font-semibold pointer-events-none select-none backdrop-blur-xs"
        >
          <span className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin shrink-0" />
          <span>{loadingMessage}</span>
        </aside>
      )}

      {/* Floating Notification Banner (Success / Error) */}
      {notification && (
        <div
          role="alert"
          aria-live="assertive"
          className={`fixed left-1/2 -translate-x-1/2 z-50 max-w-md w-max shadow-xl rounded-lg px-4 py-3 flex items-start gap-3 text-xs transition-all duration-200 ${
            isLoading ? "top-28" : "top-16"
          } ${
            notification.type === "success"
              ? "bg-emerald-950/95 text-emerald-100 border border-emerald-500 shadow-emerald-950/50"
              : "bg-rose-950/95 text-rose-100 border border-rose-500 shadow-rose-950/50"
          }`}
        >
          <div className="shrink-0 mt-0.5">
            {notification.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            )}
          </div>
          <div className="flex-1 pr-2">
            <div className="font-bold leading-snug">{notification.title}</div>
            {notification.detail && (
              <div
                className={`text-[11px] mt-0.5 leading-normal ${
                  notification.type === "success"
                    ? "text-emerald-200/90"
                    : "text-rose-200/90"
                }`}
              >
                {notification.detail}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={clearNotification}
            aria-label="Dismiss notification"
            className="shrink-0 p-1 rounded hover:bg-white/10 transition-colors text-white/70 hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {children}
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackContextValue {
  const context = useContext(FeedbackContext);
  if (!context) {
    throw new Error("useFeedback must be used within a FeedbackProvider");
  }
  return context;
}
