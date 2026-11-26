"use client";
import React, { useMemo } from "react";
import { ExternalLink, Package, Clock } from "lucide-react";
import { ShiftItemProductionRow } from "@/types";
import { calculateTotalBreakdown } from "@/services/storageService";
import {
  EnrichedAnalyticsRow,
  OeeMetrics,
  calculateOeeMetrics,
  resolveProductQcMetrics,
} from "@/services/analyticsEngine";
import {
  BD_KEYS,
  DOWNTIME_PALETTE,
  TOTAL_DOWNTIME_THEME,
} from "@/services/downtimePalette";

export interface ShiftSheetReadOnlyContentProps {
  rows: EnrichedAnalyticsRow[];
  itemProdRows: ShiftItemProductionRow[];
  groupByShift?: boolean;
  onSelectMachine: (machineId: string, machineName: string, line: string) => void;
  emptyMessage?: string;
  shiftWorkingMinutesOverride?: number;
}

function getOeeBadgeClass(oee: number): string {
  if (oee >= 85) return "bg-emerald-100 text-emerald-800 border-emerald-300";
  if (oee >= 65) return "bg-amber-100 text-amber-800 border-amber-300";
  return "bg-rose-100 text-rose-800 border-rose-300";
}

function getShiftSortRank(shift: string): number {
  const s = (shift || "").trim().toLowerCase();
  if (/^shift\s*a\b/.test(s)) return 1;
  if (/^shift\s*b\b/.test(s)) return 2;
  if (/^shift\s*c\b/.test(s)) return 3;
  return 4;
}

function compareShiftsCanonically(a: string, b: string): number {
  const rA = getShiftSortRank(a);
  const rB = getShiftSortRank(b);
  if (rA !== rB) return rA - rB;
  return a.localeCompare(b);
}

function getDefaultWorkingMinutes(shift: string): number {
  const s = (shift || "").toLowerCase();
  if (s.includes("shift c")) return 375;
  return 465;
}

function sortSheetRows(list: EnrichedAnalyticsRow[]): EnrichedAnalyticsRow[] {
  return [...list].sort((a, b) => {
    const srDiff = (Number(a.srNo) || 0) - (Number(b.srNo) || 0);
    if (srDiff !== 0) return srDiff;
    const nameCmp = (a.machineName || "").localeCompare(b.machineName || "");
    if (nameCmp !== 0) return nameCmp;
    return (Number(a.runNo) || 1) - (Number(b.runNo) || 1);
  });
}

