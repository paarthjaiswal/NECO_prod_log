"use client";
import React, { useEffect, useMemo, useState } from "react";
import { X, ExternalLink, Calendar, Clock, Layers, Package, Filter } from "lucide-react";
import { ShiftItemProductionRow } from "@/types";
import { calculateTotalBreakdown } from "@/services/storageService";
import {
  EnrichedAnalyticsRow,
  calculateOeeMetrics,
  resolveProductQcMetrics,
} from "@/services/analyticsEngine";

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

function getOeeBadgeClass(oee: number): string {
  if (oee >= 85) return "bg-emerald-100 text-emerald-800 border-emerald-300";
  if (oee >= 65) return "bg-amber-100 text-amber-800 border-amber-300";
  return "bg-rose-100 text-rose-800 border-rose-300";
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

  // Rows filtered to activeLine and sorted identically to DailyShiftSheet
  const sheetRows = useMemo(() => {
    const list = activeLine
      ? shiftLogsAllLines.filter(
          (r) => (r.line || "Line 1").toLowerCase() === activeLine.toLowerCase()
        )
      : shiftLogsAllLines;

    return [...list].sort((a, b) => {
      const srDiff = (Number(a.srNo) || 0) - (Number(b.srNo) || 0);
      if (srDiff !== 0) return srDiff;
      const nameCmp = (a.machineName || "").localeCompare(b.machineName || "");
      if (nameCmp !== 0) return nameCmp;
      return (Number(a.runNo) || 1) - (Number(b.runNo) || 1);
    });
  }, [shiftLogsAllLines, activeLine]);

  const sheetProdRows = useMemo(() => {
    const list = activeLine
      ? shiftProdAllLines.filter(
          (p) => (p.line || "Line 1").toLowerCase() === activeLine.toLowerCase()
        )
      : shiftProdAllLines;
    return [...list].sort((a, b) =>
      (a.itemName || a.itemCode || "").localeCompare(b.itemName || b.itemCode || "")
    );
  }, [shiftProdAllLines, activeLine]);

  const totalsMetrics = useMemo(() => calculateOeeMetrics(sheetRows), [sheetRows]);

  const workingMinutes = useMemo(() => {
    const first = sheetRows[0];
    const mins = Number(first?.shiftWorkingMinutes ?? first?.totalWorkingMinutes);
    return mins > 0 ? mins : getDefaultWorkingMinutes(shift);
  }, [sheetRows, shift]);

  const totalPreQc = useMemo(
    () => sheetProdRows.reduce((s, p) => s + (Number(p.totalProduction) || 0), 0),
    [sheetProdRows]
  );

  const totalBdPct = useMemo(() => {
    if (totalsMetrics.plannedMinutes <= 0) return 0;
    return Number(
      ((totalsMetrics.downtimeMinutes / totalsMetrics.plannedMinutes) * 100).toFixed(1)
    );
  }, [totalsMetrics]);

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
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4 bg-slate-50">
          {/* Main Shift Table */}
          <div className="bg-white rounded-lg border border-slate-300 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] text-left border-collapse">
                <thead>
                  <tr className="bg-slate-900 text-slate-100 border-b border-slate-800 text-[10px] uppercase tracking-wider font-semibold">
                    <th rowSpan={2} className="px-2 py-2 border-r border-slate-800 text-center w-10">
                      Sr #
                    </th>
                    <th rowSpan={2} className="px-2.5 py-2 border-r border-slate-800 min-w-32">
                      Machine
                    </th>
                    <th rowSpan={2} className="px-2 py-2 border-r border-slate-800 min-w-28">
                      Operator
                    </th>
                    <th rowSpan={2} className="px-2 py-2 border-r border-slate-800 min-w-32">
                      Item
                    </th>
                    <th rowSpan={2} className="px-2 py-2 border-r border-slate-800 min-w-28">
                      Operation
                    </th>
                    <th rowSpan={2} className="px-2 py-2 border-r border-slate-800 text-right">
                      CT
                    </th>
                    <th rowSpan={2} className="px-2 py-2 border-r border-slate-800 text-right">
                      Std
                    </th>
                    <th
                      rowSpan={2}
                      className="px-2 py-2 border-r border-slate-800 text-right bg-slate-800"
                    >
                      Actual
                    </th>
                    <th rowSpan={2} className="px-2 py-2 border-r border-slate-800 text-right">
                      Rework
                    </th>
                    <th
                      colSpan={7}
                      className="px-2 py-1 border-r border-slate-800 text-center bg-slate-800 text-amber-300 font-bold"
                    >
                      Breakdown (Minutes)
                    </th>
                    <th
                      rowSpan={2}
                      className="px-2 py-2 border-r border-slate-800 text-right bg-slate-800 text-amber-200"
                    >
                      Total BD (m)
                    </th>
                    <th rowSpan={2} className="px-2 py-2 border-r border-slate-800 text-right">
                      BD %
                    </th>
                    <th rowSpan={2} className="px-2 py-2 border-r border-slate-800 text-right">
                      Balance / OEE %
                    </th>
                    <th rowSpan={2} className="px-2 py-2 min-w-32">
                      Remarks
                    </th>
                  </tr>
                  <tr className="bg-slate-800 text-slate-300 border-b border-slate-700 text-[9px] font-bold text-center">
                    <th className="px-1.5 py-1 border-r border-slate-700">NO/DISC</th>
                    <th className="px-1.5 py-1 border-r border-slate-700">CHANGE</th>
                    <th className="px-1.5 py-1 border-r border-slate-700">POWER</th>
                    <th className="px-1.5 py-1 border-r border-slate-700">OPERATOR</th>
                    <th className="px-1.5 py-1 border-r border-slate-700">BREAK DOWN</th>
                    <th className="px-1.5 py-1 border-r border-slate-700">FIX/PROG</th>
                    <th className="px-1.5 py-1 border-r border-slate-800">MISC.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {sheetRows.length === 0 ? (
                    <tr>
                      <td colSpan={20} className="px-4 py-8 text-center text-slate-500 italic">
                        No machine log rows recorded for {date} · {shift}
                        {activeLine ? ` · ${activeLine}` : ""}.
                      </td>
                    </tr>
                  ) : (
                    sheetRows.map((row, idx) => {
                      const bd = row.breakdown || {
                        noDisc: 0,
                        change: 0,
                        power: 0,
                        operator: 0,
                        machineBreakdown: 0,
                        fixProgSettings: 0,
                        miscellaneous: 0,
                      };
                      const totalBd =
                        Number(row.totalBreakdownMinutes) || calculateTotalBreakdown(bd);
                      const bdPct =
                        row.allocatedPlannedMinutes > 0
                          ? ((totalBd / row.allocatedPlannedMinutes) * 100).toFixed(1)
                          : "0.0";
                      const rowMetrics = calculateOeeMetrics([row]);
                      const accountedMins = Math.round(
                        (row.idealRunMinutes || 0) + totalBd
                      );
                      const plannedMins = Math.round(row.allocatedPlannedMinutes || 0);

                      return (
                        <tr
                          key={row.id || `${row.machineId}_${row.runNo || 1}_${idx}`}
                          className="hover:bg-slate-50 transition-colors"
                        >
                          <td className="px-2 py-1.5 border-r border-slate-200 text-center font-mono text-slate-500">
                            {row.srNo || idx + 1}
                          </td>
                          <td className="px-2.5 py-1.5 border-r border-slate-200 font-sans">
                            <div className="flex items-center gap-1 flex-wrap">
                              {onSelectMachine && row.machineId ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onSelectMachine(row.machineId);
                                    onClose();
                                  }}
                                  className="font-bold text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center gap-1 cursor-pointer text-left"
                                  title="Open Machine Analytics Drilldown"
                                >
                                  <span>{row.machineName}</span>
                                  <ExternalLink className="w-2.5 h-2.5 opacity-60 shrink-0" />
                                </button>
                              ) : (
                                <span className="font-bold text-slate-900">
                                  {row.machineName}
                                </span>
                              )}
                              {row.isTempMachine && (
                                <span className="px-1 rounded bg-amber-100 text-amber-800 text-[9px] font-bold">
                                  TEMP
                                </span>
                              )}
                              {row.isSplitRun && (
                                <span className="px-1 rounded bg-purple-100 text-purple-800 text-[9px] font-bold">
                                  R{row.runNo || 1}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-1.5 border-r border-slate-200 text-slate-700">
                            {(row.operatorName || "").trim() || (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 border-r border-slate-200 font-semibold text-slate-800">
                            {row.itemName || row.itemId || (
                              <span className="text-slate-400 font-normal">—</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 border-r border-slate-200 text-slate-600">
                            {row.operation || <span className="text-slate-400">—</span>}
                          </td>
                          <td className="px-2 py-1.5 border-r border-slate-200 text-right font-mono tabular-nums text-slate-600">
                            {Number(row.cycleTime) > 0 ? row.cycleTime : "—"}
                          </td>
                          <td className="px-2 py-1.5 border-r border-slate-200 text-right font-mono tabular-nums text-slate-700">
                            {(Number(row.stdOutput) || 0).toLocaleString()}
                          </td>
                          <td className="px-2 py-1.5 border-r border-slate-200 text-right font-mono tabular-nums font-bold text-slate-900 bg-sky-50/50">
                            {(Number(row.actualOutput) || 0).toLocaleString()}
                          </td>
                          <td className="px-2 py-1.5 border-r border-slate-200 text-right font-mono tabular-nums">
                            {Number(row.rework) > 0 ? (
                              <span className="text-rose-700 font-bold">
                                {Number(row.rework).toLocaleString()}
                              </span>
                            ) : (
                              <span className="text-slate-400">0</span>
                            )}
                          </td>
                          {[
                            bd.noDisc,
                            bd.change,
                            bd.power,
                            bd.operator,
                            bd.machineBreakdown,
                            bd.fixProgSettings,
                            bd.miscellaneous,
                          ].map((bdVal, bIdx) => {
                            const num = Number(bdVal) || 0;
                            return (
                              <td
                                key={bIdx}
                                className={`px-1.5 py-1.5 border-r border-slate-200 text-right font-mono tabular-nums ${
                                  num > 0
                                    ? "bg-amber-50 text-amber-900 font-semibold"
                                    : "text-slate-300"
                                }`}
                              >
                                {num > 0 ? num : "0"}
                              </td>
                            );
                          })}
                          <td
                            className={`px-2 py-1.5 border-r border-slate-200 text-right font-mono tabular-nums font-bold ${
                              totalBd > 0
                                ? "bg-amber-100/70 text-amber-900"
                                : "text-slate-400"
                            }`}
                          >
                            {totalBd}m
                          </td>
                          <td className="px-2 py-1.5 border-r border-slate-200 text-right font-mono tabular-nums text-slate-600">
                            {bdPct}%
                          </td>
                          <td className="px-2 py-1.5 border-r border-slate-200 text-right font-mono tabular-nums whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              <span className="text-[10px] text-slate-500">
                                {accountedMins}/{plannedMins}m
                              </span>
                              <span
                                className={`px-1.5 py-0.2 rounded text-[10px] font-extrabold border ${getOeeBadgeClass(
                                  rowMetrics.oeePct
                                )}`}
                              >
                                {rowMetrics.oeePct}%
                              </span>
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-slate-600 max-w-48 truncate" title={row.remarks || ""}>
                            {(row.remarks || "").trim() || (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {sheetRows.length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold text-slate-900">
                      <td colSpan={6} className="px-2.5 py-2 border-r border-slate-300 uppercase text-[10px] tracking-wider">
                        Shift Totals ({sheetRows.length} rows)
                      </td>
                      <td className="px-2 py-2 border-r border-slate-300 text-right font-mono tabular-nums">
                        {totalsMetrics.totalStd.toLocaleString()}
                      </td>
                      <td className="px-2 py-2 border-r border-slate-300 text-right font-mono tabular-nums bg-sky-100/70 text-slate-900">
                        {totalsMetrics.totalActual.toLocaleString()}
                      </td>
                      <td className="px-2 py-2 border-r border-slate-300 text-right font-mono tabular-nums text-rose-700">
                        {totalsMetrics.totalRework.toLocaleString()}
                      </td>
                      <td className="px-1.5 py-2 border-r border-slate-300 text-right font-mono tabular-nums text-amber-900">
                        {totalsMetrics.breakdownTotals.noDisc}
                      </td>
                      <td className="px-1.5 py-2 border-r border-slate-300 text-right font-mono tabular-nums text-amber-900">
                        {totalsMetrics.breakdownTotals.change}
                      </td>
                      <td className="px-1.5 py-2 border-r border-slate-300 text-right font-mono tabular-nums text-amber-900">
                        {totalsMetrics.breakdownTotals.power}
                      </td>
                      <td className="px-1.5 py-2 border-r border-slate-300 text-right font-mono tabular-nums text-amber-900">
                        {totalsMetrics.breakdownTotals.operator}
                      </td>
                      <td className="px-1.5 py-2 border-r border-slate-300 text-right font-mono tabular-nums text-amber-900">
                        {totalsMetrics.breakdownTotals.machineBreakdown}
                      </td>
                      <td className="px-1.5 py-2 border-r border-slate-300 text-right font-mono tabular-nums text-amber-900">
                        {totalsMetrics.breakdownTotals.fixProgSettings}
                      </td>
                      <td className="px-1.5 py-2 border-r border-slate-300 text-right font-mono tabular-nums text-amber-900">
                        {totalsMetrics.breakdownTotals.miscellaneous}
                      </td>
                      <td className="px-2 py-2 border-r border-slate-300 text-right font-mono tabular-nums bg-amber-100 text-amber-900">
                        {totalsMetrics.downtimeMinutes}m
                      </td>
                      <td className="px-2 py-2 border-r border-slate-300 text-right font-mono tabular-nums">
                        {totalBdPct}%
                      </td>
                      <td className="px-2 py-2 border-r border-slate-300 text-right font-mono tabular-nums">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[11px] font-black border ${getOeeBadgeClass(
                            totalsMetrics.oeePct
                          )}`}
                        >
                          {totalsMetrics.oeePct}%
                        </span>
                      </td>
                      <td className="px-2 py-2 text-[10px] text-slate-500 font-normal">
                        Plan: {totalsMetrics.planAchievementPct}% · Avail: {totalsMetrics.availabilityPct}%
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Shift Finished Production (Pre-QC) Section */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-2xs overflow-hidden">
            <div className="bg-slate-900 text-white px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold">
                  Shift Finished Production (Pre-QC)
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-900/80 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded">
                  Pre-QC · 100% QC Assumed
                </span>
              </div>
              <span className="text-xs font-mono font-bold text-emerald-300">
                Total: {totalPreQc.toLocaleString()} pcs
              </span>
            </div>

            {sheetProdRows.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-500 italic">
                No Pre-QC shift production logged for this shift.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-100 text-slate-700 uppercase text-[10px] font-bold border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2 text-right">Total Production (Pre-QC)</th>
                      <th className="px-3 py-2 text-right">QC Passed (100% Assumed)</th>
                      <th className="px-3 py-2">Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {sheetProdRows.map((p, idx) => {
                      const qc = resolveProductQcMetrics(Number(p.totalProduction) || 0, true);
                      return (
                        <tr key={p.id || `${p.itemKey}_${idx}`} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-sans">
                            <div className="flex items-center gap-1.5">
                              {p.itemCode && (
                                <span className="font-mono font-bold text-slate-600 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded text-[10px]">
                                  {p.itemCode}
                                </span>
                              )}
                              <span className="font-bold text-slate-900">
                                {p.itemName || p.itemCode || p.itemKey}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums font-extrabold text-emerald-800 bg-emerald-50/40">
                            {qc.preQcProduction.toLocaleString()} pcs
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums font-bold text-emerald-700">
                            {qc.qcPassed.toLocaleString()} pcs
                          </td>
                          <td className="px-3 py-2 text-slate-600">
                            {(p.remarks || "").trim() || <span className="text-slate-300">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
