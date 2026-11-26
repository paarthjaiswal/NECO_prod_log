"use client";
import React, { useEffect, useMemo, useState } from "react";
import { X, ExternalLink, Calendar, Clock, Layers, Filter } from "lucide-react";
import { ShiftItemProductionRow } from "@/types";
import { EnrichedAnalyticsRow } from "@/services/analyticsEngine";
import { ShiftSheetReadOnlyContent } from "./ShiftSheetReadOnlyContent";

export interface ShiftSheetPreviewModalProps {
  isOpen: boolean;
  date: string;
  shift: string;
  initialLine?: string;
  allRows: EnrichedAnalyticsRow[];
  filteredRows?: EnrichedAnalyticsRow[];
  allItemProduction: ShiftItemProductionRow[];
  filteredItemProduction?: ShiftItemProductionRow[];
  hasActiveScopeFilter?: boolean;
  onClose: () => void;
  onSelectMachine?: (machineId: string) => void;
  onOpenShiftSheet?: (date: string, shift: string, line: string) => void;
}

function getDefaultWorkingMinutes(shift: string): number {
  const s = (shift || "").toLowerCase();
  if (s.includes("shift c")) return 375;
  return 465;
}

export const ShiftSheetPreviewModal: React.FC<ShiftSheetPreviewModalProps> = ({
  isOpen,
  date,
  shift,
  initialLine,
  allRows,
  filteredRows,
  allItemProduction,
  filteredItemProduction,
  hasActiveScopeFilter = false,
  onClose,
  onSelectMachine,
  onOpenShiftSheet,
}) => {
  const [scopeMode, setScopeMode] = useState<"full" | "filtered">("full");
  const [selectedLineState, setSelectedLineState] = useState<string>(initialLine || "");

  // Reset scope and initial line when opening for a new target
  useEffect(() => {
    if (isOpen) {
      setScopeMode("full");
      setSelectedLineState(initialLine || "");
    }
  }, [isOpen, date, shift, initialLine]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const activeLogSource =
    scopeMode === "filtered" && filteredRows ? filteredRows : allRows;
  const activeProdSource =
    scopeMode === "filtered" && filteredItemProduction
      ? filteredItemProduction
      : allItemProduction;

  // Rows matching (date, shift) across all lines
  const shiftLogsAllLines = useMemo(() => {
    return activeLogSource.filter(
      (r) =>
        (r.date || "") === date &&
        (r.shift || "").toLowerCase() === (shift || "").toLowerCase()
    );
  }, [activeLogSource, date, shift]);

  const shiftProdAllLines = useMemo(() => {
    return activeProdSource.filter(
      (p) =>
        (p.date || "") === date &&
        (p.shift || "").toLowerCase() === (shift || "").toLowerCase()
    );
  }, [activeProdSource, date, shift]);

  // Distinct lines active on this (date, shift)
  const availableLines = useMemo(() => {
    const lineSet = new Set<string>();
    for (const r of shiftLogsAllLines) {
      if (r.line) lineSet.add(r.line);
    }
    for (const p of shiftProdAllLines) {
      if (p.line) lineSet.add(p.line);
    }
    return Array.from(lineSet).sort((a, b) => a.localeCompare(b));
  }, [shiftLogsAllLines, shiftProdAllLines]);

  const activeLine = useMemo(() => {
    if (availableLines.length === 0) return selectedLineState || initialLine || "";
    const match = availableLines.find(
      (l) => l.toLowerCase() === (selectedLineState || "").toLowerCase()
    );
    return match || availableLines[0];
  }, [availableLines, selectedLineState, initialLine]);

  const sheetRows = useMemo(() => {
    return activeLine
      ? shiftLogsAllLines.filter(
          (r) => (r.line || "Line 1").toLowerCase() === activeLine.toLowerCase()
        )
      : shiftLogsAllLines;
  }, [shiftLogsAllLines, activeLine]);

  const sheetProdRows = useMemo(() => {
    return activeLine
      ? shiftProdAllLines.filter(
          (p) => (p.line || "Line 1").toLowerCase() === activeLine.toLowerCase()
        )
      : shiftProdAllLines;
  }, [shiftProdAllLines, activeLine]);

  const workingMinutes = useMemo(() => {
    const first = sheetRows[0];
    const mins = Number(first?.shiftWorkingMinutes ?? first?.totalWorkingMinutes);
    return mins > 0 ? mins : getDefaultWorkingMinutes(shift);
  }, [sheetRows, shift]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-[1px] p-2 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Daily Shift Sheet Preview"
    >
      <div
        className="bg-white rounded-xl border border-slate-300 shadow-2xl max-w-[96vw] w-full max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="bg-slate-900 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0 border-b border-slate-800">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="text-sm sm:text-base font-extrabold tracking-tight text-white">
              Daily Shift Sheet View
            </h3>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-xs font-mono font-bold text-sky-300">
              <Calendar className="w-3 h-3" />
              {date}
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-xs font-semibold text-amber-300">
              <Clock className="w-3 h-3" />
              {shift}
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[11px] font-mono text-slate-300">
              {workingMinutes}m Shift
            </span>

            {/* Line Switcher Pills */}
            {availableLines.length > 0 && (
              <div className="inline-flex items-center gap-1 bg-slate-800/90 p-0.5 rounded-md border border-slate-700 ml-1">
                <Layers className="w-3 h-3 text-slate-400 ml-1.5 mr-0.5" />
                {availableLines.map((line) => (
                  <button
                    key={line}
                    type="button"
                    onClick={() => setSelectedLineState(line)}
                    className={`px-2 py-0.5 text-[11px] font-bold rounded transition-colors cursor-pointer ${
                      activeLine.toLowerCase() === line.toLowerCase()
                        ? "bg-blue-600 text-white shadow-2xs"
                        : "text-slate-300 hover:text-white hover:bg-slate-700"
                    }`}
                  >
                    {line}
                  </button>
                ))}
              </div>
            )}

            {/* Scope Toggle when Analytics has active machine/product/operator filters */}
            {hasActiveScopeFilter && (
              <div className="inline-flex items-center gap-1 bg-slate-800/90 p-0.5 rounded-md border border-slate-700">
                <Filter className="w-3 h-3 text-amber-400 ml-1.5 mr-0.5" />
                <button
                  type="button"
                  onClick={() => setScopeMode("full")}
                  className={`px-2 py-0.5 text-[11px] font-bold rounded transition-colors cursor-pointer ${
                    scopeMode === "full"
                      ? "bg-emerald-600 text-white"
                      : "text-slate-300 hover:text-white"
                  }`}
                >
                  Full Shift Sheet
                </button>
                <button
                  type="button"
                  onClick={() => setScopeMode("filtered")}
                  className={`px-2 py-0.5 text-[11px] font-bold rounded transition-colors cursor-pointer ${
                    scopeMode === "filtered"
                      ? "bg-amber-600 text-white"
                      : "text-slate-300 hover:text-white"
                  }`}
                >
                  Filtered Only
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {onOpenShiftSheet && (
              <button
                type="button"
                onClick={() => {
                  onOpenShiftSheet(date, shift, activeLine);
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-slate-950 rounded shadow-2xs transition-colors cursor-pointer"
              >
                <span>Open in Daily Shift Sheet</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              title="Close (Esc)"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Modal Body */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 bg-slate-50">
          <ShiftSheetReadOnlyContent
            rows={sheetRows}
            itemProdRows={sheetProdRows}
            groupByShift={false}
            shiftWorkingMinutesOverride={workingMinutes}
            emptyMessage={`No machine log rows recorded for ${date} · ${shift}${
              activeLine ? ` · ${activeLine}` : ""
            }.`}
            onSelectMachine={(machineId) => {
              onSelectMachine?.(machineId);
              onClose();
            }}
          />
        </div>
      </div>
    </div>
  );
};