function computeUniqueShiftMinutes(rows: EnrichedAnalyticsRow[], fallback?: number): number {
  if (rows.length === 0) return fallback || 0;
  const seenShiftKeys = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.date || ""}__${(r.shift || "").toLowerCase()}`;
    const mins =
      Number(r.shiftWorkingMinutes ?? r.totalWorkingMinutes) ||
      getDefaultWorkingMinutes(r.shift || "");
    if (!seenShiftKeys.has(k) || mins > (seenShiftKeys.get(k) || 0)) {
      seenShiftKeys.set(k, mins);
    }
  }
  let total = 0;
  for (const m of seenShiftKeys.values()) total += m;
  return total;
}

export const ShiftSheetReadOnlyContent: React.FC<ShiftSheetReadOnlyContentProps> = ({
  rows,
  itemProdRows,
  groupByShift = false,
  onSelectMachine,
  emptyMessage,
  shiftWorkingMinutesOverride,
}) => {
  const sortedRows = useMemo(() => sortSheetRows(rows), [rows]);
  const totalsMetrics = useMemo(() => calculateOeeMetrics(sortedRows), [sortedRows]);

  const distinctLinesCount = useMemo(() => {
    const set = new Set<string>();
    for (const r of sortedRows) {
      if (r.line) set.add(r.line);
    }
    return set.size;
  }, [sortedRows]);

  const uniqueMachinesCount = useMemo(() => {
    const set = new Set<string>();
    for (const r of sortedRows) {
      set.add(r.machineId || r.machineName || "unknown");
    }
    return set.size;
  }, [sortedRows]);

  const workingMinutes = useMemo(
    () => computeUniqueShiftMinutes(sortedRows, shiftWorkingMinutesOverride),
    [sortedRows, shiftWorkingMinutesOverride]
  );

  const totalPreQc = useMemo(
    () => itemProdRows.reduce((s, p) => s + (Number(p.totalProduction) || 0), 0),
    [itemProdRows]
  );

  const totalBdPct = useMemo(() => {
    if (totalsMetrics.plannedMinutes <= 0) return 0;
    return Number(
      ((totalsMetrics.downtimeMinutes / totalsMetrics.plannedMinutes) * 100).toFixed(1)
    );
  }, [totalsMetrics]);

  // Group into Shift A -> Shift B -> Shift C when groupByShift === true
  const shiftSections = useMemo(() => {
    if (!groupByShift) return [];
    const map = new Map<string, EnrichedAnalyticsRow[]>();
    for (const r of sortedRows) {
      const sh = r.shift || "Unknown Shift";
      const list = map.get(sh) || [];
      list.push(r);
      map.set(sh, list);
    }
    const orderedShifts = Array.from(map.keys()).sort(compareShiftsCanonically);
    return orderedShifts.map((shiftName) => {
      const sRows = sortSheetRows(map.get(shiftName) || []);
      const sMetrics = calculateOeeMetrics(sRows);
      const sBdPct =
        sMetrics.plannedMinutes > 0
          ? Number(((sMetrics.downtimeMinutes / sMetrics.plannedMinutes) * 100).toFixed(1))
          : 0;
      const sWorkingMins = computeUniqueShiftMinutes(sRows, getDefaultWorkingMinutes(shiftName));
      const sLines = Array.from(new Set(sRows.map((r) => r.line).filter(Boolean))).sort();
      return {
        shift: shiftName,
        rows: sRows,
        metrics: sMetrics,
        bdPct: sBdPct,
        workingMinutes: sWorkingMins,
        lines: sLines,
      };
    });
  }, [groupByShift, sortedRows]);

  const sortedProdRows = useMemo(() => {
    return [...itemProdRows].sort((a, b) => {
      if (groupByShift) {
        const sCmp = compareShiftsCanonically(a.shift || "", b.shift || "");
        if (sCmp !== 0) return sCmp;
      }
      const lCmp = (a.line || "").localeCompare(b.line || "");
      if (lCmp !== 0) return lCmp;
      return (a.itemName || a.itemCode || "").localeCompare(b.itemName || b.itemCode || "");
    });
  }, [itemProdRows, groupByShift]);

  const renderMachineRow = (row: EnrichedAnalyticsRow, idx: number) => {
    const bd = row.breakdown || {
      noDisc: 0,
      change: 0,
      power: 0,
      operator: 0,
      machineBreakdown: 0,
      fixProgSettings: 0,
      miscellaneous: 0,
    };
    const totalBd = Number(row.totalBreakdownMinutes) || calculateTotalBreakdown(bd);
    const bdPct =
      row.allocatedPlannedMinutes > 0
        ? ((totalBd / row.allocatedPlannedMinutes) * 100).toFixed(1)
        : "0.0";
    const rowMetrics = calculateOeeMetrics([row]);
    const accountedMins = Math.round((row.idealRunMinutes || 0) + totalBd);
    const plannedMins = Math.round(row.allocatedPlannedMinutes || 0);

    return (
      <tr
        key={row.id || `${row.shift}_${row.line}_${row.machineId}_${row.runNo || 1}_${idx}`}
        className="hover:bg-slate-50 transition-colors"
      >
        <td className="px-2 py-1.5 border-r border-slate-200 text-center font-mono text-slate-500">
          {row.srNo || idx + 1}
        </td>
        <td className="px-2.5 py-1.5 border-r border-slate-200 font-sans">
          <div className="flex items-center gap-1 flex-wrap">
            {row.machineId ? (
              <button
                type="button"
                onClick={() =>
                  onSelectMachine(
                    row.machineId,
                    row.machineName || row.machineId,
                    row.line || ""
                  )
                }
                className="font-bold text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center gap-1 cursor-pointer text-left"
                title="Open Machine Analytics Drilldown"
              >
                <span>{row.machineName}</span>
                <ExternalLink className="w-2.5 h-2.5 opacity-60 shrink-0" />
              </button>
            ) : (
              <span className="font-bold text-slate-900">{row.machineName}</span>
            )}
            {distinctLinesCount > 1 && row.line && (
              <span className="px-1 rounded bg-slate-100 border border-slate-200 text-slate-600 text-[9px] font-semibold">
                {row.line}
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
          {(row.operatorName || "").trim() || <span className="text-slate-400">—</span>}
        </td>
        <td className="px-2 py-1.5 border-r border-slate-200 font-semibold text-slate-800">
          {row.itemName || row.itemId || <span className="text-slate-400 font-normal">—</span>}
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
        {BD_KEYS.map((bdKey) => {
          const num = Number(bd?.[bdKey]) || 0;
          return (
            <td
              key={bdKey}
              className={`px-1.5 py-1.5 border-r border-slate-200 text-right font-mono tabular-nums ${
                num > 0 ? DOWNTIME_PALETTE[bdKey].readonlyCellClass : "text-slate-300"
              }`}
            >
              {num > 0 ? num : "0"}
            </td>
          );
        })}
        <td
          className={`px-2 py-1.5 border-r border-slate-200 text-right font-mono tabular-nums font-bold ${
            totalBd > 0 ? TOTAL_DOWNTIME_THEME.cellClass : "text-slate-400"
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
        <td
          className="px-2 py-1.5 text-slate-600 max-w-48 truncate"
          title={row.remarks || ""}
        >
          {(row.remarks || "").trim() || <span className="text-slate-300">—</span>}
        </td>
      </tr>
    );
  };

  const renderTotalsRow = (
    label: string,
    metrics: OeeMetrics,
    bdPct: number,
    variant: "subtotal" | "footer",
    key?: string
  ) => {
    const isFooter = variant === "footer";
    return (
      <tr
        key={key}
        className={
          isFooter
            ? "bg-slate-100 border-t-2 border-slate-300 font-bold text-slate-900"
            : "bg-slate-100/80 border-t border-b-2 border-slate-300 font-bold text-slate-800"
        }
      >
        <td
          colSpan={6}
          className="px-2.5 py-2 border-r border-slate-300 uppercase text-[10px] tracking-wider"
        >
          {label}
        </td>
        <td className="px-2 py-2 border-r border-slate-300 text-right font-mono tabular-nums">
          {metrics.totalStd.toLocaleString()}
        </td>
        <td className="px-2 py-2 border-r border-slate-300 text-right font-mono tabular-nums bg-sky-100/70 text-slate-900">
          {metrics.totalActual.toLocaleString()}
        </td>
        <td className="px-2 py-2 border-r border-slate-300 text-right font-mono tabular-nums text-rose-700">
          {metrics.totalRework.toLocaleString()}
        </td>
        {BD_KEYS.map((bdKey) => {
          const val = metrics.breakdownTotals[bdKey];
          return (
            <td
              key={bdKey}
              className={`px-1.5 py-2 border-r border-slate-300 text-right font-mono tabular-nums ${
                val > 0 ? DOWNTIME_PALETTE[bdKey].readonlyCellClass : "text-slate-400"
              }`}
            >
              {val}
            </td>
          );
        })}
        <td
          className={`px-2 py-2 border-r border-slate-300 text-right font-mono tabular-nums ${TOTAL_DOWNTIME_THEME.subtotalCellClass}`}
        >
          {metrics.downtimeMinutes}m
        </td>
        <td className="px-2 py-2 border-r border-slate-300 text-right font-mono tabular-nums">
          {bdPct}%
        </td>
        <td className="px-2 py-2 border-r border-slate-300 text-right font-mono tabular-nums">
          <span
            className={`px-1.5 py-0.5 rounded text-[11px] font-black border ${getOeeBadgeClass(
              metrics.oeePct
            )}`}
          >
            {metrics.oeePct}%
          </span>
        </td>
        <td className="px-2 py-2 text-[10px] text-slate-500 font-normal">
          Plan: {metrics.planAchievementPct}% · Avail: {metrics.availabilityPct}%
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-3">
      {/* Compact KPI Strip Above Table */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <div className="bg-white border border-slate-200 rounded-md px-3 py-2 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
            Working Mins
          </span>
          <span className="text-sm font-mono font-extrabold text-slate-900">
            {workingMinutes > 0 ? `${workingMinutes.toLocaleString()}m` : "—"}
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-md px-3 py-2 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
            Machines / Runs
          </span>
          <span className="text-sm font-mono font-extrabold text-slate-900">
            {uniqueMachinesCount} M/c{" "}
            <span className="text-xs font-normal text-slate-500">
              · {sortedRows.length} Runs
            </span>
          </span>
        </div>

        <div className="bg-emerald-50/70 border border-emerald-200 rounded-md px-3 py-2 shadow-2xs">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
              Total Prod (Pre-QC)
            </span>
            <span className="text-[9px] font-bold bg-emerald-100 text-emerald-800 px-1 rounded">
              100% QC
            </span>
          </div>
          <span className="text-sm font-mono font-black text-emerald-900">
            {totalPreQc.toLocaleString()} pcs
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-md px-3 py-2 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
            Machine Ops (Act / Std)
          </span>
          <span className="text-sm font-mono font-extrabold text-slate-900">
            {totalsMetrics.totalActual.toLocaleString()}{" "}
            <span className="text-xs font-normal text-slate-400">
              / {totalsMetrics.totalStd.toLocaleString()}
            </span>
          </span>
        </div>

        <div className={`border rounded-md px-3 py-2 shadow-2xs ${TOTAL_DOWNTIME_THEME.kpiBgClass}`}>
          <span className={`text-[10px] font-bold uppercase tracking-wider block ${TOTAL_DOWNTIME_THEME.textClass}`}>
            Total BD (m)
          </span>
          <span className={`text-sm font-mono font-extrabold ${TOTAL_DOWNTIME_THEME.textClass}`}>
            {totalsMetrics.downtimeMinutes}m{" "}
            <span className="text-xs font-normal text-slate-600">({totalBdPct}%)</span>
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-md px-3 py-2 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
            Machine OEE %
          </span>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span
              className={`px-2 py-0.5 rounded text-xs font-black border ${getOeeBadgeClass(
                totalsMetrics.oeePct
              )}`}
            >
              {totalsMetrics.oeePct}%
            </span>
            <span className="text-[10px] text-slate-500 font-mono">
              A:{totalsMetrics.availabilityPct}% Q:{totalsMetrics.qualityPct}%
            </span>
          </div>
        </div>
      </div>

      {/* Main Shift Table (Scrollable with sticky column headers & footer) */}
      <div className="bg-white rounded-lg border border-slate-300 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto overflow-y-auto max-h-[65vh] min-h-[260px]">
          <table className="w-full text-[11px] text-left border-collapse">
            <thead className="sticky top-0 z-20 shadow-xs">
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
                  className={`px-2 py-1 border-r border-slate-800 text-center bg-slate-800 font-bold ${TOTAL_DOWNTIME_THEME.textDarkClass}`}
                >
                  Breakdown (Minutes)
                </th>
                <th
                  rowSpan={2}
                  className={`px-2 py-2 border-r border-slate-800 text-right bg-slate-800 ${TOTAL_DOWNTIME_THEME.textDarkClass}`}
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
                {BD_KEYS.map((bdKey, idx) => (
                  <th
                    key={bdKey}
                    className={`px-1.5 py-1 border-r ${
                      idx === BD_KEYS.length - 1 ? "border-slate-800" : "border-slate-700"
                    } ${DOWNTIME_PALETTE[bdKey].darkHeaderTextClass}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${DOWNTIME_PALETTE[bdKey].dotBgClass}`} />
                      {DOWNTIME_PALETTE[bdKey].shortLabel}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={20} className="px-4 py-8 text-center text-slate-500 italic">
                    {emptyMessage || "No machine log rows recorded for this selection."}
                  </td>
                </tr>
              ) : groupByShift ? (
                shiftSections.map((sec) => (
                  <React.Fragment key={sec.shift}>
                    <tr className="bg-sky-50/90 border-t-2 border-slate-300">
                      <td colSpan={20} className="px-3 py-2 font-sans">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Clock className="w-3.5 h-3.5 text-blue-700" />
                            <span className="font-extrabold text-slate-900 text-xs">
                              {sec.shift}
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[10px] font-mono font-bold text-slate-700">
                              {sec.workingMinutes}m Shift
                            </span>
                            {sec.lines.length > 0 && (
                              <span className="text-[10px] font-semibold text-slate-500">
                                ({sec.lines.join(", ")})
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] font-mono text-slate-600">
                            {sec.rows.length} machine runs · OEE {sec.metrics.oeePct}%
                          </span>
                        </div>
                      </td>
                    </tr>
                    {sec.rows.map((row, idx) => renderMachineRow(row, idx))}
                    {renderTotalsRow(
                      `${sec.shift} Subtotal (${sec.rows.length} rows)`,
                      sec.metrics,
                      sec.bdPct,
                      "subtotal",
                      `${sec.shift}__subtotal`
                    )}
                  </React.Fragment>
                ))
              ) : (
                sortedRows.map((row, idx) => renderMachineRow(row, idx))
              )}
            </tbody>
            {sortedRows.length > 0 && (
              <tfoot className="sticky bottom-0 z-10 shadow-[0_-2px_6px_rgba(0,0,0,0.12)]">
                {renderTotalsRow(
                  groupByShift
                    ? `Day Total (${sortedRows.length} rows)`
                    : `Shift Totals (${sortedRows.length} rows)`,
                  totalsMetrics,
                  totalBdPct,
                  "footer"
                )}
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
            <span className="text-xs font-bold">Shift Finished Production (Pre-QC)</span>
            <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-900/80 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded">
              Pre-QC · 100% QC Assumed
            </span>
          </div>
          <span className="text-xs font-mono font-bold text-emerald-300">
            Total: {totalPreQc.toLocaleString()} pcs
          </span>
        </div>

        {sortedProdRows.length === 0 ? (
          <div className="p-4 text-center text-xs text-slate-500 italic">
            No Pre-QC shift production logged for this selection.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-100 text-slate-700 uppercase text-[10px] font-bold border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  {groupByShift && <th className="px-3 py-2">Shift</th>}
                  <th className="px-3 py-2 text-right">Total Production (Pre-QC)</th>
                  <th className="px-3 py-2 text-right">QC Passed (100% Assumed)</th>
                  <th className="px-3 py-2">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {sortedProdRows.map((p, idx) => {
                  const qc = resolveProductQcMetrics(Number(p.totalProduction) || 0, true);
                  return (
                    <tr key={p.id || `${p.shift}_${p.line}_${p.itemKey}_${idx}`} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-sans">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {p.itemCode && (
                            <span className="font-mono font-bold text-slate-600 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded text-[10px]">
                              {p.itemCode}
                            </span>
                          )}
                          <span className="font-bold text-slate-900">
                            {p.itemName || p.itemCode || p.itemKey}
                          </span>
                          {p.line && (
                            <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded">
                              {p.line}
                            </span>
                          )}
                        </div>
                      </td>
                      {groupByShift && (
                        <td className="px-3 py-2 font-sans text-slate-700 whitespace-nowrap">
                          {p.shift}
                        </td>
                      )}
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
              <tfoot>
                <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold text-slate-900">
                  <td colSpan={groupByShift ? 2 : 1} className="px-3 py-2 uppercase text-[10px] tracking-wider">
                    Pre-QC Totals ({sortedProdRows.length} entries)
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-emerald-900 bg-emerald-100/60">
                    {totalPreQc.toLocaleString()} pcs
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-emerald-800">
                    {totalPreQc.toLocaleString()} pcs
                  </td>
                  <td className="px-3 py-2" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
