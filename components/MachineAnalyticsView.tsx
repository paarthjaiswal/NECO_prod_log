"use client";

import React, { useState, useMemo } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock,
  User,
  ExternalLink,
  Calendar,
  Layers,
  Cpu,
  Package,
  Wrench,
  RotateCcw,
  FileSpreadsheet,
} from "lucide-react";
import {
  MasterDataState,
  MachineMaster,
  ShiftType,
} from "@/types";
import {
  EnrichedAnalyticsRow,
  buildMachineDetailAnalytics,
  MachineDetailAnalytics,
} from "@/services/analyticsEngine";
import { exportMachineDetailExcel } from "@/services/excelExport";
import { useFeedback } from "@/context/FeedbackContext";
import {
  BD_KEYS,
  DOWNTIME_PALETTE,
  TOTAL_DOWNTIME_THEME,
} from "@/services/downtimePalette";

interface MachineAnalyticsViewProps {
  machineId: string;
  onSelectMachine: (machineId: string) => void;
  onBackToAnalytics: () => void;
  onOpenShiftEntry?: (params: {
    machineId: string;
    date?: string;
    shift?: ShiftType;
    line?: string;
    fromTab?: string;
  }) => void;
  enrichedRows: EnrichedAnalyticsRow[];
  masterData: MasterDataState;
  fromDate: string;
  toDate: string;
  activePreset: string;
  onDateRangeChange: (fromDate: string, toDate: string, preset?: string) => void;
}

function getOeeColorClass(oee: number): string {
  if (oee >= 85) return "bg-emerald-50 text-emerald-900 border-emerald-300";
  if (oee >= 65) return "bg-amber-50 text-amber-900 border-amber-300";
  return "bg-rose-50 text-rose-900 border-rose-300";
}

function getOeeBadgeClass(oee: number): string {
  if (oee >= 85) return "bg-emerald-100 text-emerald-800 border-emerald-300";
  if (oee >= 65) return "bg-amber-100 text-amber-800 border-amber-300";
  return "bg-rose-100 text-rose-800 border-rose-300";
}

