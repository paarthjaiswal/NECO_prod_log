"use client";

import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
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
  taskKey?: string;
}

export interface FeedbackContextValue {
  pendingCount: number;
  loadingMessage: string;
  notification: FeedbackNotification | null;
  startLoading: (message?: string, taskKey?: string) => string;
  stopLoading: (taskId?: string) => void;
  cancelLoadingKey: (taskKey: string) => void;
  notifySuccess: (title: string, detail?: string) => void;
  notifyError: (title: string, detail?: string) => void;
  clearNotification: () => void;
  runWithFeedback: <T>(
    task: () => Promise<T>,
    options?: RunWithFeedbackOptions
  ) => Promise<T | undefined>;
}

interface ActiveTask {
  message: string;
  timestamp: number;
  taskKey?: string;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Map<string, ActiveTask>>(() => new Map());
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

  const startLoading = useCallback((message?: string, taskKey?: string): string => {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setTasks((prev) => {
      const next = new Map(prev);
      if (taskKey) {
        for (const [existingId, existingTask] of next.entries()) {
          if (existingTask.taskKey === taskKey) {
            next.delete(existingId);
          }
        }
      }
      next.set(taskId, {
        message: message || "Syncing with server...",
        timestamp: Date.now(),
        taskKey,
      });
      return next;
    });
    return taskId;
  }, []);

  const stopLoading = useCallback((taskId?: string) => {
    setTasks((prev) => {
      if (prev.size === 0) return prev;
      if (taskId && !prev.has(taskId)) return prev;
      const next = new Map(prev);
      if (taskId) {
        next.delete(taskId);
      } else {
        const firstKey = next.keys().next().value;
        if (firstKey) next.delete(firstKey);
      }
      return next;
    });
  }, []);

  const cancelLoadingKey = useCallback((taskKey: string) => {
    if (!taskKey) return;
    setTasks((prev) => {
      if (prev.size === 0) return prev;
      let removed = false;
      const next = new Map(prev);
      for (const [id, task] of next.entries()) {
        if (task.taskKey === taskKey) {
          next.delete(id);
          removed = true;
        }
      }
      return removed ? next : prev;
    });
  }, []);

  const forceResetLoading = useCallback(() => {
    setTasks(new Map());
  }, []);

  // Watchdog cleanup: clear stale tasks running longer than 20 seconds
  useEffect(() => {
    if (tasks.size === 0) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setTasks((prev) => {
        let hasExpired = false;
        const next = new Map(prev);
        for (const [id, task] of next.entries()) {
          if (now - task.timestamp > 20_000) {
            next.delete(id);
            hasExpired = true;
          }
        }
        return hasExpired ? next : prev;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [tasks.size]);

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
      const taskId = startLoading(options?.loadingMessage, options?.taskKey);
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
        stopLoading(taskId);
      }
    },
    [startLoading, stopLoading, notifySuccess, notifyError]
  );

  const currentLoadingMessage = useMemo(() => {
    if (tasks.size === 0) return "Syncing with server...";
    const lastTask = Array.from(tasks.values()).pop();
    return lastTask?.message || "Syncing with server...";
  }, [tasks]);

  const isLoading = tasks.size > 0;

  const contextValue = useMemo<FeedbackContextValue>(
    () => ({
      pendingCount: tasks.size,
      loadingMessage: currentLoadingMessage,
      notification,
      startLoading,
      stopLoading,
      cancelLoadingKey,
      notifySuccess,
      notifyError,
      clearNotification,
      runWithFeedback,
    }),
    [
      tasks.size,
      currentLoadingMessage,
      notification,
      startLoading,
      stopLoading,
      cancelLoadingKey,
      notifySuccess,
      notifyError,
      clearNotification,
      runWithFeedback,
    ]
  );

  return (
    <FeedbackContext.Provider value={contextValue}>
      {/* Top progress bar when loading (prominent) */}
      {isLoading && (
        <div
          role="progressbar"
          aria-label={currentLoadingMessage}
          className="fixed top-0 left-0 right-0 z-50 h-2 bg-amber-500 animate-pulse pointer-events-none"
        />
      )}

      {/* Floating loading status pill with manual dismiss (~2x bigger) */}
      {isLoading && (
        <aside
          role="status"
          aria-live="polite"
          className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-slate-900/95 text-white border-2 border-slate-700 shadow-2xl rounded-full pl-5 pr-3 py-3 flex items-center gap-3.5 text-sm sm:text-base font-bold select-none backdrop-blur-md transition-all pointer-events-auto"
        >
          <span className="w-8 h-8 border-[3.5px] border-amber-400 border-t-transparent rounded-full animate-spin shrink-0" />
          <span>{currentLoadingMessage}</span>
          <button
            type="button"
            onClick={forceResetLoading}
            title="Dismiss loading indicator"
            aria-label="Dismiss loading indicator"
            className="ml-2 p-1.5 rounded-full hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </aside>
      )}

      {/* Floating Notification Banner (Success / Error) */}
      {notification && (
        <div
          role="alert"
          aria-live="assertive"
          className={`fixed left-1/2 -translate-x-1/2 z-50 max-w-md w-max shadow-xl rounded-lg px-4 py-3 flex items-start gap-3 text-xs transition-all duration-200 ${
            isLoading ? "top-36" : "top-16"
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
