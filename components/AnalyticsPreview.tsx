"use client";
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Clock,
  Download,
  FileSpreadsheet,
  Search,
  Calendar,
  Layers,
  Package,
  Filter,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Cpu,
  ArrowUpDown,
  CheckCircle2,
  AlertTriangle,
  Target,
} from "lucide-react";
import {
  MachineShiftRow,
  MasterDataState,
  ShiftType,
  OpenMachineParams,
} from "@/types";
import { exportHistoricalToCSV, exportShiftToExcel } from "@/services/excelExport";
import { getAnalyticsLogs } from "@/actions/shiftActions";
import { useFeedback } from "@/context/FeedbackContext";
import {
  computeAllocatedPlannedMinutes,
  calculateOeeMetrics,
  buildProductLineMachineMatrix,
  groupByLine,
  groupByShift,
  groupByPeriod,
  groupByMachine,
  EnrichedAnalyticsRow,
  OeeMetrics,
} from "@/services/analyticsEngine";
import { MachineAnalyticsView } from "./MachineAnalyticsView";

interface AnalyticsPreviewProps {
  rows: MachineShiftRow[];
  selectedDate: string;
  selectedShift: ShiftType;
  selectedLine: string;
  masterData?: MasterDataState;
  onOpenMachine?: (params: OpenMachineParams) => void;
}

type TabType = "product" | "line" | "shift" | "period" | "machine";
type PresetKey = "today" | "yesterday" | "thisWeek" | "lastWeek" | "thisMonth" | "custom";