export const MachineAnalyticsView: React.FC<MachineAnalyticsViewProps> = ({
  machineId,
  onSelectMachine,
  onBackToAnalytics,
  onOpenShiftEntry,
  enrichedRows,
  masterData,
  fromDate,
  toDate,
  activePreset,
  onDateRangeChange,
}) => {
  // Local filter states
  const [selectedShift, setSelectedShift] = useState<string>("ALL");
  const [historyTab, setHistoryTab] = useState<"daily" | "shift">("daily");
  const [customFrom, setCustomFrom] = useState(fromDate);
  const [customTo, setCustomTo] = useState(toDate);

  // Sync custom date inputs when parent props change
  React.useEffect(() => {
    setCustomFrom(fromDate);
    setCustomTo(toDate);
  }, [fromDate, toDate]);

  // 1. Build List of ALL Navigable Machines (Permanent grouped by Line, then Temporary)
  const { allNavigableMachines, machineGroups } = useMemo(() => {
    const permMachines = (masterData.machines || [])
      .filter((m) => m.status !== "disabled")
      .sort((a, b) => {
        const lineCmp = (a.line || "Line 1").localeCompare(b.line || "Line 1");
        if (lineCmp !== 0) return lineCmp;
        return (a.sortOrder ?? 999) - (b.sortOrder ?? 999);
      });

    // Extract any temporary machines seen in enrichedRows or masterData
    const tempMap = new Map<string, MachineMaster>();
    for (const r of enrichedRows) {
      if (r.isTempMachine || (r.machineId && r.machineId.startsWith("temp_"))) {
        const id = r.machineId || `temp_${r.machineName}`;
        if (!tempMap.has(id)) {
          tempMap.set(id, {
            id,
            name: r.machineName || id,
            code: id,
            line: r.line || "Line 1",
            type: "TEMP",
            status: "active",
          });
        }
      }
    }
    const tempMachines = Array.from(tempMap.values());

    const all = [...permMachines, ...tempMachines];

    // Group by line
    const groups = new Map<string, MachineMaster[]>();
    for (const m of permMachines) {
      const line = m.line || "Line 1";
      const list = groups.get(line) || [];
      list.push(m);
      groups.set(line, list);
    }

    return {
      allNavigableMachines: all,
      machineGroups: {
        byLine: Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b)),
        temp: tempMachines,
      },
    };
  }, [masterData.machines, enrichedRows]);

  // Current machine index for Prev / Next navigation
  const currentIndex = allNavigableMachines.findIndex((m) => m.id === machineId);
  const prevMachine =
    currentIndex > 0 ? allNavigableMachines[currentIndex - 1] : null;
  const nextMachine =
    currentIndex >= 0 && currentIndex < allNavigableMachines.length - 1
      ? allNavigableMachines[currentIndex + 1]
      : null;

  // 2. Compute Machine Analytics Data
  const analyticsData: MachineDetailAnalytics = useMemo(() => {
    return buildMachineDetailAnalytics({
      machineId,
      enrichedRows,
      masterData: {
        machines: masterData.machines || [],
        items: masterData.items || [],
        cycleTimes: masterData.cycleTimes || [],
      },
      shiftFilter: selectedShift,
    });
  }, [machineId, enrichedRows, masterData, selectedShift]);

  const {
    machineMeta,
    overallMetrics,
    configuredCapabilities,
    operationsPerformed,
    operatorBreakdown,
    dailySummary,
    shiftLogHistory,
  } = analyticsData;

  const { notifySuccess, notifyError } = useFeedback();

  const handleExportMachineExcel = () => {
    try {
      if (shiftLogHistory.length === 0 && configuredCapabilities.length === 0) {
        notifyError(
          "No Machine Data",
          `No configured capabilities or shift logs found for machine ${machineMeta.name}.`
        );
        return;
      }

      exportMachineDetailExcel({
        machineAnalytics: analyticsData,
        fromDate,
        toDate,
        shiftFilter: selectedShift,
      });

      notifySuccess(
        "Machine Export Complete",
        `Exported multi-sheet Excel workbook for ${machineMeta.name} (${fromDate} to ${toDate}).`
      );
    } catch (err) {
      console.error("Machine detail Excel export failed:", err);
      notifyError("Export Failed", `Failed to generate Excel for machine ${machineMeta.name}.`);
    }
  };

  // Available shifts for client-side filter pills
  const availableShifts = useMemo(() => {
    const set = new Set<string>();
    for (const r of enrichedRows) {
      if (r.machineId === machineId && r.shift) {
        set.add(r.shift);
      }
    }
    if (set.size === 0) {
      return ["Shift A", "Shift B", "Shift C"];
    }
    return Array.from(set).sort();
  }, [enrichedRows, machineId]);

  const handleApplyCustomDates = (e: React.FormEvent) => {
    e.preventDefault();
    if (customFrom && customTo) {
      onDateRangeChange(customFrom, customTo, "custom");
    }
  };

  return (
    <div className="w-full space-y-4">
      {/* ==================================================================== */}
      {/* 1. TOP HEADER & MACHINE SWITCHER BAR                                 */}
      {/* ==================================================================== */}
      <div className="bg-white p-3 sm:p-4 rounded-lg border border-slate-200 shadow-2xs flex flex-wrap items-center justify-between gap-3">
        {/* Left: Back Button & Machine Name */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackToAnalytics}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 hover:text-slate-950 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-md transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 text-slate-600" />
            <span>Back to Analytics</span>
          </button>

          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base sm:text-lg font-black text-slate-900 tracking-tight flex items-center gap-1.5">
              <Cpu className="w-5 h-5 text-blue-600" />
              <span>{machineMeta.name}</span>
            </h2>
            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
              {machineMeta.line}
            </span>
            {machineMeta.isTempMachine && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-amber-400 text-slate-950 uppercase tracking-wider">
                TEMP
              </span>
            )}
          </div>
        </div>

        {/* Right: Machine Switcher Dropdown with Prev / Next + Export */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            disabled={!prevMachine}
            onClick={() => prevMachine && onSelectMachine(prevMachine.id)}
            className="p-1.5 text-xs font-semibold rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
            title={prevMachine ? `Previous Machine: ${prevMachine.name}` : "No previous machine"}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <select
            value={machineId}
            onChange={(e) => onSelectMachine(e.target.value)}
            className="text-xs font-bold bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-900 focus:outline-none focus:border-slate-800 cursor-pointer max-w-[200px] truncate"
          >
            {machineGroups.byLine.map(([line, machines]) => (
              <optgroup key={line} label={line}>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </optgroup>
            ))}
            {machineGroups.temp.length > 0 && (
              <optgroup label="Temporary Machines">
                {machineGroups.temp.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} [TEMP]
                  </option>
                ))}
              </optgroup>
            )}
          </select>

          <button
            type="button"
            disabled={!nextMachine}
            onClick={() => nextMachine && onSelectMachine(nextMachine.id)}
            className="p-1.5 text-xs font-semibold rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
            title={nextMachine ? `Next Machine: ${nextMachine.name}` : "No next machine"}
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <button
            type="button"
            disabled={shiftLogHistory.length === 0 && configuredCapabilities.length === 0}
            onClick={handleExportMachineExcel}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors shadow-2xs cursor-pointer ml-1"
            title="Export machine drilldown multi-sheet Excel report"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Export Machine Excel</span>
          </button>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* 2. DATE RANGE & SHIFT FILTER STRIP                                    */}
      {/* ==================================================================== */}
      <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Quick Date Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 mr-1">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>Range:</span>
            </span>
            {[
              { key: "today", label: "Today" },
              { key: "yesterday", label: "Yesterday" },
              { key: "thisWeek", label: "This Week" },
              { key: "lastWeek", label: "Last Week" },
              { key: "thisMonth", label: "This Month" },
            ].map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => onDateRangeChange("", "", p.key)}
                className={`px-2.5 py-1 text-xs rounded font-semibold cursor-pointer transition-colors ${
                  activePreset === p.key
                    ? "bg-slate-900 text-white shadow-2xs"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Custom Date Form */}
          <form onSubmit={handleApplyCustomDates} className="flex items-center gap-1.5 flex-wrap">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="text-xs px-2 py-1 border border-slate-300 rounded font-mono bg-white focus:outline-none focus:border-slate-800"
            />
            <span className="text-xs text-slate-400">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="text-xs px-2 py-1 border border-slate-300 rounded font-mono bg-white focus:outline-none focus:border-slate-800"
            />
            <button
              type="submit"
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded text-xs font-bold cursor-pointer transition-colors"
            >
              Apply
            </button>
          </form>
        </div>

        {/* Shift Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 mr-1">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>Shift:</span>
          </span>
          <button
            type="button"
            onClick={() => setSelectedShift("ALL")}
            className={`px-2 py-0.5 text-xs rounded font-semibold cursor-pointer transition-colors ${
              selectedShift === "ALL"
                ? "bg-blue-600 text-white font-bold"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            All Shifts
          </button>
          {availableShifts.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSelectedShift(s)}
              className={`px-2 py-0.5 text-xs rounded font-semibold cursor-pointer transition-colors ${
                selectedShift === s
                  ? "bg-blue-600 text-white font-bold"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {s}
            </button>
          ))}
          {selectedShift !== "ALL" && (
            <button
              type="button"
              onClick={() => setSelectedShift("ALL")}
              className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer ml-1"
              title="Reset shift filter"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ==================================================================== */}
      {/* 3. OEE & PRODUCTION KPI STRIP (4 Cards)                              */}
      {/* ==================================================================== */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {/* HERO CARD: OEE % */}
        <div
          className={`p-3.5 rounded-lg border shadow-2xs flex flex-col justify-between col-span-2 md:col-span-1 ${getOeeColorClass(
            overallMetrics.oeePct
          )}`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider">Machine OEE</span>
            <span className="text-[9px] font-mono font-bold px-1 py-0.2 rounded bg-white/70 border border-current">
              Good Run Time / Planned Time
            </span>
          </div>
          <div className="my-1.5">
            <div className="text-3xl font-black tracking-tight">{overallMetrics.oeePct}%</div>
            <div className="text-[10px] font-medium opacity-85 mt-0.5">
              {overallMetrics.oeePct >= 85
                ? "World-Class Level"
                : overallMetrics.oeePct >= 65
                ? "Typical Level"
                : "Needs Improvement"}
            </div>
          </div>
          <div className="text-[10px] font-mono flex items-center justify-between pt-1.5 border-t border-current/20 opacity-90 gap-1 flex-wrap">
            <span>Oper: {overallMetrics.operatingMinutes}m</span>
            <span>Plan: {overallMetrics.plannedMinutes}m</span>
            {overallMetrics.totalOvertimeMinutes > 0 && (
              <span className="px-1 rounded bg-amber-100 text-amber-900 border border-amber-300 font-bold">
                +{overallMetrics.totalOvertimeMinutes}m OT
              </span>
            )}
          </div>
        </div>

        {/* Availability % */}
        <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs font-bold text-slate-700 mb-1">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3 text-blue-600" />
                <span>Availability</span>
              </span>
              <span className="font-mono text-slate-900 font-extrabold">{overallMetrics.availabilityPct}%</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden my-1.5">
              <div
                className="bg-blue-600 h-full rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, overallMetrics.availabilityPct)}%` }}
              />
            </div>
          </div>
          <div className="space-y-0.5 text-[11px] text-slate-600 pt-1 border-t border-slate-100 font-mono">
            <div className="flex justify-between">
              <span className="text-slate-500 font-sans">Operating:</span>
              <span className="font-bold text-slate-800">{overallMetrics.operatingMinutes} m</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 font-sans">Downtime:</span>
              <span className={`font-bold ${TOTAL_DOWNTIME_THEME.textClass}`}>{overallMetrics.downtimeMinutes} m</span>
            </div>
            {overallMetrics.totalOvertimeMinutes > 0 && (
              <div className="flex justify-between">
                <span className="text-amber-700 font-sans font-semibold">OT Logged:</span>
                <span className="font-bold text-amber-800">
                  {(overallMetrics.totalOvertimeMinutes / 60).toFixed(1)} hrs ({overallMetrics.totalOvertimeMinutes}m)
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Quality % */}
        <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs font-bold text-slate-700 mb-1">
              <span className="flex items-center gap-1">
                <Package className="w-3 h-3 text-emerald-600" />
                <span>Quality</span>
              </span>
              <span className="font-mono text-slate-900 font-extrabold">{overallMetrics.qualityPct}%</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden my-1.5">
              <div
                className="bg-emerald-600 h-full rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, overallMetrics.qualityPct)}%` }}
              />
            </div>
          </div>
          <div className="space-y-0.5 text-[11px] text-slate-600 pt-1 border-t border-slate-100 font-mono">
            <div className="flex justify-between">
              <span className="text-slate-500 font-sans">Good Pcs:</span>
              <span className="font-bold text-emerald-700">{overallMetrics.goodOutput.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 font-sans">Rework:</span>
              <span className="font-bold text-amber-600">{overallMetrics.totalRework.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Actual vs Std Output */}
        <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs font-bold text-slate-700 mb-1">
              <span>Output vs Std</span>
              <span className="font-mono text-slate-900 font-extrabold">
                {overallMetrics.planAchievementPct}%
              </span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden my-1.5">
              <div
                className="bg-slate-800 h-full rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, overallMetrics.planAchievementPct)}%` }}
              />
            </div>
          </div>
          <div className="space-y-0.5 text-[11px] text-slate-600 pt-1 border-t border-slate-100 font-mono">
            <div className="flex justify-between">
              <span className="text-slate-500 font-sans">Actual:</span>
              <span className="font-bold text-slate-900">{overallMetrics.totalActual.toLocaleString()} pcs</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 font-sans">Target:</span>
              <span className="font-bold text-slate-600">{overallMetrics.totalStd.toLocaleString()} pcs</span>
            </div>
          </div>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* 4. 7-CATEGORY DOWNTIME BREAKDOWN BAR                                 */}
      {/* ==================================================================== */}
      <div className="bg-white p-3.5 rounded-lg border border-slate-200 shadow-2xs space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-slate-900 flex items-center gap-1.5">
            <Wrench className={`w-3.5 h-3.5 ${TOTAL_DOWNTIME_THEME.textClass}`} />
            <span>Machine Downtime Breakdown (7 Categories)</span>
          </span>
          <span className="font-mono text-slate-600 font-bold">
            Total: <span className={TOTAL_DOWNTIME_THEME.textClass}>{overallMetrics.downtimeMinutes} mins</span>
          </span>
        </div>

        {overallMetrics.downtimeMinutes > 0 && (
          <div className="w-full h-3 rounded-full overflow-hidden flex bg-slate-100">
            {BD_KEYS.map((k) => {
              const val = overallMetrics.breakdownTotals[k];
              if (val <= 0) return null;
              return (
                <div
                  key={k}
                  style={{
                    width: `${(val / overallMetrics.downtimeMinutes) * 100}%`,
                  }}
                  className={`${DOWNTIME_PALETTE[k].barBgClass} h-full`}
                  title={`${DOWNTIME_PALETTE[k].shortLabel}: ${val}m`}
                />
              );
            })}
          </div>
        )}

        {/* Category Chips */}
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-1.5 pt-1">
          {BD_KEYS.map((k) => {
            const theme = DOWNTIME_PALETTE[k];
            const val = overallMetrics.breakdownTotals[k];
            const pct =
              overallMetrics.downtimeMinutes > 0
                ? Math.round((val / overallMetrics.downtimeMinutes) * 100)
                : 0;
            return (
              <div key={k} className={`p-1.5 rounded border text-center ${theme.chipClass}`}>
                <div className="text-[10px] font-bold uppercase truncate flex items-center justify-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${theme.dotBgClass}`} />
                  <span className="truncate">{theme.shortLabel}</span>
                </div>
                <div className="text-xs font-mono font-bold mt-0.5">{val} m</div>
                <div className="text-[10px] text-slate-500 font-mono">{pct}%</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ==================================================================== */}
      {/* 5. CAPABILITIES & OPERATORS TWO-COLUMN GRID                           */}
      {/* ==================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: What This Machine Can Process (Configured Capabilities) */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-2xs overflow-hidden flex flex-col">
          <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-blue-600" />
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                What This Machine Can Process ({configuredCapabilities.length})
              </h3>
            </div>
            <span className="text-[11px] text-slate-500">Master Data Cycle Times</span>
          </div>

          <div className="overflow-x-auto flex-1">
            {configuredCapabilities.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 italic">
                No standard cycle times configured for this machine yet. You can assign cycle times in Master Data Settings.
              </div>
            ) : (
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-100 text-slate-700 uppercase text-[10px] font-semibold border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2">Part / Component</th>
                    <th className="px-3 py-2">Operation</th>
                    <th className="px-3 py-2 text-right">Cycle Time</th>
                    <th className="px-3 py-2 text-center">Period Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {configuredCapabilities.map((cap, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-2">
                        <div className="font-bold text-slate-900">{cap.itemName}</div>
                        {cap.itemCode && (
                          <span className="text-[10px] font-mono text-slate-500">{cap.itemCode}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-600 font-medium">{cap.operation}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-slate-800">
                        {cap.cycleTime} min
                      </td>
                      <td className="px-3 py-2 text-center">
                        {cap.ranInPeriod ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            Active: {cap.periodActualOutput} pcs
                          </span>
                        ) : (
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
                            Configured
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right: Operators Who Operated This Machine */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-2xs overflow-hidden flex flex-col">
          <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <User className="w-4 h-4 text-purple-600" />
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Operators on This Machine ({operatorBreakdown.length})
              </h3>
            </div>
            <span className="text-[11px] text-slate-500">Selected Range</span>
          </div>

          <div className="overflow-x-auto flex-1">
            {operatorBreakdown.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 italic">
                No operator activity logged for this machine during the selected period.
              </div>
            ) : (
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-100 text-slate-700 uppercase text-[10px] font-semibold border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2">Operator</th>
                    <th className="px-3 py-2 text-center">Shifts</th>
                    <th className="px-3 py-2">Parts Run</th>
                    <th className="px-3 py-2 text-right">Actual / Std</th>
                    <th className="px-3 py-2 text-right">Rework</th>
                    <th className="px-3 py-2 text-right">BD Mins</th>
                    <th className="px-3 py-2 text-right font-black">OEE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {operatorBreakdown.map((op, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-2 font-sans font-bold text-slate-900 flex items-center gap-1">
                        <User className="w-3 h-3 text-slate-400" />
                        <span>{op.operatorName}</span>
                      </td>
                      <td className="px-3 py-2 text-center text-slate-700 font-bold">{op.shiftsCount}</td>
                      <td className="px-3 py-2 font-sans text-slate-600 max-w-[140px] truncate" title={op.itemsRun.join(", ")}>
                        {op.itemsRun.join(", ") || "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="font-bold text-slate-900">{op.actualOutput}</span>
                        <span className="text-slate-400 text-[10px]"> / {op.stdOutput}</span>
                      </td>
                      <td className="px-3 py-2 text-right text-amber-600">{op.rework}</td>
                      <td className={`px-3 py-2 text-right ${TOTAL_DOWNTIME_THEME.textClass}`}>{op.downtimeMinutes}m</td>
                      <td className="px-3 py-2 text-right">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-black border ${getOeeBadgeClass(
                            op.oeePct
                          )}`}
                        >
                          {op.oeePct}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* 6. OPERATIONS PERFORMED TABLE (Selected Date Range)                   */}
      {/* ==================================================================== */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-2xs overflow-hidden">
        <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Package className="w-4 h-4 text-emerald-600" />
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Operations Performed in Period ({operationsPerformed.length})
            </h3>
          </div>
          <span className="text-[11px] text-slate-500 font-mono">
            Total Actual Output: <strong className="text-slate-900">{overallMetrics.totalActual.toLocaleString()} pcs</strong>
          </span>
        </div>

        <div className="overflow-x-auto">
          {operationsPerformed.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500 italic">
              No operations logged for this machine during the selected period.
            </div>
          ) : (
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-900 text-slate-100 uppercase text-[10px] font-semibold">
                <tr>
                  <th className="px-3 py-2">Part / Component</th>
                  <th className="px-3 py-2">Operation</th>
                  <th className="px-3 py-2 text-center">Runs</th>
                  <th className="px-3 py-2 text-right">Avg CT</th>
                  <th className="px-3 py-2 text-right">Target (Std)</th>
                  <th className="px-3 py-2 text-right">Actual Output</th>
                  <th className="px-3 py-2 text-right">Rework</th>
                  <th className="px-3 py-2 text-right">Good Output</th>
                  <th className="px-3 py-2 text-right">Downtime</th>
                  <th className="px-3 py-2 text-right">Avail %</th>
                  <th className="px-3 py-2 text-right">Qual %</th>
                  <th className="px-3 py-2 text-right font-black">OEE %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {operationsPerformed.map((op, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-2 font-sans font-bold text-slate-900">
                      <div>{op.itemName}</div>
                      {op.itemCode && (
                        <span className="text-[10px] font-mono text-slate-500">{op.itemCode}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-sans text-slate-700 font-medium">{op.operation}</td>
                    <td className="px-3 py-2 text-center text-slate-600">{op.runsCount}</td>
                    <td className="px-3 py-2 text-right text-slate-800">{op.avgCycleTime}m</td>
                    <td className="px-3 py-2 text-right text-slate-600">{op.stdOutput}</td>
                    <td className="px-3 py-2 text-right font-bold text-slate-950">{op.actualOutput}</td>
                    <td className="px-3 py-2 text-right text-amber-600">{op.rework}</td>
                    <td className="px-3 py-2 text-right font-bold text-emerald-700">{op.goodOutput}</td>
                    <td className={`px-3 py-2 text-right ${TOTAL_DOWNTIME_THEME.textClass}`}>{op.downtimeMinutes}m</td>
                    <td className="px-3 py-2 text-right text-slate-700">{op.availabilityPct}%</td>
                    <td className="px-3 py-2 text-right text-slate-700">{op.qualityPct}%</td>
                    <td className="px-3 py-2 text-right font-black">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-black border ${getOeeBadgeClass(
                          op.oeePct
                        )}`}
                      >
                        {op.oeePct}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ==================================================================== */}
      {/* 7. OUTPUT HISTORY (Daily Breakdown | Shift Logs Toggle)               */}
      {/* ==================================================================== */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-2xs overflow-hidden">
        {/* Toggle Bar */}
        <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Output History:
            </span>
            <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setHistoryTab("daily")}
                className={`px-3 py-1 text-xs font-bold rounded cursor-pointer transition-colors ${
                  historyTab === "daily"
                    ? "bg-slate-900 text-white shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Daily Breakdown ({dailySummary.length})
              </button>
              <button
                type="button"
                onClick={() => setHistoryTab("shift")}
                className={`px-3 py-1 text-xs font-bold rounded cursor-pointer transition-colors ${
                  historyTab === "shift"
                    ? "bg-slate-900 text-white shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Shift-by-Shift Logs ({shiftLogHistory.length})
              </button>
            </div>
          </div>

          <span className="text-[11px] text-slate-500 font-mono">
            {historyTab === "daily"
              ? `${dailySummary.length} daily entries recorded`
              : `${shiftLogHistory.length} shift run logs`}
          </span>
        </div>

        {/* View 1: Daily Breakdown */}
        {historyTab === "daily" && (
          <div className="overflow-x-auto">
            {dailySummary.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 italic">
                No daily logs recorded for this machine in the selected period.
              </div>
            ) : (
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-900 text-slate-100 uppercase text-[10px] font-semibold">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Item & Operation</th>
                    <th className="px-3 py-2">Shifts</th>
                    <th className="px-3 py-2 text-right">Actual / Std</th>
                    <th className="px-3 py-2 text-right">Rework</th>
                    <th className="px-3 py-2 text-right">BD Mins</th>
                    <th className="px-3 py-2 text-right">Avail %</th>
                    <th className="px-3 py-2 text-right">Perf %</th>
                    <th className="px-3 py-2 text-right">Qual %</th>
                    <th className="px-3 py-2 text-right font-black">OEE %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {dailySummary.map((d, idx) => {
                    const isFirstRowOfDate = idx === 0 || d.date !== dailySummary[idx - 1].date;
                    const dateGroupClass = !isFirstRowOfDate
                      ? "border-t border-slate-100"
                      : idx > 0
                      ? "border-t-2 border-slate-300"
                      : "";

                    return (
                      <tr
                        key={d.rowKey}
                        className={`hover:bg-slate-50 transition-colors ${dateGroupClass}`}
                      >
                        {/* 1. Date */}
                        <td className="px-3 py-2 whitespace-nowrap">
                          {isFirstRowOfDate ? (
                            <span className="font-bold text-slate-900">{d.date}</span>
                          ) : (
                            <span className="text-slate-400 font-medium pl-2">{d.date}</span>
                          )}
                        </td>

                        {/* 2. Item & Operation */}
                        <td className="px-3 py-2 font-sans">
                          {d.isDowntimeOnly ? (
                            <span className="italic text-amber-700 font-medium text-[11px]">
                              No Item / Downtime Only
                            </span>
                          ) : (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-slate-900">{d.itemName}</span>
                              {d.itemCode && (
                                <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 text-[10px] font-mono">
                                  {d.itemCode}
                                </span>
                              )}
                              {d.operation && d.operation !== "—" && (
                                <span className="px-1.5 py-0.2 rounded bg-blue-50 text-blue-700 text-[10px] font-semibold border border-blue-200">
                                  {d.operation}
                                </span>
                              )}
                            </div>
                          )}
                        </td>

                        {/* 3. Shifts */}
                        <td className="px-3 py-2 font-sans">
                          <div className="flex items-center gap-1 flex-wrap">
                            {d.shiftsRun.map((s) => {
                              const shortShift = s.replace(/Shift\s+/i, "").split(" ")[0];
                              return (
                                <span
                                  key={s}
                                  className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 text-[10px] font-bold border border-slate-200"
                                  title={s}
                                >
                                  {shortShift}
                                </span>
                              );
                            })}
                            {d.runsCount > d.shiftsRun.length && (
                              <span
                                className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 text-[10px] font-bold"
                                title={`${d.runsCount} split runs`}
                              >
                                {d.runsCount} runs
                              </span>
                            )}
                            {d.overtimeMinutes > 0 && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-mono font-bold">
                                +{d.overtimeMinutes}m OT
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 4. Actual / Std (with Plan %) */}
                        <td className="px-3 py-2 text-right">
                          <div className="font-bold text-slate-950">
                            {d.actualOutput.toLocaleString()}{" "}
                            <span className="text-slate-400 font-normal text-[10px]">
                              / {d.stdOutput.toLocaleString()}
                            </span>
                          </div>
                          {!d.isDowntimeOnly && d.stdOutput > 0 && (
                            <div
                              className={`text-[10px] font-semibold ${
                                d.planAchievementPct >= 100
                                  ? "text-emerald-700"
                                  : d.planAchievementPct >= 80
                                  ? "text-amber-700"
                                  : "text-rose-600"
                              }`}
                            >
                              {d.planAchievementPct}% plan
                            </div>
                          )}
                        </td>

                        {/* 5. Rework */}
                        <td className="px-3 py-2 text-right">
                          {d.rework > 0 ? (
                            <span className="text-amber-600 font-bold">{d.rework.toLocaleString()}</span>
                          ) : (
                            <span className="text-slate-400">0</span>
                          )}
                        </td>

                        {/* 6. BD Mins */}
                        <td className="px-3 py-2 text-right">
                          {d.downtimeMinutes > 0 ? (
                            <span className={`font-bold ${TOTAL_DOWNTIME_THEME.textClass}`}>{d.downtimeMinutes}m</span>
                          ) : (
                            <span className="text-slate-400">0m</span>
                          )}
                        </td>

                        {/* 7. Avail % */}
                        <td className="px-3 py-2 text-right text-slate-700">
                          {d.availabilityPct}%
                        </td>

                        {/* 8. Qual % */}
                        <td className="px-3 py-2 text-right text-slate-700">
                          {d.isDowntimeOnly ? "—" : `${d.qualityPct}%`}
                        </td>

                        {/* 10. OEE % */}
                        <td className="px-3 py-2 text-right font-black">
                          {d.isDowntimeOnly ? (
                            <span className="text-slate-400 text-xs">—</span>
                          ) : (
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-black border ${getOeeBadgeClass(
                                d.oeePct
                              )}`}
                            >
                              {d.oeePct}%
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* View 2: Shift-by-Shift Logs */}
        {historyTab === "shift" && (
          <div className="overflow-x-auto">
            {shiftLogHistory.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 italic">
                No shift logs recorded for this machine in the selected period.
              </div>
            ) : (
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-900 text-slate-100 uppercase text-[10px] font-semibold">
                  <tr>
                    <th className="px-3 py-2">Date & Shift</th>
                    <th className="px-3 py-2 text-center">Run</th>
                    <th className="px-3 py-2">Operator</th>
                    <th className="px-3 py-2">Item & Op</th>
                    <th className="px-3 py-2 text-right">OT (m)</th>
                    <th className="px-3 py-2 text-right">Target</th>
                    <th className="px-3 py-2 text-right">Actual</th>
                    <th className="px-3 py-2 text-right">Rework</th>
                    <th className="px-3 py-2 text-right">Downtime</th>
                    <th className="px-3 py-2 text-right font-black">OEE %</th>
                    <th className="px-3 py-2">Remarks</th>
                    <th className="px-3 py-2 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {shiftLogHistory.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-2 font-bold text-slate-900 whitespace-nowrap">
                        <div>{row.date}</div>
                        <span className="text-[10px] text-slate-500 font-sans">{row.shift}</span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 text-[10px] font-bold">
                          #{row.runNo}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-sans text-slate-700">{row.operatorName}</td>
                      <td className="px-3 py-2 font-sans">
                        <div className="font-bold text-slate-900">{row.itemName}</div>
                        <div className="text-[10px] text-slate-500">{row.operation} ({row.cycleTime}m)</div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {row.overtimeMinutes > 0 ? (
                          <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold">
                            +{row.overtimeMinutes}m
                          </span>
                        ) : (
                          <span className="text-slate-400">0</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">{row.stdOutput}</td>
                      <td className="px-3 py-2 text-right font-bold text-slate-950">{row.actualOutput}</td>
                      <td className="px-3 py-2 text-right text-amber-600">{row.rework}</td>
                      <td className={`px-3 py-2 text-right ${TOTAL_DOWNTIME_THEME.textClass}`}>{row.totalBdMinutes}m</td>
                      <td className="px-3 py-2 text-right">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-black border ${getOeeBadgeClass(
                            row.oeePct
                          )}`}
                        >
                          {row.oeePct}%
                        </span>
                      </td>
                      <td className="px-3 py-2 font-sans text-[11px] text-slate-500 max-w-[160px] truncate" title={row.remarks}>
                        {row.remarks || "—"}
                      </td>
                      <td className="px-3 py-2 text-center font-sans">
                        {onOpenShiftEntry && (
                          <button
                            type="button"
                            onClick={() =>
                              onOpenShiftEntry({
                                machineId: machineId,
                                date: row.date,
                                shift: row.shift as ShiftType,
                                line: row.line,
                                fromTab: "analytics",
                              })
                            }
                            className="inline-flex items-center gap-0.5 px-2 py-1 text-[11px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded cursor-pointer transition-colors"
                            title="Edit this shift entry in Operator Kiosk"
                          >
                            <span>Edit</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
