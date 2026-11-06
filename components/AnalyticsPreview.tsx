"use client";
import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart3,
  TrendingUp,
  AlertOctagon,
  Clock,
  Download,
  FileSpreadsheet,
  Filter,
  CheckCircle,
  HelpCircle,
  ChevronRight,
  Search,
} from 'lucide-react';
import { MachineMaster, MachineShiftRow, MasterDataState, ShiftType } from '@/types';
import { INITIAL_MACHINES } from '@/data/initialData';
import { calculateEfficiency, calculateTotalBreakdown } from '@/services/storageService';
import { exportHistoricalToCSV, exportShiftToExcel } from '@/services/excelExport';
import { getAnalyticsLogs } from '@/actions/shiftActions';

interface AnalyticsPreviewProps {
  rows: MachineShiftRow[];
  selectedDate: string;
  selectedShift: ShiftType;
  selectedLine: string;
  masterData?: MasterDataState;
}

export const AnalyticsPreview: React.FC<AnalyticsPreviewProps> = ({
  rows,
  selectedDate,
  selectedShift,
  selectedLine,
  masterData,
}) => {
  // Use live machines from masterData if passed, otherwise fallback to INITIAL_MACHINES
  const machines: MachineMaster[] = masterData?.machines ?? INITIAL_MACHINES;

  // Start with current shift rows, then merge 30-day history from Supabase on mount
  const [historicalLogs, setHistoricalLogs] = useState<MachineShiftRow[]>([]);

  useEffect(() => {
    let isMounted = true;
    getAnalyticsLogs(30)
      .then((data) => {
        if (isMounted && data) {
          setHistoricalLogs(data);
        }
      })
      .catch((err) => console.error('Failed to load analytics history:', err));

    return () => {
      isMounted = false;
    };
  }, []);

  // Merge current shift rows with historical logs (deduplicated by row.id)
  const allLogs = useMemo(() => {
    const logMap = new Map<string, MachineShiftRow>();
    historicalLogs.forEach((log) => logMap.set(log.id, log));
    rows.forEach((row) => logMap.set(row.id, row)); // Latest current shift rows win
    return Array.from(logMap.values());
  }, [historicalLogs, rows]);

  // Filters
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'yesterday' | 'week' | 'selected'>('all');
  const [shiftFilter, setShiftFilter] = useState<string>('all');
  const [lineFilter, setLineFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [hoveredMachineId, setHoveredMachineId] = useState<string | null>(null);

  // Sync internal filters with Header props when they change
  useEffect(() => {
    if (selectedLine) {
      setLineFilter(selectedLine);
    }
  }, [selectedLine]);

  useEffect(() => {
    if (selectedShift) {
      const parts = selectedShift.split(' ');
      const shiftPrefix = parts.length >= 2 ? `${parts[0]} ${parts[1]}` : parts[0];
      setShiftFilter(shiftPrefix || 'all');
    }
  }, [selectedShift]);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = yesterdayDate.toISOString().slice(0, 10);

    if (selectedDate === today) {
      setDateFilter('today');
    } else if (selectedDate === yesterday) {
      setDateFilter('yesterday');
    } else if (selectedDate) {
      setDateFilter('selected');
    }
  }, [selectedDate]);

  // Compute filtered logs
  const filteredLogs = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = yesterdayDate.toISOString().slice(0, 10);

    const weekAgoDate = new Date();
    weekAgoDate.setDate(weekAgoDate.getDate() - 7);
    const weekAgo = weekAgoDate.toISOString().slice(0, 10);

    return allLogs.filter((log) => {
      // Date filter
      if (dateFilter === 'selected' && log.date !== selectedDate) return false;
      if (dateFilter === 'today' && log.date !== today) return false;
      if (dateFilter === 'yesterday' && log.date !== yesterday) return false;
      if (dateFilter === 'week' && log.date < weekAgo) return false;

      // Shift filter
      if (shiftFilter !== 'all' && !log.shift.startsWith(shiftFilter)) return false;

      // Line filter
      if (lineFilter !== 'all' && (log.line || 'Line 1') !== lineFilter) return false;

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matches =
          log.machineName.toLowerCase().includes(q) ||
          log.operatorName.toLowerCase().includes(q) ||
          log.itemName.toLowerCase().includes(q) ||
          (log.line && log.line.toLowerCase().includes(q)) ||
          log.remarks.toLowerCase().includes(q);
        if (!matches) return false;
      }

      return true;
    });
  }, [allLogs, dateFilter, selectedDate, shiftFilter, lineFilter, searchQuery]);

  // Aggregate KPIs
  const kpis = useMemo(() => {
    // Only calculate for logs that were actually scheduled (stdOutput > 0)
    const activeLogs = filteredLogs.filter((r) => Number(r.stdOutput) > 0);

    const totalStd = activeLogs.reduce((acc, r) => acc + (Number(r.stdOutput) || 0), 0);
    const totalAct = activeLogs.reduce((acc, r) => acc + (Number(r.actualOutput) || 0), 0);
    const totalRework = activeLogs.reduce((acc, r) => acc + (Number(r.rework) || 0), 0);

    const totalNoDisc = activeLogs.reduce((acc, r) => acc + (Number(r.breakdown.noDisc) || 0), 0);
    const totalChange = activeLogs.reduce((acc, r) => acc + (Number(r.breakdown.change) || 0), 0);
    const totalPower = activeLogs.reduce((acc, r) => acc + (Number(r.breakdown.power) || 0), 0);
    const totalOperator = activeLogs.reduce((acc, r) => acc + (Number(r.breakdown.operator) || 0), 0);
    const totalBreakdown = totalNoDisc + totalChange + totalPower + totalOperator;

    const plantEfficiency = totalStd > 0 ? Math.round((totalAct / totalStd) * 100) : 0;
    const reworkRate = totalAct > 0 ? ((totalRework / totalAct) * 100).toFixed(1) : '0.0';

    const totalWorkingMins =
      activeLogs.reduce(
        (acc, r) => acc + (Number(r.totalWorkingMinutes) || 1350),
        0
      ) || (activeLogs.length * 1350 || 1350);

    const totalBdPctOfWorking =
      totalWorkingMins > 0
        ? ((totalBreakdown / totalWorkingMins) * 100).toFixed(1)
        : '0.0';

    const noDiscPctOfWorking =
      totalWorkingMins > 0
        ? ((totalNoDisc / totalWorkingMins) * 100).toFixed(1)
        : '0.0';

    const changePctOfWorking =
      totalWorkingMins > 0
        ? ((totalChange / totalWorkingMins) * 100).toFixed(1)
        : '0.0';

    const powerPctOfWorking =
      totalWorkingMins > 0
        ? ((totalPower / totalWorkingMins) * 100).toFixed(1)
        : '0.0';

    const operatorPctOfWorking =
      totalWorkingMins > 0
        ? ((totalOperator / totalWorkingMins) * 100).toFixed(1)
        : '0.0';

    return {
      totalStd,
      totalAct,
      variance: totalAct - totalStd,
      plantEfficiency,
      totalRework,
      reworkRate,
      totalBreakdown,
      totalWorkingMins,
      totalBdPctOfWorking,
      breakdownSplit: {
        noDisc: totalNoDisc,
        change: totalChange,
        power: totalPower,
        operator: totalOperator,
      },
      categoryWorkingPct: {
        noDisc: noDiscPctOfWorking,
        change: changePctOfWorking,
        power: powerPctOfWorking,
        operator: operatorPctOfWorking,
      },
      logCount: activeLogs.length,
    };
  }, [filteredLogs]);

  // Machine-wise metrics for the machines
  const machineMetrics = useMemo(() => {
    const relevantMachines =
      lineFilter === 'all' ? machines : machines.filter((m) => (m.line || 'Line 1') === lineFilter);

    return relevantMachines.map((machine) => {
      const logs = filteredLogs.filter(
        (l) => (l.machineId === machine.id || l.machineName === machine.name) && l.stdOutput > 0
      );
      const std = logs.reduce((acc, r) => acc + (Number(r.stdOutput) || 0), 0);
      const act = logs.reduce((acc, r) => acc + (Number(r.actualOutput) || 0), 0);
      const rework = logs.reduce((acc, r) => acc + (Number(r.rework) || 0), 0);
      const downtime = logs.reduce((acc, r) => acc + calculateTotalBreakdown(r.breakdown), 0);
      const efficiency = std > 0 ? Math.round((act / std) * 100) : 0;
      const latestOperator = logs[logs.length - 1]?.operatorName || '—';
      const latestItem = logs[logs.length - 1]?.itemName || '—';

      return {
        id: machine.id,
        name: machine.name,
        code: machine.code,
        line: machine.line || 'Line 1',
        std,
        act,
        rework,
        downtime,
        efficiency,
        latestOperator,
        latestItem,
        hasData: logs.length > 0,
      };
    });
  }, [machines, filteredLogs, lineFilter]);

  // Sorted machine downtime for Pareto list
  const sortedByDowntime = useMemo(() => {
    return [...machineMetrics]
      .filter((m) => m.downtime > 0)
      .sort((a, b) => b.downtime - a.downtime);
  }, [machineMetrics]);

  // Total breakdown calculation for breakdown percentages
  const grandBreakdown = kpis.totalBreakdown || 1; // avoid divide by 0
  const noDiscPct = Math.round((kpis.breakdownSplit.noDisc / grandBreakdown) * 100);
  const changePct = Math.round((kpis.breakdownSplit.change / grandBreakdown) * 100);
  const powerPct = Math.round((kpis.breakdownSplit.power / grandBreakdown) * 100);
  const operatorPct = Math.round((kpis.breakdownSplit.operator / grandBreakdown) * 100);

  return (
    <div className="space-y-6">
      {/* Top Controls & Power BI Feed Export */}
      <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-2xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <h2 className="text-base font-bold text-slate-900 tracking-tight">
              Production Intelligence & Power BI Telemetry
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Aggregated shift metrics across the 16 CNC & machining units. Ready for plant executive review and Power BI ingestion.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Date Filter */}
          <div className="flex items-center bg-slate-100 p-1 rounded border border-slate-200 text-xs">
            <button
              onClick={() => setDateFilter('all')}
              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                dateFilter === 'all' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Time
            </button>
            <button
              onClick={() => setDateFilter('today')}
              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                dateFilter === 'today' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setDateFilter('yesterday')}
              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                dateFilter === 'yesterday' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Yesterday
            </button>
            <button
              onClick={() => setDateFilter('week')}
              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                dateFilter === 'week' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Last 7 Days
            </button>
            {selectedDate && selectedDate !== new Date().toISOString().slice(0, 10) && (
              <button
                onClick={() => setDateFilter('selected')}
                className={`px-2.5 py-1 rounded font-medium transition-colors ${
                  dateFilter === 'selected' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Log Date ({selectedDate})
              </button>
            )}
          </div>

          {/* Shift Filter */}
          <select
            value={shiftFilter}
            onChange={(e) => setShiftFilter(e.target.value)}
            className="bg-white border border-slate-200 text-xs font-medium text-slate-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-slate-800"
          >
            <option value="all">All Shifts</option>
            <option value="Shift A">Shift A (6AM-2PM)</option>
            <option value="Shift B">Shift B (2PM-10PM)</option>
            <option value="Shift C">Shift C (10PM-6AM)</option>
          </select>

          {/* Production Line Filter */}
          <select
            value={lineFilter}
            onChange={(e) => setLineFilter(e.target.value)}
            className="bg-white border border-slate-200 text-xs font-medium text-slate-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-slate-800"
          >
            <option value="all">All Lines (Plant-wide)</option>
            <option value="Line 1">Line 1 (CNC Line)</option>
            <option value="Line 2">Line 2 (VMC Line)</option>
            <option value="Line 3">Line 3 (Heavy SPM)</option>
          </select>

          {/* Direct CSV / Excel Export for Power BI */}
          <button
            onClick={() => exportHistoricalToCSV(filteredLogs)}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs"
            title="Download clean CSV table structured for Power BI desktop import"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>Power BI CSV</span>
          </button>

          <button
            onClick={() => exportShiftToExcel(filteredLogs, 'Executive_Report')}
            className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            <span>Export .xlsx</span>
          </button>
        </div>
      </div>

      {/* 4 Primary KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Actual vs Std Output */}
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <span>Production Output</span>
            <span className="font-mono text-slate-400">Pcs</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl sm:text-3xl font-extrabold font-mono text-slate-900">
              {kpis.totalAct}
            </span>
            <span className="text-xs text-slate-500 font-mono">
              Std: <strong className="text-slate-800">{kpis.totalStd}</strong>
            </span>
          </div>
          <div className="pt-1 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-500">Target Variance:</span>
            <span
              className={`font-mono font-bold ${
                kpis.variance >= 0 ? 'text-emerald-700' : 'text-rose-700'
              }`}
            >
              {kpis.variance >= 0 ? `+${kpis.variance} surplus` : `${kpis.variance} shortfall`}
            </span>
          </div>
        </div>

        {/* KPI 2: Overall Plant Efficiency */}
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <span>Overall Plant Efficiency</span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="flex items-baseline justify-between">
            <span
              className={`text-2xl sm:text-3xl font-extrabold font-mono ${
                kpis.plantEfficiency >= 90
                  ? 'text-emerald-700'
                  : kpis.plantEfficiency >= 75
                  ? 'text-amber-700'
                  : 'text-rose-700'
              }`}
            >
              {kpis.plantEfficiency}%
            </span>
            <span className="text-xs text-slate-500 font-mono">
              Target SLA: <strong>85%</strong>
            </span>
          </div>
          <div className="pt-1 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-500">Status:</span>
            <span
              className={`font-semibold ${
                kpis.plantEfficiency >= 85 ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              {kpis.plantEfficiency >= 85 ? 'Target Met (Above SLA)' : 'Under Observation'}
            </span>
          </div>
        </div>

        {/* KPI 3: Total Rework Pieces */}
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <span>Rework / Scrap Defect</span>
            <AlertOctagon className="w-4 h-4 text-rose-600" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl sm:text-3xl font-extrabold font-mono text-rose-700">
              {kpis.totalRework}
            </span>
            <span className="text-xs font-mono text-slate-500">
              Defect Rate: <strong className="text-rose-700">{kpis.reworkRate}%</strong>
            </span>
          </div>
          <div className="pt-1 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-500">Quality Benchmark:</span>
            <span className="text-slate-700 font-medium font-mono">&lt; 3.0% acceptable</span>
          </div>
        </div>

        {/* KPI 4: Total Breakdown Minutes Lost */}
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <span>Total Downtime Lost</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl sm:text-3xl font-extrabold font-mono text-amber-700">
              {kpis.totalBreakdown}
              <span className="text-sm font-semibold text-slate-500 ml-1">mins</span>
            </span>
            <span className="text-xs font-mono text-slate-500">
              ≈ {(kpis.totalBreakdown / 60).toFixed(1)} hrs
            </span>
          </div>
          <div className="pt-1 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-500">Working Time Loss:</span>
            <span className="font-mono font-bold text-amber-800">
              {kpis.totalBdPctOfWorking}% of 1350m
            </span>
          </div>
        </div>
      </div>

      {/* Main Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Machine-wise Production Efficiency Bar Chart (2 columns) */}
        <div className="lg:col-span-2 bg-white rounded-lg border border-slate-200 p-4 sm:p-5 shadow-2xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-slate-700" />
                <span>Machine-Wise Production vs Standard Target</span>
              </h3>
              <p className="text-xs text-slate-500">
                Visualizing actual production volume against standard shift quota across all 16 client machines.
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded bg-emerald-600 inline-block" />
                <span className="text-slate-600 font-medium">Actual Output</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded bg-slate-300 inline-block" />
                <span className="text-slate-600 font-medium">Std Quota</span>
              </span>
            </div>
          </div>

          {/* SVG & HTML Interactive Bar Chart */}
          <div className="pt-2">
            <div className="space-y-2 max-h-115 overflow-y-auto pr-2">
              {machineMetrics.map((m, idx) => {
                const maxScale = Math.max(220, ...machineMetrics.map((item) => Math.max(item.std, item.act)));
                const actWidth = Math.min(100, (m.act / maxScale) * 100);
                const stdWidth = Math.min(100, (m.std / maxScale) * 100);

                return (
                  <div
                    key={m.id}
                    onMouseEnter={() => setHoveredMachineId(m.id)}
                    onMouseLeave={() => setHoveredMachineId(null)}
                    className={`p-2 rounded transition-colors text-xs border ${
                      hoveredMachineId === m.id
                        ? 'bg-slate-50 border-slate-400'
                        : 'border-transparent hover:bg-slate-50/60'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1 font-medium">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-slate-500 text-[11px] w-6">#{idx + 1}</span>
                        <strong className="text-slate-900">{m.name}</strong>
                        <span className="text-[11px] text-slate-600 hidden sm:inline font-mono">
                          ({m.code})
                        </span>
                      </div>
                      <div className="flex items-center gap-2 font-mono">
                        <span className="text-slate-600">
                          {m.act} / {m.std} pcs
                        </span>
                        <span
                          className={`font-bold px-1.5 py-0.2 rounded text-[11px] ${
                            m.efficiency >= 90
                              ? 'bg-emerald-100 text-emerald-800'
                              : m.efficiency >= 75
                              ? 'bg-amber-100 text-amber-800'
                              : m.std === 0
                              ? 'text-slate-500'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {m.std > 0 ? `${m.efficiency}%` : '—'}
                        </span>
                      </div>
                    </div>

                    {/* Comparative Dual Bars */}
                    <div className="space-y-1">
                      {/* Actual Bar */}
                      <div className="w-full bg-slate-100 h-2.5 rounded overflow-hidden relative">
                        <div
                          className={`h-full rounded transition-all duration-300 ${
                            m.efficiency >= 90
                              ? 'bg-emerald-600'
                              : m.efficiency >= 75
                              ? 'bg-amber-500'
                              : 'bg-rose-500'
                          }`}
                          style={{ width: `${actWidth}%` }}
                        />
                      </div>
                    </div>

                    {/* Expanded Tooltip Details on Hover */}
                    {hoveredMachineId === m.id && (
                      <div className="mt-2 pt-2 border-t border-slate-200 text-[11px] text-slate-600 flex flex-wrap items-center justify-between gap-2 bg-white p-2 rounded shadow-2xs">
                        <span>Operator: <strong>{m.latestOperator}</strong></span>
                        <span>Item: <strong>{m.latestItem}</strong></span>
                        <span>Downtime: <strong className="text-amber-700">{m.downtime} mins</strong></span>
                        <span>Rework: <strong className="text-rose-700">{m.rework} pcs</strong></span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Breakdown Downtime Split & Pareto (1 column) */}
        <div className="space-y-6">
          {/* Exact 4 Reasons Breakdown Split */}
          <div className="bg-white rounded-lg border border-slate-200 p-4 sm:p-5 shadow-2xs space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900 tracking-tight">
                Breakdown Downtime Categorization
              </h3>
              <p className="text-xs text-slate-500">
                Split across the 4 factory logging categories (Total: {kpis.totalBreakdown} mins)
              </p>
            </div>

            {/* Proportional Stacked Bar */}
            <div className="w-full h-4 rounded overflow-hidden flex bg-slate-100 border border-slate-200">
              <div
                style={{ width: `${noDiscPct}%` }}
                className="bg-amber-500 h-full"
                title={`NO/DISC: ${kpis.breakdownSplit.noDisc}m (${noDiscPct}%)`}
              />
              <div
                style={{ width: `${changePct}%` }}
                className="bg-blue-500 h-full"
                title={`CHANGE: ${kpis.breakdownSplit.change}m (${changePct}%)`}
              />
              <div
                style={{ width: `${powerPct}%` }}
                className="bg-rose-500 h-full"
                title={`POWER: ${kpis.breakdownSplit.power}m (${powerPct}%)`}
              />
              <div
                style={{ width: `${operatorPct}%` }}
                className="bg-purple-500 h-full"
                title={`OPERATOR: ${kpis.breakdownSplit.operator}m (${operatorPct}%)`}
              />
            </div>

            {/* List breakdown with minutes and percentages */}
            <div className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded bg-amber-500 inline-block" />
                  <div>
                    <span className="font-bold text-slate-800">NO / DISC</span>
                    <p className="text-[10px] text-slate-500">Material & casting shortage</p>
                  </div>
                </div>
                <div className="text-right font-mono">
                  <span className="font-bold text-slate-900">{kpis.breakdownSplit.noDisc} mins</span>
                  <div className="flex items-center justify-end gap-1.5 text-[10px]">
                    <span className="text-slate-600 font-semibold">{noDiscPct}% share</span>
                    <span className="text-slate-400">·</span>
                    <span className="text-amber-700 font-semibold">{kpis.categoryWorkingPct.noDisc}% of 1350m</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded bg-blue-500 inline-block" />
                  <div>
                    <span className="font-bold text-slate-800">CHANGE</span>
                    <p className="text-[10px] text-slate-500">Tool change & insert setup</p>
                  </div>
                </div>
                <div className="text-right font-mono">
                  <span className="font-bold text-slate-900">{kpis.breakdownSplit.change} mins</span>
                  <div className="flex items-center justify-end gap-1.5 text-[10px]">
                    <span className="text-slate-600 font-semibold">{changePct}% share</span>
                    <span className="text-slate-400">·</span>
                    <span className="text-amber-700 font-semibold">{kpis.categoryWorkingPct.change}% of 1350m</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded bg-rose-500 inline-block" />
                  <div>
                    <span className="font-bold text-slate-800">POWER</span>
                    <p className="text-[10px] text-slate-500">Grid trip & electrical breakdown</p>
                  </div>
                </div>
                <div className="text-right font-mono">
                  <span className="font-bold text-slate-900">{kpis.breakdownSplit.power} mins</span>
                  <div className="flex items-center justify-end gap-1.5 text-[10px]">
                    <span className="text-slate-600 font-semibold">{powerPct}% share</span>
                    <span className="text-slate-400">·</span>
                    <span className="text-amber-700 font-semibold">{kpis.categoryWorkingPct.power}% of 1350m</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded bg-purple-500 inline-block" />
                  <div>
                    <span className="font-bold text-slate-800">OPERATOR</span>
                    <p className="text-[10px] text-slate-500">Worker delay & unattended machine</p>
                  </div>
                </div>
                <div className="text-right font-mono">
                  <span className="font-bold text-slate-900">{kpis.breakdownSplit.operator} mins</span>
                  <div className="flex items-center justify-end gap-1.5 text-[10px]">
                    <span className="text-slate-600 font-semibold">{operatorPct}% share</span>
                    <span className="text-slate-400">·</span>
                    <span className="text-amber-700 font-semibold">{kpis.categoryWorkingPct.operator}% of 1350m</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Pareto Ranking - Machines with Most Downtime */}
          <div className="bg-white rounded-lg border border-slate-200 p-4 sm:p-5 shadow-2xs space-y-3">
            <h3 className="text-sm font-bold text-slate-900 tracking-tight">
              Top Downtime Culprits (Pareto Ranking)
            </h3>
            {sortedByDowntime.length === 0 ? (
              <p className="text-xs text-slate-500">Zero downtime recorded for current selection.</p>
            ) : (
              <div className="space-y-1.5 text-xs">
                {sortedByDowntime.slice(0, 5).map((m, rank) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between py-1.5 px-2 rounded bg-slate-50"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded-full bg-slate-800 text-white font-mono text-[10px] flex items-center justify-center font-bold">
                        {rank + 1}
                      </span>
                      <span className="font-semibold text-slate-800">{m.name}</span>
                    </div>
                    <span className="font-mono font-bold text-amber-700">
                      {m.downtime} mins lost
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Historical Shift Log Table */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-2xs overflow-hidden space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 tracking-tight">
              Historical Production Master Records
            </h3>
            <p className="text-xs text-slate-500">
              Showing {filteredLogs.length} verified shift rows ready for audit and Power BI synchronization.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search machine, operator, part..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded focus:border-slate-800 focus:outline-none w-56 sm:w-64"
              />
            </div>

            <button
              onClick={() => exportHistoricalToCSV(filteredLogs)}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Scrollable Data Table */}
        <div className="overflow-x-auto max-h-96 border border-slate-200 rounded">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="bg-slate-900 text-slate-200 sticky top-0 z-10 text-[11px] font-semibold uppercase">
              <tr>
                <th className="px-3 py-2 border-r border-slate-800">Date</th>
                <th className="px-2.5 py-2 border-r border-slate-800">Line</th>
                <th className="px-3 py-2 border-r border-slate-800">Shift</th>
                <th className="px-3 py-2 border-r border-slate-800">Machine</th>
                <th className="px-3 py-2 border-r border-slate-800">Operator</th>
                <th className="px-3 py-2 border-r border-slate-800">Item</th>
                <th className="px-2 py-2 border-r border-slate-800 text-center">Cycle Time</th>
                <th className="px-2 py-2 border-r border-slate-800 text-center">Std</th>
                <th className="px-2 py-2 border-r border-slate-800 text-center">Actual</th>
                <th className="px-2 py-2 border-r border-slate-800 text-center">Rework</th>
                <th className="px-2 py-2 border-r border-slate-800 text-center">BD Mins</th>
                <th className="px-2 py-2 border-r border-slate-800 text-center">BD %</th>
                <th className="px-2 py-2 border-r border-slate-800 text-center">Eff %</th>
                <th className="px-3 py-2">Remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={14} className="text-center py-8 text-slate-500 font-sans">
                    No records found matching current date/shift/line filters.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((row) => {
                  const bdTotal = calculateTotalBreakdown(row.breakdown);
                  const eff = row.stdOutput > 0 ? calculateEfficiency(row.actualOutput, row.stdOutput) : 0;
                  const bdPct =
                    row.breakdownPct?.totalBdPct != null && row.breakdownPct.totalBdPct > 0
                      ? `${row.breakdownPct.totalBdPct}%`
                      : bdTotal > 0 && (row.totalWorkingMinutes || 1350) > 0
                      ? `${((bdTotal / (row.totalWorkingMinutes || 1350)) * 100).toFixed(1)}%`
                      : '0.0%';

                  return (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-3 py-1.5 text-slate-700 whitespace-nowrap">{row.date}</td>
                      <td className="px-2.5 py-1.5 text-slate-800 font-sans font-semibold whitespace-nowrap text-[11px]">{row.line || 'Line 1'}</td>
                      <td className="px-3 py-1.5 text-slate-700 whitespace-nowrap">{row.shift.split(' ')[0]}</td>
                      <td className="px-3 py-1.5 font-bold font-sans text-slate-900 whitespace-nowrap">
                        {row.machineName}
                      </td>
                      <td className="px-3 py-1.5 font-sans text-slate-700 whitespace-nowrap">
                        {row.operatorName || '—'}
                      </td>
                      <td className="px-3 py-1.5 font-sans text-slate-700 whitespace-nowrap">
                        {row.itemName || '—'}
                      </td>
                      <td className="px-2 py-1.5 text-center text-slate-700 whitespace-nowrap">
                        {row.cycleTime ? `${row.cycleTime}s` : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-center text-slate-600">{row.stdOutput}</td>
                      <td className="px-2 py-1.5 text-center font-bold text-slate-900">{row.actualOutput}</td>
                      <td className="px-2 py-1.5 text-center text-rose-700">{row.rework}</td>
                      <td className="px-2 py-1.5 text-center text-amber-700">{bdTotal}m</td>
                      <td className="px-2 py-1.5 text-center font-semibold text-amber-800">{bdPct}</td>
                      <td className="px-2 py-1.5 text-center">
                        {row.stdOutput > 0 ? (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              eff >= 90
                                ? 'bg-emerald-100 text-emerald-800'
                                : eff >= 75
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {eff}%
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-1.5 font-sans text-slate-500 text-xs truncate max-w-xs">
                        {row.remarks || '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};


export default AnalyticsPreview;