function getLocalDateString(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function computePresetDates(refDate?: string): Record<
  "today" | "yesterday" | "thisWeek" | "lastWeek" | "thisMonth",
  { from: string; to: string }
> {
  const now = refDate ? new Date(refDate + "T00:00:00") : new Date();
  const todayStr = getLocalDateString(now);

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = getLocalDateString(yesterday);

  // This Week (Monday to today)
  const dayOfWeek = (now.getDay() + 6) % 7; // Monday = 0
  const thisWeekMon = new Date(now);
  thisWeekMon.setDate(now.getDate() - dayOfWeek);
  const thisWeekStr = getLocalDateString(thisWeekMon);

  // Last Week (Monday to Sunday of last week)
  const lastWeekMon = new Date(thisWeekMon);
  lastWeekMon.setDate(thisWeekMon.getDate() - 7);
  const lastWeekSun = new Date(thisWeekMon);
  lastWeekSun.setDate(thisWeekMon.getDate() - 1);

  // This Month (1st of month to today)
  const thisMonth1st = new Date(now.getFullYear(), now.getMonth(), 1);
  const thisMonthStr = getLocalDateString(thisMonth1st);

  return {
    today: { from: todayStr, to: todayStr },
    yesterday: { from: yesterdayStr, to: yesterdayStr },
    thisWeek: { from: thisWeekStr, to: todayStr },
    lastWeek: { from: getLocalDateString(lastWeekMon), to: getLocalDateString(lastWeekSun) },
    thisMonth: { from: thisMonthStr, to: todayStr },
  };
}

export const AnalyticsPreview: React.FC<AnalyticsPreviewProps> = ({
  rows,
  selectedDate,
  masterData,
  onOpenMachine,
}) => {
  const { runWithFeedback } = useFeedback();

  // --------------------------------------------------------------------------
  // DATE RANGE CONTROLS & STATE
  // --------------------------------------------------------------------------
  const initialPresets = useMemo(() => computePresetDates(selectedDate), [selectedDate]);
  const [activePreset, setActivePreset] = useState<PresetKey>("thisWeek");
  const [fromDate, setFromDate] = useState<string>(initialPresets.thisWeek.from);
  const [toDate, setToDate] = useState<string>(initialPresets.thisWeek.to);

  // Data loaded from Supabase
  const [historicalLogs, setHistoricalLogs] = useState<MachineShiftRow[]>([]);

  // --------------------------------------------------------------------------
  // MACHINE DRILLDOWN STATE & URL SYNC
  // --------------------------------------------------------------------------
  const [selectedAnalyticsMachineId, setSelectedAnalyticsMachineId] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      try {
        return new URLSearchParams(window.location.search).get("analyticsMachineId") || null;
      } catch {
        return null;
      }
    }
    return null;
  });

  const updateAnalyticsMachineUrl = useCallback((machineId: string | null) => {
    if (typeof window === "undefined") return;
    try {
      const searchParams = new URLSearchParams(window.location.search);
      if (machineId) {
        searchParams.set("analyticsMachineId", machineId);
      } else {
        searchParams.delete("analyticsMachineId");
      }
      const queryStr = searchParams.toString();
      const newUrl = queryStr ? `${window.location.pathname}?${queryStr}` : window.location.pathname;
      window.history.replaceState(null, "", newUrl);
    } catch {
      // ignore
    }
  }, []);

  const handleSelectAnalyticsMachine = useCallback(
    (machineId: string | null) => {
      setSelectedAnalyticsMachineId(machineId);
      updateAnalyticsMachineUrl(machineId);
    },
    [updateAnalyticsMachineUrl]
  );

  // Sync state if URL changes externally (e.g. browser back/forward, tab click reset)
  useEffect(() => {
    const handlePopState = () => {
      try {
        const id = new URLSearchParams(window.location.search).get("analyticsMachineId");
        setSelectedAnalyticsMachineId(id);
      } catch {
        // ignore
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const handleDateRangeChange = useCallback(
    (from: string, to: string, preset?: string) => {
      setFromDate(from);
      setToDate(to);
      if (
        preset &&
        (["today", "yesterday", "thisWeek", "lastWeek", "thisMonth", "custom"] as const).includes(
          preset as PresetKey
        )
      ) {
        setActivePreset(preset as PresetKey);
      } else {
        setActivePreset("custom");
      }
    },
    []
  );

  const lastFetchedRangeRef = useRef<string>("");

  const fetchRange = useCallback(
    async (from: string, to: string) => {
      const rangeKey = `${from}_to_${to}`;
      if (lastFetchedRangeRef.current === rangeKey) {
        return;
      }
      lastFetchedRangeRef.current = rangeKey;

      await runWithFeedback(
        async () => {
          const data = await getAnalyticsLogs(from, to);
          setHistoricalLogs(data || []);
          return data;
        },
        {
          loadingMessage: "Loading analytics data...",
          errorTitle: "Analytics Fetch Failed",
        }
      );
    },
    [runWithFeedback]
  );

  // Fetch on mount or when fromDate/toDate changes through preset or explicit Apply
  useEffect(() => {
    fetchRange(fromDate, toDate);
  }, [fetchRange, fromDate, toDate]);

  const handleSelectPreset = (key: "today" | "yesterday" | "thisWeek" | "lastWeek" | "thisMonth") => {
    const dates = initialPresets[key];
    setActivePreset(key);
    setFromDate(dates.from);
    setToDate(dates.to);
  };

  const handleApplyCustomDates = () => {
    setActivePreset("custom");
    lastFetchedRangeRef.current = "";
    fetchRange(fromDate, toDate);
  };

  // --------------------------------------------------------------------------
  // MERGE HISTORICAL LOGS WITH LIVE SHIFT ROWS
  // --------------------------------------------------------------------------
  const mergedLogs = useMemo(() => {
    const map = new Map<string, MachineShiftRow>();
    historicalLogs.forEach((log) => {
      const key = log.id || `${log.date}_${log.shift}_${log.line}_${log.machineId}_${log.runNo || 1}`;
      map.set(key, log);
    });
    // Live current shift sheet rows take precedence
    rows.forEach((row) => {
      const key = row.id || `${row.date}_${row.shift}_${row.line}_${row.machineId}_${row.runNo || 1}`;
      map.set(key, row);
    });
    return Array.from(map.values());
  }, [historicalLogs, rows]);

  // Feed through pure calculation engine to allocate planned minutes without double counting
  const enrichedAllRows = useMemo(() => {
    return computeAllocatedPlannedMinutes(mergedLogs);
  }, [mergedLogs]);

  // --------------------------------------------------------------------------
  // INSTANT CLIENT-SIDE FACET FILTERS (Zero DB refetch)
  // --------------------------------------------------------------------------
  const [filterProduct, setFilterProduct] = useState<string>("all");
  const [filterLine, setFilterLine] = useState<string>("all");
  const [filterShift, setFilterShift] = useState<string>("all");
  const [filterMachine, setFilterMachine] = useState<string>("all");
  const [filterOperator, setFilterOperator] = useState<string>("all");

  const [includeTempMachines, setIncludeTempMachines] = useState<boolean>(true);
  const [tempOnly, setTempOnly] = useState<boolean>(false);
  const [splitRunsOnly, setSplitRunsOnly] = useState<boolean>(false);

  // Available facet options derived from data
  const availableFacets = useMemo(() => {
    const prodMap = new Map<string, string>();
    const lineSet = new Set<string>();
    const shiftSet = new Set<string>();
    const machMap = new Map<string, { id: string; name: string; isTemp: boolean }>();
    const opSet = new Set<string>();

    for (const r of enrichedAllRows) {
      if (r.itemName || r.itemId) {
        const pKey = (r.itemId || r.itemName || "").trim();
        const pName = r.itemName || r.itemId || "";
        if (pKey) prodMap.set(pKey, pName);
      }
      if (r.line) lineSet.add(r.line);
      if (r.shift) shiftSet.add(r.shift);
      const mId = r.machineId || r.machineName;
      if (mId && !machMap.has(mId)) {
        machMap.set(mId, {
          id: mId,
          name: r.machineName || mId,
          isTemp: Boolean(r.isTempMachine),
        });
      }
      if (r.operatorName) opSet.add(r.operatorName);
    }

    // Include masterData lines if not yet in shift_logs
    if (masterData?.lines) {
      masterData.lines.forEach((l) => lineSet.add(l.name));
    }

    return {
      products: Array.from(prodMap.entries()).map(([id, name]) => ({ id, name })),
      lines: Array.from(lineSet).sort(),
      shifts: Array.from(shiftSet).sort(),
      machines: Array.from(machMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
      operators: Array.from(opSet).sort(),
    };
  }, [enrichedAllRows, masterData]);

  const hasActiveFacetFilters =
    filterProduct !== "all" ||
    filterLine !== "all" ||
    filterShift !== "all" ||
    filterMachine !== "all" ||
    filterOperator !== "all" ||
    !includeTempMachines ||
    tempOnly ||
    splitRunsOnly;

  const handleResetFilters = () => {
    setFilterProduct("all");
    setFilterLine("all");
    setFilterShift("all");
    setFilterMachine("all");
    setFilterOperator("all");
    setIncludeTempMachines(true);
    setTempOnly(false);
    setSplitRunsOnly(false);
  };

  // Filtered rows for analytics calculations
  const filteredRows: EnrichedAnalyticsRow[] = useMemo(() => {
    return enrichedAllRows.filter((r) => {
      if (filterProduct !== "all") {
        const target = filterProduct.toLowerCase();
        const matchName = (r.itemName || "").toLowerCase() === target;
        const matchId = (r.itemId || "").toLowerCase() === target;
        if (!matchName && !matchId) return false;
      }
      if (filterLine !== "all" && (r.line || "").toLowerCase() !== filterLine.toLowerCase()) {
        return false;
      }
      if (filterShift !== "all" && (r.shift || "").toLowerCase() !== filterShift.toLowerCase()) {
        return false;
      }
      if (filterMachine !== "all") {
        const targetM = filterMachine.toLowerCase();
        const matchMId = (r.machineId || "").toLowerCase() === targetM;
        const matchMName = (r.machineName || "").toLowerCase() === targetM;
        if (!matchMId && !matchMName) return false;
      }
      if (
        filterOperator !== "all" &&
        (r.operatorName || "").toLowerCase() !== filterOperator.toLowerCase()
      ) {
        return false;
      }
      if (!includeTempMachines && r.isTempMachine) {
        return false;
      }
      if (tempOnly && !r.isTempMachine) {
        return false;
      }
      if (splitRunsOnly && !r.isSplitRun) {
        return false;
      }
      return true;
    });
  }, [
    enrichedAllRows,
    filterProduct,
    filterLine,
    filterShift,
    filterMachine,
    filterOperator,
    includeTempMachines,
    tempOnly,
    splitRunsOnly,
  ]);

  // Overall OEE Metrics reflecting active filters
  const overallMetrics: OeeMetrics = useMemo(() => {
    return calculateOeeMetrics(filteredRows);
  }, [filteredRows]);

  // --------------------------------------------------------------------------
  // WORKSPACE TABS & ROLLUPS
  // --------------------------------------------------------------------------
  const [activeTab, setActiveTab] = useState<TabType>("product");
  const [periodGranularity, setPeriodGranularity] = useState<"day" | "week">("day");
  const [productSearch, setProductSearch] = useState<string>("");
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());

  const [machineSortKey, setMachineSortKey] = useState<"oee" | "actual" | "downtime" | "name">("oee");
  const [machineSortOrder, setMachineSortOrder] = useState<"asc" | "desc">("desc");

  // Tab 1: Product Matrix
  const productMatrix = useMemo(() => {
    const list = buildProductLineMachineMatrix(filteredRows);
    if (!productSearch.trim()) return list;
    const q = productSearch.trim().toLowerCase();
    return list.filter(
      (p) =>
        p.productName.toLowerCase().includes(q) ||
        p.productCode.toLowerCase().includes(q) ||
        p.lines.some((l) => l.toLowerCase().includes(q))
    );
  }, [filteredRows, productSearch]);

  // Tab 2: Line Rollups
  const lineRollups = useMemo(() => {
    return groupByLine(filteredRows);
  }, [filteredRows]);

  // Tab 3: Shift Rollups
  const shiftRollups = useMemo(() => {
    return groupByShift(filteredRows);
  }, [filteredRows]);

  // Tab 4: Period Rollups
  const periodRollups = useMemo(() => {
    return groupByPeriod(filteredRows, periodGranularity);
  }, [filteredRows, periodGranularity]);

  // Tab 5: Machine Rollups
  const machineRollups = useMemo(() => {
    const list = groupByMachine(filteredRows);
    list.sort((a, b) => {
      let diff = 0;
      if (machineSortKey === "oee") diff = a.metrics.oeePct - b.metrics.oeePct;
      else if (machineSortKey === "actual") diff = a.metrics.totalActual - b.metrics.totalActual;
      else if (machineSortKey === "downtime") diff = a.metrics.downtimeMinutes - b.metrics.downtimeMinutes;
      else diff = a.machineName.localeCompare(b.machineName);
      return machineSortOrder === "desc" ? -diff : diff;
    });
    return list;
  }, [filteredRows, machineSortKey, machineSortOrder]);

  const toggleExpandProduct = (key: string) => {
    setExpandedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // --------------------------------------------------------------------------
  // EXPORT HANDLERS
  // --------------------------------------------------------------------------
  const handleExportExcel = () => {
    const rangeTag = `${fromDate}_to_${toDate}`;
    exportShiftToExcel(
      filteredRows,
      rangeTag,
      filterShift !== "all" ? filterShift : "All_Shifts",
      filterLine !== "all" ? filterLine : "All_Lines",
      `neco_production_analytics_${rangeTag}.xlsx`,
      masterData
    );
  };

  const handleExportCSV = () => {
    const rangeTag = `${fromDate}_to_${toDate}`;
    exportHistoricalToCSV(
      filteredRows,
      fromDate,
      toDate,
      `neco_production_detail_${rangeTag}.csv`
    );
  };

  // Color helper for OEE
  const getOeeColorClass = (oee: number) => {
    if (oee >= 85) return "text-emerald-700 bg-emerald-50 border-emerald-200";
    if (oee >= 65) return "text-amber-700 bg-amber-50 border-amber-200";
    return "text-rose-700 bg-rose-50 border-rose-200";
  };

  const getOeeBadgeClass = (oee: number) => {
    if (oee >= 85) return "bg-emerald-100 text-emerald-800 border-emerald-300";
    if (oee >= 65) return "bg-amber-100 text-amber-800 border-amber-300";
    return "bg-rose-100 text-rose-800 border-rose-300";
  };

  if (selectedAnalyticsMachineId) {
    return (
      <div className="space-y-4 max-w-[1600px] mx-auto pb-12">
        <MachineAnalyticsView
          machineId={selectedAnalyticsMachineId}
          onSelectMachine={handleSelectAnalyticsMachine}
          onBackToAnalytics={() => handleSelectAnalyticsMachine(null)}
          onOpenShiftEntry={onOpenMachine}
          enrichedRows={enrichedAllRows}
          masterData={
            masterData || {
              lines: [],
              machines: [],
              items: [],
              operators: [],
              cycleTimes: [],
            }
          }
          fromDate={fromDate}
          toDate={toDate}
          activePreset={activePreset}
          onDateRangeChange={handleDateRangeChange}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto pb-12">
      {/* ==================================================================== */}
      {/* TOP UNIFIED FILTER BAR (Compact & Responsive)                         */}
      {/* ==================================================================== */}
      <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-2xs space-y-2.5">
        {/* ROW 1: Date Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Quick Preset Pills */}
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mr-1 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>Range:</span>
            </span>
            {(
              [
                { key: "today", label: "Today" },
                { key: "yesterday", label: "Yesterday" },
                { key: "thisWeek", label: "This Week" },
                { key: "lastWeek", label: "Last Week" },
                { key: "thisMonth", label: "This Month" },
              ] as const
            ).map((p) => {
              const isSelected = activePreset === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => handleSelectPreset(p.key)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors cursor-pointer ${
                    isSelected
                      ? "bg-slate-900 text-white shadow-2xs"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* Date Pickers + Apply */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="flex items-center gap-1 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded px-2 py-1">
              <span className="text-[11px] font-semibold text-slate-500">From:</span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setActivePreset("custom");
                }}
                className="bg-transparent text-xs font-mono font-medium text-slate-800 focus:outline-none cursor-pointer"
              />
            </div>
            <div className="flex items-center gap-1 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded px-2 py-1">
              <span className="text-[11px] font-semibold text-slate-500">To:</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setActivePreset("custom");
                }}
                className="bg-transparent text-xs font-mono font-medium text-slate-800 focus:outline-none cursor-pointer"
              />
            </div>
            <button
              type="button"
              onClick={handleApplyCustomDates}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-bold transition-colors cursor-pointer shadow-2xs"
            >
              Apply
            </button>

            {/* Export buttons */}
            <div className="flex items-center gap-1 pl-2 border-l border-slate-200 ml-1">
              <button
                type="button"
                onClick={handleExportExcel}
                className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-bold flex items-center gap-1 shadow-2xs cursor-pointer"
                title="Export complete 5-sheet Excel workbook"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Export .xlsx</span>
              </button>
              <button
                type="button"
                onClick={handleExportCSV}
                className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-semibold flex items-center gap-1 cursor-pointer"
                title="Export raw shift logs as CSV"
              >
                <Download className="w-3.5 h-3.5" />
                <span>CSV</span>
              </button>
            </div>
          </div>
        </div>

        {/* ROW 2: Instant Client-Side Facet Filters */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
          <div className="flex items-center gap-1 text-[11px] font-bold text-slate-500 uppercase tracking-wider mr-1">
            <Filter className="w-3 h-3 text-slate-400" />
            <span>Filters:</span>
          </div>

          {/* Product Filter */}
          <select
            value={filterProduct}
            onChange={(e) => setFilterProduct(e.target.value)}
            className="text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1 font-medium text-slate-800 focus:outline-none focus:border-slate-800 max-w-[160px] truncate"
          >
            <option value="all">All Products ({availableFacets.products.length})</option>
            {availableFacets.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          {/* Line Filter */}
          <select
            value={filterLine}
            onChange={(e) => setFilterLine(e.target.value)}
            className="text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1 font-medium text-slate-800 focus:outline-none focus:border-slate-800"
          >
            <option value="all">All Lines ({availableFacets.lines.length})</option>
            {availableFacets.lines.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>

          {/* Shift Filter */}
          <select
            value={filterShift}
            onChange={(e) => setFilterShift(e.target.value)}
            className="text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1 font-medium text-slate-800 focus:outline-none focus:border-slate-800"
          >
            <option value="all">All Shifts ({availableFacets.shifts.length})</option>
            {availableFacets.shifts.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          {/* Machine Filter */}
          <select
            value={filterMachine}
            onChange={(e) => setFilterMachine(e.target.value)}
            className="text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1 font-medium text-slate-800 focus:outline-none focus:border-slate-800 max-w-[160px] truncate"
          >
            <option value="all">All Machines ({availableFacets.machines.length})</option>
            {availableFacets.machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} {m.isTemp ? "[TEMP]" : ""}
              </option>
            ))}
          </select>

          {/* Operator Filter */}
          <select
            value={filterOperator}
            onChange={(e) => setFilterOperator(e.target.value)}
            className="text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1 font-medium text-slate-800 focus:outline-none focus:border-slate-800 max-w-[140px] truncate"
          >
            <option value="all">All Operators ({availableFacets.operators.length})</option>
            {availableFacets.operators.map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>

          {/* Quick Toggle Chips */}
          <div className="flex items-center gap-1.5 ml-auto">
            <button
              type="button"
              onClick={() => setIncludeTempMachines(!includeTempMachines)}
              className={`px-2 py-0.5 text-[11px] font-semibold rounded border cursor-pointer transition-colors ${
                includeTempMachines
                  ? "bg-slate-100 text-slate-800 border-slate-300"
                  : "bg-white text-slate-400 border-slate-200 line-through"
              }`}
            >
              Temp Machines
            </button>

            <button
              type="button"
              onClick={() => {
                const next = !tempOnly;
                setTempOnly(next);
                if (next) setIncludeTempMachines(true);
              }}
              className={`px-2 py-0.5 text-[11px] font-semibold rounded border cursor-pointer transition-colors ${
                tempOnly
                  ? "bg-amber-100 text-amber-900 border-amber-300 font-bold"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              Temp Only
            </button>

            <button
              type="button"
              onClick={() => setSplitRunsOnly(!splitRunsOnly)}
              className={`px-2 py-0.5 text-[11px] font-semibold rounded border cursor-pointer transition-colors ${
                splitRunsOnly
                  ? "bg-purple-100 text-purple-900 border-purple-300 font-bold"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              Split Runs Only
            </button>

            {hasActiveFacetFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="px-2 py-0.5 text-[11px] font-bold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 rounded border border-rose-200 flex items-center gap-1 cursor-pointer transition-colors"
                title="Reset all filters"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* TOP OEE EXECUTIVE KPI STRIP (Reflects Active Filters)                 */}
      {/* ==================================================================== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* HERO CARD: OEE % */}
        <div
          className={`p-4 rounded-lg border shadow-2xs flex flex-col justify-between ${getOeeColorClass(
            overallMetrics.oeePct
          )}`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider">Overall Equipment Effectiveness</span>
            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-white/70 border border-current">
              Good Run Time / Planned Time
            </span>
          </div>
          <div className="my-2">
            <div className="text-4xl font-black tracking-tight">{overallMetrics.oeePct}%</div>
            <div className="text-[11px] font-medium opacity-85 mt-0.5">
              {overallMetrics.oeePct >= 85
                ? "World-Class Manufacturing Level"
                : overallMetrics.oeePct >= 65
                ? "Typical Plant Performance Level"
                : "Needs Process Improvement"}
            </div>
          </div>
          <div className="text-[11px] font-mono flex items-center justify-between pt-2 border-t border-current/20 opacity-90">
            <span>Oper: {overallMetrics.operatingMinutes.toFixed(1)}m</span>
            <span>Plan: {overallMetrics.plannedMinutes.toFixed(1)}m</span>
          </div>
        </div>

        {/* CARD 2: Availability */}
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs font-bold text-slate-700 mb-1">
              <span className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-blue-600" />
                <span>Availability</span>
              </span>
              <span className="text-sm font-extrabold text-slate-900">{overallMetrics.availabilityPct}%</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden my-2">
              <div
                className="bg-blue-600 h-full rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, overallMetrics.availabilityPct)}%` }}
              />
            </div>
          </div>
          <div className="space-y-1 text-xs text-slate-600 pt-1 border-t border-slate-100">
            <div className="flex justify-between">
              <span className="text-slate-500">Operating Mins:</span>
              <span className="font-mono font-bold text-slate-800">
                {overallMetrics.operatingMinutes.toLocaleString()} m
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Total Downtime:</span>
              <span className="font-mono font-bold text-rose-600">
                {overallMetrics.downtimeMinutes.toLocaleString()} m
              </span>
            </div>
          </div>
        </div>

        {/* CARD 3: Plan Achievement */}
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs font-bold text-slate-700 mb-1">
              <span className="flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5 text-purple-600" />
                <span>Plan Achievement</span>
              </span>
              <span className="text-sm font-extrabold text-slate-900">{overallMetrics.planAchievementPct}%</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden my-2">
              <div
                className="bg-purple-600 h-full rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, overallMetrics.planAchievementPct)}%` }}
              />
            </div>
          </div>
          <div className="space-y-1 text-xs text-slate-600 pt-1 border-t border-slate-100">
            <div className="flex justify-between">
              <span className="text-slate-500">Actual Output:</span>
              <span className="font-mono font-bold text-slate-800">
                {overallMetrics.totalActual.toLocaleString()} pcs
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Scheduled Target:</span>
              <span className="font-mono font-bold text-slate-600">
                {overallMetrics.totalStd.toLocaleString()} pcs
              </span>
            </div>
          </div>
        </div>

        {/* CARD 4: Quality */}
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs font-bold text-slate-700 mb-1">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>Quality (First Pass)</span>
              </span>
              <span className="text-sm font-extrabold text-slate-900">{overallMetrics.qualityPct}%</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden my-2">
              <div
                className="bg-emerald-600 h-full rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, overallMetrics.qualityPct)}%` }}
              />
            </div>
          </div>
          <div className="space-y-1 text-xs text-slate-600 pt-1 border-t border-slate-100">
            <div className="flex justify-between">
              <span className="text-slate-500">Good Output:</span>
              <span className="font-mono font-bold text-emerald-700">
                {overallMetrics.goodOutput.toLocaleString()} pcs
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Rework Quantity:</span>
              <span className="font-mono font-bold text-amber-600">
                {overallMetrics.totalRework.toLocaleString()} pcs
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 7-CATEGORY DOWNTIME STRIP */}
      <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-2xs space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px] flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              <span>7 Breakdown Categories:</span>
            </span>
            <span className="text-slate-500 text-[11px]">
              Total Downtime: <strong className="text-slate-800">{overallMetrics.downtimeMinutes} mins</strong>
            </span>
          </div>

          <div className="flex items-center gap-2 text-[11px] font-mono">
            {overallMetrics.tempMachineRunsCount > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                {overallMetrics.tempMachineRunsCount} Temp Machine Runs
              </span>
            )}
            {overallMetrics.splitRunsCount > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">
                {overallMetrics.splitRunsCount} Split Runs
              </span>
            )}
            <span className="text-slate-400">({overallMetrics.rowCount} log records)</span>
          </div>
        </div>

        {/* Stacked CSS Bar */}
        {overallMetrics.downtimeMinutes > 0 && (
          <div className="w-full h-2 rounded-full overflow-hidden flex bg-slate-100">
            {overallMetrics.breakdownTotals.noDisc > 0 && (
              <div
                style={{
                  width: `${(overallMetrics.breakdownTotals.noDisc / overallMetrics.downtimeMinutes) * 100}%`,
                }}
                className="bg-slate-500 h-full"
                title={`No Disc: ${overallMetrics.breakdownTotals.noDisc}m`}
              />
            )}
            {overallMetrics.breakdownTotals.change > 0 && (
              <div
                style={{
                  width: `${(overallMetrics.breakdownTotals.change / overallMetrics.downtimeMinutes) * 100}%`,
                }}
                className="bg-sky-500 h-full"
                title={`Change: ${overallMetrics.breakdownTotals.change}m`}
              />
            )}
            {overallMetrics.breakdownTotals.power > 0 && (
              <div
                style={{
                  width: `${(overallMetrics.breakdownTotals.power / overallMetrics.downtimeMinutes) * 100}%`,
                }}
                className="bg-amber-500 h-full"
                title={`Power: ${overallMetrics.breakdownTotals.power}m`}
              />
            )}
            {overallMetrics.breakdownTotals.operator > 0 && (
              <div
                style={{
                  width: `${(overallMetrics.breakdownTotals.operator / overallMetrics.downtimeMinutes) * 100}%`,
                }}
                className="bg-purple-500 h-full"
                title={`Operator: ${overallMetrics.breakdownTotals.operator}m`}
              />
            )}
            {overallMetrics.breakdownTotals.machineBreakdown > 0 && (
              <div
                style={{
                  width: `${(overallMetrics.breakdownTotals.machineBreakdown / overallMetrics.downtimeMinutes) * 100}%`,
                }}
                className="bg-rose-500 h-full"
                title={`Break Down: ${overallMetrics.breakdownTotals.machineBreakdown}m`}
              />
            )}
            {overallMetrics.breakdownTotals.fixProgSettings > 0 && (
              <div
                style={{
                  width: `${(overallMetrics.breakdownTotals.fixProgSettings / overallMetrics.downtimeMinutes) * 100}%`,
                }}
                className="bg-orange-500 h-full"
                title={`Fix / Prog: ${overallMetrics.breakdownTotals.fixProgSettings}m`}
              />
            )}
            {overallMetrics.breakdownTotals.miscellaneous > 0 && (
              <div
                style={{
                  width: `${(overallMetrics.breakdownTotals.miscellaneous / overallMetrics.downtimeMinutes) * 100}%`,
                }}
                className="bg-teal-500 h-full"
                title={`Misc: ${overallMetrics.breakdownTotals.miscellaneous}m`}
              />
            )}
          </div>
        )}

        {/* Breakdown category chips */}
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2 pt-1">
          {[
            { label: "NO/DISC", val: overallMetrics.breakdownTotals.noDisc, color: "text-slate-600 bg-slate-50" },
            { label: "CHANGE", val: overallMetrics.breakdownTotals.change, color: "text-sky-700 bg-sky-50" },
            { label: "POWER", val: overallMetrics.breakdownTotals.power, color: "text-amber-700 bg-amber-50" },
            { label: "OPERATOR", val: overallMetrics.breakdownTotals.operator, color: "text-purple-700 bg-purple-50" },
            { label: "BREAK DOWN", val: overallMetrics.breakdownTotals.machineBreakdown, color: "text-rose-700 bg-rose-50" },
            { label: "FIX/PROG", val: overallMetrics.breakdownTotals.fixProgSettings, color: "text-orange-700 bg-orange-50" },
            { label: "MISC.", val: overallMetrics.breakdownTotals.miscellaneous, color: "text-teal-700 bg-teal-50" },
          ].map((cat) => {
            const pct =
              overallMetrics.downtimeMinutes > 0
                ? Math.round((cat.val / overallMetrics.downtimeMinutes) * 100)
                : 0;
            return (
              <div key={cat.label} className={`p-1.5 rounded border border-slate-200 text-center ${cat.color}`}>
                <div className="text-[10px] font-bold uppercase truncate">{cat.label}</div>
                <div className="text-xs font-mono font-bold mt-0.5">{cat.val} m</div>
                <div className="text-[10px] text-slate-500">{pct}%</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ==================================================================== */}
      {/* 5-TAB ANALYTICS WORKSPACE                                             */}
      {/* ==================================================================== */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-2xs overflow-hidden">
        {/* Tab Navigation Header */}
        <div className="flex border-b border-slate-200 bg-slate-50 overflow-x-auto">
          {[
            { id: "product", label: "By Product (Lines & Machines)", icon: Package },
            { id: "line", label: "By Line", icon: Layers },
            { id: "shift", label: "By Shift", icon: Clock },
            { id: "period", label: "By Day / Week", icon: Calendar },
            { id: "machine", label: "By Machine", icon: Cpu },
          ].map((t) => {
            const Icon = t.icon;
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id as TabType)}
                className={`px-4 py-2.5 text-xs font-bold flex items-center gap-2 border-b-2 whitespace-nowrap cursor-pointer transition-colors ${
                  isActive
                    ? "border-slate-900 text-slate-900 bg-white"
                    : "border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100/70"
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? "text-blue-600" : "text-slate-400"}`} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* TAB 1: BY PRODUCT (LINES & MACHINES) */}
        {activeTab === "product" && (
          <div className="p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Product Traceability & Machine Matrix</h3>
                <p className="text-xs text-slate-500">
                  Detailed view of every Line, Machine, and Operation used to manufacture each component.
                </p>
              </div>
              <div className="relative w-72">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Search Product Name or Code..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded focus:border-slate-800 focus:outline-none"
                />
              </div>
            </div>

            {productMatrix.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs bg-slate-50 rounded border border-dashed border-slate-300">
                No product manufacturing data found for current filters.
              </div>
            ) : (
              <div className="space-y-3">
                {productMatrix.map((prod) => {
                  const isExpanded = expandedProducts.has(prod.productKey);
                  return (
                    <div
                      key={prod.productKey}
                      className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-2xs"
                    >
                      {/* Product Header Row */}
                      <div
                        onClick={() => toggleExpandProduct(prod.productKey)}
                        className="p-3 bg-slate-50 hover:bg-slate-100/80 transition-colors cursor-pointer flex flex-wrap items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <button
                            type="button"
                            className="p-1 text-slate-500 hover:text-slate-800 rounded cursor-pointer"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4" />
                            ) : (
                              <ChevronRight className="w-4 h-4" />
                            )}
                          </button>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="text-sm font-extrabold text-slate-900">{prod.productName}</h4>
                              {prod.productCode && (
                                <span className="text-[11px] font-mono font-bold text-slate-600 bg-slate-200 px-1.5 py-0.5 rounded">
                                  {prod.productCode}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                              <span>Lines: {prod.lines.join(", ") || "—"}</span>
                              <span>•</span>
                              <span>{prod.matrix.length} machine allocations</span>
                            </div>
                          </div>
                        </div>

                        {/* Product KPI Mini Bar */}
                        <div className="flex items-center gap-3 text-xs">
                          <div className="text-right">
                            <span className="text-[10px] text-slate-500 uppercase block">Actual Output</span>
                            <span className="font-mono font-bold text-slate-900">
                              {prod.metrics.totalActual.toLocaleString()} pcs
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-[10px] text-slate-500 uppercase block">Good Output</span>
                            <span className="font-mono font-bold text-emerald-700">
                              {prod.metrics.goodOutput.toLocaleString()} pcs
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-[10px] text-slate-500 uppercase block">Rework</span>
                            <span className="font-mono font-bold text-amber-600">
                              {prod.metrics.totalRework.toLocaleString()} pcs
                            </span>
                          </div>
                          <div className="text-right pl-2 border-l border-slate-200">
                            <span className="text-[10px] text-slate-500 uppercase block">Product OEE</span>
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-black border ${getOeeBadgeClass(
                                prod.metrics.oeePct
                              )}`}
                            >
                              {prod.metrics.oeePct}%
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Product Expanded Line & Machine Matrix Table */}
                      {isExpanded && (
                        <div className="border-t border-slate-200 overflow-x-auto">
                          <table className="w-full text-xs text-left">
                            <thead className="bg-slate-900 text-slate-100 uppercase text-[10px] font-semibold">
                              <tr>
                                <th className="px-3 py-2">Line</th>
                                <th className="px-3 py-2">Machine</th>
                                <th className="px-3 py-2">Operation</th>
                                <th className="px-3 py-2 text-center">Runs</th>
                                <th className="px-3 py-2 text-right">Target</th>
                                <th className="px-3 py-2 text-right">Actual</th>
                                <th className="px-3 py-2 text-right">Rework</th>
                                <th className="px-3 py-2 text-right">Good</th>
                                <th className="px-3 py-2 text-right">Downtime</th>
                                <th className="px-3 py-2 text-right">Avail %</th>
                                <th className="px-3 py-2 text-right">Qual %</th>
                                <th className="px-3 py-2 text-right font-black">OEE %</th>
                                <th className="px-3 py-2 text-center">Jump</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 font-mono">
                              {prod.matrix.map((m, mIdx) => (
                                <tr key={mIdx} className="hover:bg-slate-50 transition-colors">
                                  <td className="px-3 py-2 font-sans font-medium text-slate-700 whitespace-nowrap">
                                    {m.line}
                                  </td>
                                  <td className="px-3 py-2 font-sans">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleSelectAnalyticsMachine(m.machineId)
                                        }
                                        className="font-bold text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1 cursor-pointer"
                                        title="View Machine Analytics Drilldown"
                                      >
                                        <span>{m.machineName}</span>
                                        <ExternalLink className="w-3 h-3 opacity-60" />
                                      </button>
                                      {m.isTempMachine && (
                                        <span className="px-1 py-0.2 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">
                                          TEMP
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 font-sans text-slate-600">{m.operation}</td>
                                  <td className="px-3 py-2 text-center">
                                    {m.splitRunsCount > 0 ? (
                                      <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 text-[10px] font-bold">
                                        Split ({m.runNos.join(",")})
                                      </span>
                                    ) : (
                                      <span className="text-slate-400">1</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-right text-slate-600">{m.stdOutput}</td>
                                  <td className="px-3 py-2 text-right font-bold text-slate-900">{m.actualOutput}</td>
                                  <td className="px-3 py-2 text-right text-amber-600">{m.rework}</td>
                                  <td className="px-3 py-2 text-right text-emerald-700 font-bold">{m.goodOutput}</td>
                                  <td className="px-3 py-2 text-right text-rose-600">{m.breakdownMinutes}m</td>
                                  <td className="px-3 py-2 text-right text-slate-700">{m.metrics.availabilityPct}%</td>
                                  <td className="px-3 py-2 text-right text-slate-700">{m.metrics.qualityPct}%</td>
                                  <td className="px-3 py-2 text-right font-black">
                                    <span
                                      className={`px-1.5 py-0.5 rounded text-[11px] font-extrabold border ${getOeeBadgeClass(
                                        m.metrics.oeePct
                                      )}`}
                                    >
                                      {m.metrics.oeePct}%
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-center font-sans">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleSelectAnalyticsMachine(m.machineId)
                                      }
                                      className="p-1 text-slate-400 hover:text-blue-600 transition-colors cursor-pointer"
                                      title="View Machine Analytics Drilldown"
                                    >
                                      <ExternalLink className="w-3.5 h-3.5" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: BY LINE */}
        {activeTab === "line" && (
          <div className="p-4 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Production Line Performance & OEE Comparison</h3>
              <p className="text-xs text-slate-500">
                Line-by-line efficiency, downtime, and item breakdown across the selected period.
              </p>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-900 text-slate-100 uppercase text-[10px] font-semibold">
                  <tr>
                    <th className="px-3 py-2.5">Line Name</th>
                    <th className="px-3 py-2.5 text-center">Machines (Perm / Temp)</th>
                    <th className="px-3 py-2.5 text-right">Target (Std)</th>
                    <th className="px-3 py-2.5 text-right">Actual Output</th>
                    <th className="px-3 py-2.5 text-right">Good Output</th>
                    <th className="px-3 py-2.5 text-right">Rework</th>
                    <th className="px-3 py-2.5 text-right">Downtime</th>
                    <th className="px-3 py-2.5 text-right">Availability</th>
                    <th className="px-3 py-2.5 text-right">Quality</th>
                    <th className="px-3 py-2.5 text-right font-black">Line OEE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {lineRollups.map((l) => (
                    <tr key={l.line} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-sans font-bold text-slate-900 whitespace-nowrap">{l.line}</td>
                      <td className="px-3 py-2 text-center font-sans text-slate-600">
                        {l.machineCount} total ({l.permMachineCount} perm / {l.tempMachineCount} temp)
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">{l.metrics.totalStd.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-bold text-slate-900">
                        {l.metrics.totalActual.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right text-emerald-700 font-bold">
                        {l.metrics.goodOutput.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right text-amber-600">{l.metrics.totalRework.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-rose-600">{l.metrics.downtimeMinutes}m</td>
                      <td className="px-3 py-2 text-right text-slate-700">{l.metrics.availabilityPct}%</td>
                      <td className="px-3 py-2 text-right text-slate-700">{l.metrics.qualityPct}%</td>
                      <td className="px-3 py-2 text-right">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-black border ${getOeeBadgeClass(
                            l.metrics.oeePct
                          )}`}
                        >
                          {l.metrics.oeePct}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: BY SHIFT */}
        {activeTab === "shift" && (
          <div className="p-4 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Shift-Wise Efficiency & OEE Comparison</h3>
              <p className="text-xs text-slate-500">
                Analysis across Shift A, Shift B, and Shift C to identify variance between operational shifts.
              </p>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-900 text-slate-100 uppercase text-[10px] font-semibold">
                  <tr>
                    <th className="px-3 py-2.5">Shift Name</th>
                    <th className="px-3 py-2.5 text-center">Active Machines</th>
                    <th className="px-3 py-2.5 text-right">Target (Std)</th>
                    <th className="px-3 py-2.5 text-right">Actual Output</th>
                    <th className="px-3 py-2.5 text-right">Good Output</th>
                    <th className="px-3 py-2.5 text-right">Rework</th>
                    <th className="px-3 py-2.5 text-right">Downtime</th>
                    <th className="px-3 py-2.5 text-right">Availability</th>
                    <th className="px-3 py-2.5 text-right">Quality</th>
                    <th className="px-3 py-2.5 text-right font-black">Shift OEE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {shiftRollups.map((s) => (
                    <tr key={s.shift} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-sans font-bold text-slate-900 whitespace-nowrap">{s.shift}</td>
                      <td className="px-3 py-2 text-center font-sans text-slate-600">{s.machineCount}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{s.metrics.totalStd.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-bold text-slate-900">
                        {s.metrics.totalActual.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right text-emerald-700 font-bold">
                        {s.metrics.goodOutput.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right text-amber-600">{s.metrics.totalRework.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-rose-600">{s.metrics.downtimeMinutes}m</td>
                      <td className="px-3 py-2 text-right text-slate-700">{s.metrics.availabilityPct}%</td>
                      <td className="px-3 py-2 text-right text-slate-700">{s.metrics.qualityPct}%</td>
                      <td className="px-3 py-2 text-right">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-black border ${getOeeBadgeClass(
                            s.metrics.oeePct
                          )}`}
                        >
                          {s.metrics.oeePct}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: BY DAY / WEEK */}
        {activeTab === "period" && (
          <div className="p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Chronological Manufacturing Trends</h3>
                <p className="text-xs text-slate-500">
                  Track day-by-day or weekly manufacturing output and OEE progression.
                </p>
              </div>
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded">
                <button
                  type="button"
                  onClick={() => setPeriodGranularity("day")}
                  className={`px-3 py-1 text-xs font-bold rounded cursor-pointer transition-colors ${
                    periodGranularity === "day"
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Daily View
                </button>
                <button
                  type="button"
                  onClick={() => setPeriodGranularity("week")}
                  className={`px-3 py-1 text-xs font-bold rounded cursor-pointer transition-colors ${
                    periodGranularity === "week"
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Weekly View
                </button>
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-900 text-slate-100 uppercase text-[10px] font-semibold">
                  <tr>
                    <th className="px-3 py-2.5">
                      {periodGranularity === "day" ? "Date" : "ISO Week Range"}
                    </th>
                    <th className="px-3 py-2.5">Items Produced</th>
                    <th className="px-3 py-2.5 text-right">Target (Std)</th>
                    <th className="px-3 py-2.5 text-right">Actual Output</th>
                    <th className="px-3 py-2.5 text-right">Good Output</th>
                    <th className="px-3 py-2.5 text-right">Rework</th>
                    <th className="px-3 py-2.5 text-right">Downtime</th>
                    <th className="px-3 py-2.5 text-right">Avail %</th>
                    <th className="px-3 py-2.5 text-right">Qual %</th>
                    <th className="px-3 py-2.5 text-right font-black">Period OEE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {periodRollups.map((p) => (
                    <tr key={p.periodKey} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-sans font-bold text-slate-900 whitespace-nowrap">
                        {p.periodLabel}
                      </td>
                      <td className="px-3 py-2 font-sans">
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {p.itemsProduced.slice(0, 3).map((it) => (
                            <span
                              key={it.itemId}
                              className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-medium text-slate-700"
                              title={`${it.itemName}: ${it.actualOutput} pcs`}
                            >
                              {it.itemName}: {it.actualOutput}
                            </span>
                          ))}
                          {p.itemsProduced.length > 3 && (
                            <span className="text-[10px] text-slate-400">
                              +{p.itemsProduced.length - 3} more
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">{p.metrics.totalStd.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-bold text-slate-900">
                        {p.metrics.totalActual.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right text-emerald-700 font-bold">
                        {p.metrics.goodOutput.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right text-amber-600">{p.metrics.totalRework.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-rose-600">{p.metrics.downtimeMinutes}m</td>
                      <td className="px-3 py-2 text-right text-slate-700">{p.metrics.availabilityPct}%</td>
                      <td className="px-3 py-2 text-right text-slate-700">{p.metrics.qualityPct}%</td>
                      <td className="px-3 py-2 text-right">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-black border ${getOeeBadgeClass(
                            p.metrics.oeePct
                          )}`}
                        >
                          {p.metrics.oeePct}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 5: BY MACHINE */}
        {activeTab === "machine" && (
          <div className="p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Machine OEE, Output & Downtime Matrix</h3>
                <p className="text-xs text-slate-500">
                  Comprehensive performance ranking across permanent and temporary machines.
                </p>
              </div>

              {/* Sort Controls */}
              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                <span className="font-semibold text-slate-500">Sort By:</span>
                <select
                  value={machineSortKey}
                  onChange={(e) =>
                    setMachineSortKey(
                      e.target.value as "oee" | "actual" | "downtime" | "name"
                    )
                  }
                  className="bg-slate-50 border border-slate-200 rounded px-2 py-1 font-semibold text-slate-800"
                >
                  <option value="oee">OEE %</option>
                  <option value="actual">Actual Output</option>
                  <option value="downtime">Downtime Minutes</option>
                  <option value="name">Machine Name</option>
                </select>
                <button
                  type="button"
                  onClick={() => setMachineSortOrder(machineSortOrder === "asc" ? "desc" : "asc")}
                  className="p-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer"
                  title="Toggle sort direction"
                >
                  <ArrowUpDown className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-900 text-slate-100 uppercase text-[10px] font-semibold">
                  <tr>
                    <th className="px-3 py-2.5">Machine</th>
                    <th className="px-3 py-2.5">Line</th>
                    <th className="px-3 py-2.5 text-center">Split Runs</th>
                    <th className="px-3 py-2.5 text-right">Target (Std)</th>
                    <th className="px-3 py-2.5 text-right">Actual Output</th>
                    <th className="px-3 py-2.5 text-right">Good Output</th>
                    <th className="px-3 py-2.5 text-right">Rework</th>
                    <th className="px-3 py-2.5 text-right">Downtime</th>
                    <th className="px-3 py-2.5 text-right">Avail %</th>
                    <th className="px-3 py-2.5 text-right">Qual %</th>
                    <th className="px-3 py-2.5 text-right font-black">Machine OEE</th>
                    <th className="px-3 py-2.5 text-center">Jump</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {machineRollups.map((m) => (
                    <tr key={m.machineId} className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-2 font-sans whitespace-nowrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() =>
                              handleSelectAnalyticsMachine(m.machineId)
                            }
                            className="font-bold text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1 cursor-pointer"
                            title="View Machine Analytics Drilldown"
                          >
                            <span>{m.machineName}</span>
                            <ExternalLink className="w-3 h-3 opacity-60" />
                          </button>
                          {m.isTempMachine && (
                            <span className="px-1 py-0.2 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">
                              TEMP
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 font-sans font-medium text-slate-700 whitespace-nowrap">{m.line}</td>
                      <td className="px-3 py-2 text-center">
                        {m.splitRunsCount > 0 ? (
                          <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 text-[10px] font-bold">
                            {m.splitRunsCount} Split
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">{m.metrics.totalStd.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-bold text-slate-900">
                        {m.metrics.totalActual.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right text-emerald-700 font-bold">
                        {m.metrics.goodOutput.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right text-amber-600">{m.metrics.totalRework.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-rose-600">{m.metrics.downtimeMinutes}m</td>
                      <td className="px-3 py-2 text-right text-slate-700">{m.metrics.availabilityPct}%</td>
                      <td className="px-3 py-2 text-right text-slate-700">{m.metrics.qualityPct}%</td>
                      <td className="px-3 py-2 text-right">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-black border ${getOeeBadgeClass(
                            m.metrics.oeePct
                          )}`}
                        >
                          {m.metrics.oeePct}%
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center font-sans">
                        <button
                          type="button"
                          onClick={() =>
                            handleSelectAnalyticsMachine(m.machineId)
                          }
                          className="p-1 text-slate-400 hover:text-blue-600 transition-colors cursor-pointer"
                          title="View Machine Analytics Drilldown"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AnalyticsPreview;
