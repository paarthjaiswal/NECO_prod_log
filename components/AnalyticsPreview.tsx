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
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Cpu,
  ArrowUpDown,
  CheckCircle2,
  Target,
  FileText,
} from "lucide-react";
import {
  MachineShiftRow,
  MasterDataState,
  ShiftType,
  OpenMachineParams,
  ShiftItemProductionRow,
} from "@/types";
import {
  exportHistoricalToCSV,
  exportItemTraceabilityExcel,
  exportFilteredAnalyticsWorkbook,
  exportActiveAnalyticsTabExcel,
  exportDailySheetViewExcel,
} from "@/services/excelExport";
import { buildCanonicalItemKey } from "@/services/storageService";
import { getAnalyticsLogs, getAnalyticsItemProduction } from "@/actions/shiftActions";
import { useFeedback } from "@/context/FeedbackContext";
import {
  computeAllocatedPlannedMinutes,
  calculateOeeMetrics,
  buildProductLineMachineMatrix,
  groupByLine,
  groupByShift,
  groupByPeriod,
  groupByMachine,
  buildGroupedMachineMatrix,
  EnrichedAnalyticsRow,
  OeeMetrics,
  ProductMatrixItem,
  MachineGroupByMode,
  MachineRollupItem,
} from "@/services/analyticsEngine";
import { MachineAnalyticsView } from "./MachineAnalyticsView";
import { ShiftSheetPreviewModal } from "./ShiftSheetPreviewModal";
import { ShiftSheetReadOnlyContent } from "./ShiftSheetReadOnlyContent";
import {
  BD_KEYS,
  DOWNTIME_PALETTE,
  TOTAL_DOWNTIME_THEME,
} from "@/services/downtimePalette";

interface AnalyticsPreviewProps {
  rows: MachineShiftRow[];
  selectedDate: string;
  selectedShift: ShiftType;
  selectedLine: string;
  masterData?: MasterDataState;
  onOpenMachine?: (params: OpenMachineParams) => void;
  onOpenShiftSheet?: (date: string, shift: string, line?: string) => void;
}

type TabType = "product" | "line" | "shift" | "period" | "machine" | "daily_sheet";
type PresetKey = "today" | "yesterday" | "thisWeek" | "lastWeek" | "thisMonth" | "single" | "custom";

function getShortWeekday(dateStr: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return "";
  try {
    const d = new Date(dateStr + "T00:00:00Z");
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return days[d.getUTCDay()] || "";
  } catch {
    return "";
  }
}

function shiftIsoDate(dateStr: string, deltaDays: number): string {
  const parts = (dateStr || "").split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => isNaN(n))) return dateStr;
  const [y, m, d] = parts;
  const next = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return next.toISOString().slice(0, 10);
}

function formatDateWithWeekday(dateStr: string): string {
  if (!dateStr) return "—";
  const wd = getShortWeekday(dateStr);
  return wd ? `${dateStr} (${wd})` : dateStr;
}

function getShortShiftLabel(shift: string): string {
  const s = (shift || "").trim();
  if (/^shift\s*a\b/i.test(s)) return "Shift A";
  if (/^shift\s*b\b/i.test(s)) return "Shift B";
  if (/^shift\s*c\b/i.test(s)) return "Shift C";
  const parenIdx = s.indexOf("(");
  return parenIdx > 0 ? s.slice(0, parenIdx).trim() : s;
}

function compareShiftsCanonicallyLocal(a: string, b: string): number {
  const rank = (sh: string) => {
    const s = (sh || "").trim().toLowerCase();
    if (/^shift\s*a\b/.test(s)) return 1;
    if (/^shift\s*b\b/.test(s)) return 2;
    if (/^shift\s*c\b/.test(s)) return 3;
    return 4;
  };
  const rA = rank(a);
  const rB = rank(b);
  if (rA !== rB) return rA - rB;
  return a.localeCompare(b);
}

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
  onOpenShiftSheet,
}) => {
  const { runWithFeedback, notifySuccess, notifyError } = useFeedback();

  // --------------------------------------------------------------------------
  // DATE RANGE CONTROLS & STATE
  // --------------------------------------------------------------------------
  const initialPresets = useMemo(() => computePresetDates(selectedDate), [selectedDate]);
  const [activePreset, setActivePreset] = useState<PresetKey>("thisWeek");
  const [fromDate, setFromDate] = useState<string>(initialPresets.thisWeek.from);
  const [toDate, setToDate] = useState<string>(initialPresets.thisWeek.to);

  // Data loaded from Supabase
  const [historicalLogs, setHistoricalLogs] = useState<MachineShiftRow[]>([]);
  const [historicalItemProduction, setHistoricalItemProduction] = useState<ShiftItemProductionRow[]>([]);

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
        (["today", "yesterday", "thisWeek", "lastWeek", "thisMonth", "single", "custom"] as const).includes(
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
          const [logsData, itemProdData] = await Promise.all([
            getAnalyticsLogs(from, to),
            getAnalyticsItemProduction(from, to),
          ]);
          setHistoricalLogs(logsData || []);
          setHistoricalItemProduction(itemProdData || []);
          return logsData;
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

  const handleSelectSingleDateMode = () => {
    const targetDate = toDate || fromDate || initialPresets.today.from;
    setActivePreset("single");
    setFromDate(targetDate);
    setToDate(targetDate);
  };

  const handleSingleDateValueChange = (nextDate: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) return;
    setActivePreset("single");
    setFromDate(nextDate);
    setToDate(nextDate);
  };

  const handleSelectCustomRangeMode = () => {
    const fallback = fromDate || toDate || initialPresets.today.from;
    if (!fromDate) setFromDate(fallback);
    if (!toDate) setToDate(fallback);
    setActivePreset("custom");
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
  const [otOnly, setOtOnly] = useState<boolean>(false);

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

    for (const itemProd of historicalItemProduction) {
      if (itemProd.itemName || itemProd.itemId || itemProd.itemKey) {
        const pKey = (itemProd.itemId || itemProd.itemName || itemProd.itemKey || "").trim();
        const pName = itemProd.itemName || itemProd.itemCode || pKey;
        if (pKey && !prodMap.has(pKey)) prodMap.set(pKey, pName);
      }
      if (itemProd.line) lineSet.add(itemProd.line);
      if (itemProd.shift) shiftSet.add(itemProd.shift);
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
  }, [enrichedAllRows, historicalItemProduction, masterData]);

  const hasActiveFacetFilters =
    filterProduct !== "all" ||
    filterLine !== "all" ||
    filterShift !== "all" ||
    filterMachine !== "all" ||
    filterOperator !== "all" ||
    !includeTempMachines ||
    tempOnly ||
    splitRunsOnly ||
    otOnly;

  const handleResetFilters = () => {
    setFilterProduct("all");
    setFilterLine("all");
    setFilterShift("all");
    setFilterMachine("all");
    setFilterOperator("all");
    setIncludeTempMachines(true);
    setTempOnly(false);
    setSplitRunsOnly(false);
    setOtOnly(false);
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
      if (otOnly && (Number(r.overtimeMinutes) || 0) <= 0) {
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
    otOnly,
  ]);

  // Filtered shift-level finished goods totals reflecting active filters
  const filteredShiftItemTotals = useMemo(() => {
    return historicalItemProduction.filter((r) => {
      if (filterLine !== "all" && (r.line || "").toLowerCase() !== filterLine.toLowerCase()) {
        return false;
      }
      if (filterShift !== "all" && (r.shift || "").toLowerCase() !== filterShift.toLowerCase()) {
        return false;
      }
      if (filterProduct !== "all") {
        const target = filterProduct.toLowerCase();
        const matchName = (r.itemName || "").toLowerCase() === target;
        const matchCode = (r.itemCode || "").toLowerCase() === target;
        const matchId = (r.itemId || "").toLowerCase() === target;
        const matchKey = (r.itemKey || "").toLowerCase() === target;
        if (!matchName && !matchCode && !matchId && !matchKey) return false;
      }
      return true;
    });
  }, [historicalItemProduction, filterLine, filterShift, filterProduct]);

  // Total finished goods produced across all items for active filter range
  const totalFinishedProduction = useMemo(() => {
    return filteredShiftItemTotals.reduce((sum, r) => sum + (Number(r.totalProduction) || 0), 0);
  }, [filteredShiftItemTotals]);

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
  const [productMatrixView, setProductMatrixView] = useState<"line_machine" | "operation">("line_machine");
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());

  const [machineSortKey, setMachineSortKey] = useState<"oee" | "actual" | "downtime" | "name">("oee");
  const [machineSortOrder, setMachineSortOrder] = useState<"asc" | "desc">("desc");

  // Tab 1: Product Matrix
  const productMatrix = useMemo(() => {
    const list = buildProductLineMachineMatrix(filteredRows, filteredShiftItemTotals);
    if (!productSearch.trim()) return list;
    const q = productSearch.trim().toLowerCase();
    return list.filter(
      (p) =>
        p.productName.toLowerCase().includes(q) ||
        p.productCode.toLowerCase().includes(q) ||
        p.lines.some((l) => l.toLowerCase().includes(q))
    );
  }, [filteredRows, filteredShiftItemTotals, productSearch]);

  // Tab 2: Line Rollups
  const lineRollups = useMemo(() => {
    return groupByLine(filteredRows, filteredShiftItemTotals);
  }, [filteredRows, filteredShiftItemTotals]);

  // Tab 3: Shift Rollups
  const shiftRollups = useMemo(() => {
    return groupByShift(filteredRows, filteredShiftItemTotals);
  }, [filteredRows, filteredShiftItemTotals]);

  const [expandedTrendDates, setExpandedTrendDates] = useState<Set<string>>(new Set());
  const [expandedShiftKeys, setExpandedShiftKeys] = useState<Set<string>>(new Set());
  const [machineGroupBy, setMachineGroupBy] = useState<MachineGroupByMode>("none");
  const [shiftSheetModal, setShiftSheetModal] = useState<{
    date: string;
    shift: string;
    line?: string;
  } | null>(null);

  const isMachineOrOperatorScoped = filterMachine !== "all" || filterOperator !== "all";
  const hasActiveScopeFilter =
    filterProduct !== "all" ||
    filterMachine !== "all" ||
    filterOperator !== "all" ||
    !includeTempMachines ||
    tempOnly ||
    splitRunsOnly ||
    otOnly;

  // Tab 4: Period Rollups
  const periodRollups = useMemo(() => {
    return groupByPeriod(
      filteredRows,
      periodGranularity,
      filteredShiftItemTotals,
      masterData?.items
    );
  }, [filteredRows, periodGranularity, filteredShiftItemTotals, masterData?.items]);

  // Auto-expand single date row in Chronological Trends when in Single Date mode
  useEffect(() => {
    if (
      activePreset === "single" &&
      periodGranularity === "day" &&
      periodRollups.length === 1
    ) {
      const onlyKey = periodRollups[0].periodKey;
      setExpandedTrendDates((prev) => (prev.has(onlyKey) ? prev : new Set([onlyKey])));
    }
  }, [activePreset, periodGranularity, periodRollups]);

  const toggleExpandTrendDate = (dateKey: string) => {
    setExpandedTrendDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });
  };

  const toggleExpandShift = (shiftKey: string) => {
    setExpandedShiftKeys((prev) => {
      const next = new Set(prev);
      if (next.has(shiftKey)) next.delete(shiftKey);
      else next.add(shiftKey);
      return next;
    });
  };

  const handleChangePeriodGranularity = (mode: "day" | "week") => {
    setPeriodGranularity(mode);
    setExpandedTrendDates(new Set());
  };

  const machineComparator = useCallback(
    (a: MachineRollupItem, b: MachineRollupItem) => {
      let diff = 0;
      if (machineSortKey === "oee") diff = a.metrics.oeePct - b.metrics.oeePct;
      else if (machineSortKey === "actual") diff = a.metrics.totalActual - b.metrics.totalActual;
      else if (machineSortKey === "downtime") diff = a.metrics.downtimeMinutes - b.metrics.downtimeMinutes;
      else diff = a.machineName.localeCompare(b.machineName);
      return machineSortOrder === "desc" ? -diff : diff;
    },
    [machineSortKey, machineSortOrder]
  );

  // Tab 5: Machine Rollups (Flat + Grouped)
  const groupedMachineMatrix = useMemo(() => {
    return buildGroupedMachineMatrix(
      filteredRows,
      machineGroupBy,
      machineComparator,
      filteredShiftItemTotals,
      masterData?.items
    );
  }, [filteredRows, machineGroupBy, machineComparator, filteredShiftItemTotals, masterData?.items]);

  const machineRollups = useMemo(() => {
    return groupByMachine(filteredRows).sort(machineComparator);
  }, [filteredRows, machineComparator]);

  // --------------------------------------------------------------------------
  // TAB 6: DAILY SHEET TAB STATE, FACETS & FILTERING (Zero DB refetch)
  // --------------------------------------------------------------------------
  const availableDailySheetDates = useMemo(() => {
    const dateSet = new Set<string>();
    for (const r of enrichedAllRows) {
      if (r.date) dateSet.add(r.date);
    }
    for (const p of historicalItemProduction) {
      if (p.date) dateSet.add(p.date);
    }
    return Array.from(dateSet).sort((a, b) => b.localeCompare(a));
  }, [enrichedAllRows, historicalItemProduction]);

  const [dsDate, setDsDate] = useState<string>("");
  const [dsLine, setDsLine] = useState<string>("all");
  const [dsShift, setDsShift] = useState<string>("all");
  const [dsItemKey, setDsItemKey] = useState<string>("all");
  const [dsMachineId, setDsMachineId] = useState<string>("all");
  const [dsOperator, setDsOperator] = useState<string>("all");

  // Snap dsDate cleanly when top date range changes (auto-sync when single day is active)
  useEffect(() => {
    if (fromDate && toDate && fromDate === toDate) {
      if (dsDate !== fromDate) setDsDate(fromDate);
      return;
    }
    if (availableDailySheetDates.length === 0) {
      if (dsDate !== "") setDsDate("");
    } else if (!dsDate || !availableDailySheetDates.includes(dsDate)) {
      setDsDate(availableDailySheetDates[0]);
    }
  }, [fromDate, toDate, availableDailySheetDates, dsDate]);

  // Canonical item key resolver across masterData & shift_item_production
  const dsItemResolver = useMemo(() => {
    const idMap = new Map<string, { key: string; code: string; name: string }>();
    const nameMap = new Map<string, { key: string; code: string; name: string }>();
    const codeMap = new Map<string, { key: string; code: string; name: string }>();

    for (const it of masterData?.items || []) {
      const code = (it.itemCode || "").trim();
      const name = (it.itemName || "").trim();
      const key = buildCanonicalItemKey(code, name);
      if (!key) continue;
      const meta = { key, code, name: name || code };
      if (it.id) idMap.set(it.id.trim().toLowerCase(), meta);
      if (name) nameMap.set(name.toLowerCase(), meta);
      if (code) codeMap.set(code.toLowerCase(), meta);
    }
    for (const p of historicalItemProduction) {
      const code = (p.itemCode || "").trim();
      const name = (p.itemName || "").trim();
      const key = (p.itemKey || buildCanonicalItemKey(code, name)).trim().toLowerCase();
      if (!key) continue;
      const meta = { key, code, name: name || code || key };
      if (p.itemId && !idMap.has(p.itemId.trim().toLowerCase())) {
        idMap.set(p.itemId.trim().toLowerCase(), meta);
      }
      if (name && !nameMap.has(name.toLowerCase())) {
        nameMap.set(name.toLowerCase(), meta);
      }
      if (code && !codeMap.has(code.toLowerCase())) {
        codeMap.set(code.toLowerCase(), meta);
      }
    }

    return (rawId?: string | null, rawName?: string | null, rawCode?: string | null) => {
      const nId = (rawId || "").trim().toLowerCase();
      const nName = (rawName || "").trim().toLowerCase();
      const nCode = (rawCode || "").trim().toLowerCase();
      const matched =
        (nCode && codeMap.get(nCode)) ||
        (nId && (idMap.get(nId) || codeMap.get(nId))) ||
        (nName && nameMap.get(nName));
      if (matched) return matched;
      const key = buildCanonicalItemKey(rawCode, rawName) || buildCanonicalItemKey(rawId, undefined);
      if (!key) return null;
      return {
        key,
        code: (rawCode || "").trim(),
        name: (rawName || rawCode || rawId || "").trim() || key,
      };
    };
  }, [masterData?.items, historicalItemProduction]);

  // Sync top-bar filters into Daily Sheet selectors when top-bar filters change
  useEffect(() => {
    setDsLine(filterLine !== "all" ? filterLine : "all");
  }, [filterLine]);

  useEffect(() => {
    setDsShift(filterShift !== "all" ? filterShift : "all");
  }, [filterShift]);

  useEffect(() => {
    if (filterProduct === "all") {
      setDsItemKey("all");
    } else {
      const resolved = dsItemResolver(filterProduct, filterProduct, filterProduct);
      setDsItemKey(resolved ? resolved.key : filterProduct.toLowerCase());
    }
  }, [filterProduct, dsItemResolver]);

  useEffect(() => {
    setDsMachineId(filterMachine !== "all" ? filterMachine : "all");
  }, [filterMachine]);

  useEffect(() => {
    setDsOperator(filterOperator !== "all" ? filterOperator : "all");
  }, [filterOperator]);

  // Dynamic options derived from the selected date
  const dsDateLogs = useMemo(() => {
    if (!dsDate) return [];
    return enrichedAllRows.filter((r) => (r.date || "") === dsDate);
  }, [enrichedAllRows, dsDate]);

  const dsDateProd = useMemo(() => {
    if (!dsDate) return [];
    return historicalItemProduction.filter((p) => (p.date || "") === dsDate);
  }, [historicalItemProduction, dsDate]);

  const dsOptions = useMemo(() => {
    const lineSet = new Set<string>();
    const shiftSet = new Set<string>();
    const itemMap = new Map<string, { key: string; code: string; name: string }>();
    const machineMap = new Map<string, { id: string; name: string }>();
    const operatorSet = new Set<string>();

    for (const r of dsDateLogs) {
      if (r.line) lineSet.add(r.line);
      if (r.shift) shiftSet.add(r.shift);
      const itemMeta = dsItemResolver(r.itemId, r.itemName, undefined);
      if (itemMeta && !itemMap.has(itemMeta.key)) {
        itemMap.set(itemMeta.key, itemMeta);
      }
      const lineMatches =
        dsLine === "all" || (r.line || "").toLowerCase() === dsLine.toLowerCase();
      if (lineMatches) {
        const mId = r.machineId || r.machineName;
        if (mId && !machineMap.has(mId)) {
          machineMap.set(mId, { id: mId, name: r.machineName || mId });
        }
        const op = (r.operatorName || "").trim();
        if (op) operatorSet.add(op);
      }
    }

    for (const p of dsDateProd) {
      if (p.line) lineSet.add(p.line);
      if (p.shift) shiftSet.add(p.shift);
      const itemMeta = dsItemResolver(p.itemId, p.itemName, p.itemCode);
      if (itemMeta && !itemMap.has(itemMeta.key)) {
        itemMap.set(itemMeta.key, itemMeta);
      }
    }

    // Preserve currently selected filter values so dropdowns never trap the user
    if (dsLine !== "all") lineSet.add(dsLine);
    if (dsShift !== "all") shiftSet.add(dsShift);
    if (dsItemKey !== "all" && !itemMap.has(dsItemKey)) {
      itemMap.set(dsItemKey, { key: dsItemKey, code: "", name: dsItemKey });
    }
    if (dsMachineId !== "all" && !machineMap.has(dsMachineId)) {
      const mMatch = availableFacets.machines.find((m) => m.id === dsMachineId);
      machineMap.set(dsMachineId, { id: dsMachineId, name: mMatch?.name || dsMachineId });
    }
    if (dsOperator !== "all") operatorSet.add(dsOperator);

    return {
      lines: Array.from(lineSet).sort((a, b) => a.localeCompare(b)),
      shifts: Array.from(shiftSet).sort(compareShiftsCanonicallyLocal),
      items: Array.from(itemMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
      machines: Array.from(machineMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
      operators: Array.from(operatorSet).sort((a, b) => a.localeCompare(b)),
    };
  }, [
    dsDateLogs,
    dsDateProd,
    dsItemResolver,
    dsLine,
    dsShift,
    dsItemKey,
    dsMachineId,
    dsOperator,
    availableFacets.machines,
  ]);

  const dailySheetRows = useMemo(() => {
    return dsDateLogs.filter((r) => {
      if (dsLine !== "all" && (r.line || "").toLowerCase() !== dsLine.toLowerCase()) {
        return false;
      }
      if (dsShift !== "all" && (r.shift || "").toLowerCase() !== dsShift.toLowerCase()) {
        return false;
      }
      if (dsItemKey !== "all") {
        const meta = dsItemResolver(r.itemId, r.itemName, undefined);
        if (!meta || meta.key !== dsItemKey) return false;
      }
      if (dsMachineId !== "all") {
        const target = dsMachineId.toLowerCase();
        const matchId = (r.machineId || "").toLowerCase() === target;
        const matchName = (r.machineName || "").toLowerCase() === target;
        if (!matchId && !matchName) return false;
      }
      if (
        dsOperator !== "all" &&
        (r.operatorName || "").trim().toLowerCase() !== dsOperator.toLowerCase()
      ) {
        return false;
      }
      return true;
    });
  }, [dsDateLogs, dsLine, dsShift, dsItemKey, dsMachineId, dsOperator, dsItemResolver]);

  const dailySheetItemProdRows = useMemo(() => {
    const base = dsDateProd.filter((p) => {
      if (dsLine !== "all" && (p.line || "").toLowerCase() !== dsLine.toLowerCase()) {
        return false;
      }
      if (dsShift !== "all" && (p.shift || "").toLowerCase() !== dsShift.toLowerCase()) {
        return false;
      }
      if (dsItemKey !== "all") {
        const meta = dsItemResolver(p.itemId, p.itemName, p.itemCode);
        if (!meta || meta.key !== dsItemKey) return false;
      }
      return true;
    });

    // If granular Machine or Operator filter is active, scope Pre-QC rows to (shift, line, itemKey) tuples touched
    if (dsMachineId !== "all" || dsOperator !== "all") {
      const touched = new Set<string>();
      for (const r of dailySheetRows) {
        const meta = dsItemResolver(r.itemId, r.itemName, undefined);
        if (!meta) continue;
        touched.add(
          `${(r.shift || "").toLowerCase()}__${(r.line || "").toLowerCase()}__${meta.key}`
        );
      }
      return base.filter((p) => {
        const meta = dsItemResolver(p.itemId, p.itemName, p.itemCode);
        if (!meta) return false;
        return touched.has(
          `${(p.shift || "").toLowerCase()}__${(p.line || "").toLowerCase()}__${meta.key}`
        );
      });
    }

    return base;
  }, [dsDateProd, dsLine, dsShift, dsItemKey, dsMachineId, dsOperator, dsItemResolver, dailySheetRows]);

  const handleExportDailySheetExcel = useCallback(() => {
    try {
      if (!dsDate || (dailySheetRows.length === 0 && dailySheetItemProdRows.length === 0)) {
        notifyError(
          "No Daily Sheet Data",
          "No shift logs or Pre-QC production entries match the current Daily Sheet filters."
        );
        return;
      }
      const selectedItemObj = dsOptions.items.find((it) => it.key === dsItemKey);
      const selectedMachObj = dsOptions.machines.find((m) => m.id === dsMachineId);
      exportDailySheetViewExcel({
        date: dsDate,
        line: dsLine,
        shift: dsShift,
        itemLabel:
          dsItemKey === "all"
            ? "All Items"
            : selectedItemObj
            ? selectedItemObj.code &&
              selectedItemObj.code.toLowerCase() !== selectedItemObj.name.toLowerCase()
              ? `${selectedItemObj.name} (${selectedItemObj.code})`
              : selectedItemObj.name
            : dsItemKey,
        machineLabel:
          dsMachineId === "all" ? "All Machines" : selectedMachObj?.name || dsMachineId,
        operatorLabel: dsOperator === "all" ? "All Operators" : dsOperator,
        rows: dailySheetRows,
        itemProdRows: dailySheetItemProdRows,
      });
      notifySuccess(
        "Daily Sheet Exported",
        `Exported Daily Shift Sheet for ${dsDate} (${dsLine === "all" ? "All Lines" : dsLine}).`
      );
    } catch (err) {
      console.error("Daily sheet Excel export failed:", err);
      notifyError("Export Failed", "Failed to export Daily Sheet Excel workbook.");
    }
  }, [
    dsDate,
    dsLine,
    dsShift,
    dsItemKey,
    dsMachineId,
    dsOperator,
    dsOptions.items,
    dsOptions.machines,
    dailySheetRows,
    dailySheetItemProdRows,
    notifySuccess,
    notifyError,
  ]);

  const toggleExpandProduct = (key: string) => {
    setExpandedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // --------------------------------------------------------------------------
  // EXPORT HANDLERS & METADATA
  // --------------------------------------------------------------------------
  const activeFiltersMeta = useMemo(
    () => ({
      fromDate,
      toDate,
      line: filterLine !== "all" ? filterLine : undefined,
      shift: filterShift !== "all" ? filterShift : undefined,
      product: filterProduct !== "all" ? filterProduct : undefined,
      machine: filterMachine !== "all" ? filterMachine : undefined,
      operator: filterOperator !== "all" ? filterOperator : undefined,
      includeTemp: includeTempMachines,
      tempOnly,
      splitOnly: splitRunsOnly,
      otOnly,
    }),
    [
      fromDate,
      toDate,
      filterLine,
      filterShift,
      filterProduct,
      filterMachine,
      filterOperator,
      includeTempMachines,
      tempOnly,
      splitRunsOnly,
      otOnly,
    ]
  );

  const handleExportFilteredWorkbook = useCallback(() => {
    try {
      if (filteredRows.length === 0) {
        notifyError("No Data to Export", "The current filters returned 0 records. Adjust filters to export.");
        return;
      }
      exportFilteredAnalyticsWorkbook({
        filteredRows,
        activeFilters: activeFiltersMeta,
        periodGranularity,
        masterData,
        shiftItemTotals: filteredShiftItemTotals,
      });
      notifySuccess(
        "Excel Export Complete",
        `Exported filtered analytics report (${filteredRows.length} logs, ${
          fromDate === toDate ? fromDate : `${fromDate} to ${toDate}`
        }).`
      );
    } catch (err) {
      console.error("Filtered Excel export failed:", err);
      notifyError("Export Failed", "An error occurred while generating the filtered Excel workbook.");
    }
  }, [
    filteredRows,
    activeFiltersMeta,
    periodGranularity,
    masterData,
    filteredShiftItemTotals,
    fromDate,
    toDate,
    notifySuccess,
    notifyError,
  ]);

  const handleExportItemTraceability = useCallback(
    (e: React.MouseEvent, prod: ProductMatrixItem) => {
      e.stopPropagation();
      try {
        const itemRows = filteredRows.filter((r) => {
          const rawName = (r.itemName || "").trim().toLowerCase();
          const rawId = (r.itemId || "").trim().toLowerCase();
          const target = prod.productKey.toLowerCase();
          return rawName === target || rawId === target;
        });

        if (itemRows.length === 0) {
          notifyError(
            "No Item Data",
            `No shift logs found for product "${prod.productName}" with active filters.`
          );
          return;
        }

        exportItemTraceabilityExcel({
          product: prod,
          itemRows,
          activeFilters: activeFiltersMeta,
          shiftItemTotals: filteredShiftItemTotals,
          groupByOperation: productMatrixView === "operation",
        });

        notifySuccess(
          "Product Traceability Exported",
          `Exported multi-sheet workbook for ${prod.productName} (${itemRows.length} machine runs).`
        );
      } catch (err) {
        console.error("Item traceability Excel export failed:", err);
        notifyError("Export Failed", `Failed to generate Excel for ${prod.productName}.`);
      }
    },
    [filteredRows, activeFiltersMeta, filteredShiftItemTotals, productMatrixView, notifySuccess, notifyError]
  );

  const handleExportActiveTab = useCallback(
    (tabKey: TabType) => {
      if (tabKey === "daily_sheet") {
        handleExportDailySheetExcel();
        return;
      }
      try {
        if (filteredRows.length === 0) {
          notifyError("No Data to Export", "The current filters returned 0 records. Adjust filters to export.");
          return;
        }

        exportActiveAnalyticsTabExcel({
          tab: tabKey,
          filteredRows,
          activeFilters: activeFiltersMeta,
          periodGranularity,
          masterData,
          shiftItemTotals: filteredShiftItemTotals,
          machineGroupBy,
          groupedMachines: groupedMachineMatrix,
        });

        const tabNames: Record<Exclude<TabType, "daily_sheet">, string> = {
          product: "Product Traceability Matrix",
          line: "Line Performance Matrix",
          shift: "Shift Efficiency Matrix",
          period:
            periodGranularity === "week"
              ? "Weekly Manufacturing Matrix"
              : "Daily Manufacturing Matrix",
          machine: "Machine Performance Matrix",
        };

        notifySuccess(
          "Tab Export Complete",
          `Exported ${tabNames[tabKey]} (${
            fromDate === toDate ? fromDate : `${fromDate} to ${toDate}`
          }).`
        );
      } catch (err) {
        console.error("Tab Excel export failed:", err);
        notifyError("Export Failed", "An error occurred while generating the tab Excel workbook.");
      }
    },
    [
      handleExportDailySheetExcel,
      filteredRows,
      activeFiltersMeta,
      periodGranularity,
      masterData,
      filteredShiftItemTotals,
      machineGroupBy,
      groupedMachineMatrix,
      fromDate,
      toDate,
      notifySuccess,
      notifyError,
    ]
  );

  const handleExportCSV = () => {
    const rangeTag = fromDate === toDate ? fromDate : `${fromDate}_to_${toDate}`;
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
      <div className="w-full space-y-4 pb-12">
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
    <div className="w-full space-y-4 pb-12">
      {/* ==================================================================== */}
      {/* TOP UNIFIED FILTER BAR (Compact & Responsive)                         */}
      {/* ==================================================================== */}
      <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-2xs space-y-2.5">
        {/* ROW 1: Date Controls (Left) + Export Actions (Right) */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Left: Quick Preset Pills + Date / Custom Range Pickers Together */}
          <div className="flex flex-wrap items-center gap-2">
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
              <button
                type="button"
                onClick={handleSelectSingleDateMode}
                className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors cursor-pointer ${
                  activePreset === "single"
                    ? "bg-blue-700 text-white shadow-2xs"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
                title="Inspect a single specific calendar day"
              >
                Single Date
              </button>
              <button
                type="button"
                onClick={handleSelectCustomRangeMode}
                className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors cursor-pointer ${
                  activePreset === "custom"
                    ? "bg-slate-900 text-white shadow-2xs"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
                title="Select custom From and To dates"
              >
                Custom Range
              </button>
            </div>

            {/* Date Pickers + Apply (Right next to Range pills on the left) */}
            <div className="flex items-center gap-1.5 flex-wrap sm:pl-2 sm:border-l sm:border-slate-200">
              {activePreset === "single" ? (
                <div className="flex items-center bg-slate-50 border border-blue-200 rounded overflow-hidden">
                  <button
                    type="button"
                    title="Previous day"
                    onClick={() => handleSingleDateValueChange(shiftIsoDate(fromDate, -1))}
                    className="px-2 py-1 text-slate-600 hover:text-slate-900 hover:bg-slate-200/80 border-r border-slate-200 transition-colors cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-slate-700">
                    <input
                      type="date"
                      value={fromDate}
                      onChange={(e) => {
                        if (e.target.value) {
                          handleSingleDateValueChange(e.target.value);
                        }
                      }}
                      className="bg-transparent text-xs font-mono font-semibold text-slate-900 focus:outline-none cursor-pointer"
                    />
                    {getShortWeekday(fromDate) && (
                      <span className="px-1.5 py-0.2 rounded bg-blue-100 text-blue-800 text-[10px] font-bold">
                        {getShortWeekday(fromDate)}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    title="Next day"
                    onClick={() => handleSingleDateValueChange(shiftIsoDate(fromDate, 1))}
                    className="px-2 py-1 text-slate-600 hover:text-slate-900 hover:bg-slate-200/80 border-l border-slate-200 transition-colors cursor-pointer"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <>
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
                </>
              )}
            </div>
          </div>

          {/* Right: Export buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={filteredRows.length === 0}
              onClick={handleExportFilteredWorkbook}
              className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-xs font-bold flex items-center gap-1.5 shadow-2xs cursor-pointer transition-colors"
              title="Export complete filter-aware multi-sheet Excel workbook"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Export Filtered Excel</span>
            </button>
            <button
              type="button"
              disabled={filteredRows.length === 0}
              onClick={handleExportCSV}
              className="px-2 py-1 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 rounded text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
              title="Export raw shift logs as CSV"
            >
              <Download className="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>
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

            <button
              type="button"
              onClick={() => setOtOnly(!otOnly)}
              className={`px-2 py-0.5 text-[11px] font-semibold rounded border cursor-pointer transition-colors ${
                otOnly
                  ? "bg-amber-100 text-amber-950 border-amber-400 font-bold"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
              title="Filter only runs where machine overtime (OT > 0) was logged"
            >
              OT Only
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
          <div className="text-[11px] font-mono flex items-center justify-between pt-2 border-t border-current/20 opacity-90 gap-1 flex-wrap">
            <span>Oper: {overallMetrics.operatingMinutes.toFixed(1)}m</span>
            <span>Plan: {overallMetrics.plannedMinutes.toFixed(1)}m</span>
            {overallMetrics.totalOvertimeMinutes > 0 && (
              <span className="px-1 py-0.2 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold">
                +{overallMetrics.totalOvertimeMinutes}m OT
              </span>
            )}
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
              <span className={`font-mono font-bold ${TOTAL_DOWNTIME_THEME.textClass}`}>
                {overallMetrics.downtimeMinutes.toLocaleString()} m
              </span>
            </div>
            {overallMetrics.totalOvertimeMinutes > 0 && (
              <div className="flex justify-between">
                <span className="text-amber-700 font-semibold">OT Logged:</span>
                <span className="font-mono font-bold text-amber-800">
                  {(overallMetrics.totalOvertimeMinutes / 60).toFixed(1)} hrs ({overallMetrics.totalOvertimeMinutes.toLocaleString()} mins)
                </span>
              </div>
            )}
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
            <div className="flex justify-between items-baseline pt-1 border-t border-slate-100">
              <div>
                <span className="text-emerald-700 font-semibold flex items-center gap-1">
                  <Package className="w-3 h-3" />
                  <span>Total Prod (Pre-QC):</span>
                </span>
                <span className="text-[10px] text-slate-400 block font-normal ml-4">
                  Pre-QC (100% Assumed)
                </span>
              </div>
              <span className="font-mono font-bold text-emerald-700">
                {totalFinishedProduction.toLocaleString()} pcs
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
            <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${TOTAL_DOWNTIME_THEME.dotBgClass}`} />
              <span>7 Breakdown Categories:</span>
            </span>
            <span className="text-slate-500 text-[11px]">
              Total Downtime: <strong className={`font-mono ${TOTAL_DOWNTIME_THEME.textClass}`}>{overallMetrics.downtimeMinutes} mins</strong>
            </span>
          </div>

          <div className="flex items-center gap-2 text-[11px] font-mono">
            {overallMetrics.totalOvertimeMinutes > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-bold">
                {overallMetrics.overtimeRowsCount} OT Runs (+{overallMetrics.totalOvertimeMinutes}m)
              </span>
            )}
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
          <div className="w-full h-2.5 rounded-full overflow-hidden flex bg-slate-100">
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

        {/* Breakdown category chips */}
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2 pt-1">
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
            { id: "daily_sheet", label: "Daily Sheet", icon: FileText },
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
              <div className="flex items-center gap-2 flex-wrap">
                {/* Segmented View Toggle */}
                <div className="inline-flex p-0.5 bg-slate-100 border border-slate-200 rounded-md">
                  <button
                    type="button"
                    onClick={() => setProductMatrixView("line_machine")}
                    className={`px-2.5 py-1 text-xs font-bold rounded transition-colors cursor-pointer ${
                      productMatrixView === "line_machine"
                        ? "bg-white text-slate-900 shadow-2xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    By Line & Machine
                  </button>
                  <button
                    type="button"
                    onClick={() => setProductMatrixView("operation")}
                    className={`px-2.5 py-1 text-xs font-bold rounded transition-colors cursor-pointer ${
                      productMatrixView === "operation"
                        ? "bg-white text-slate-900 shadow-2xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    By Operation (Combined)
                  </button>
                </div>

                <div className="relative w-64 sm:w-72">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search Product Name or Code..."
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded focus:border-slate-800 focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  disabled={productMatrix.length === 0}
                  onClick={() => handleExportActiveTab("product")}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed rounded shadow-2xs transition-colors cursor-pointer"
                  title="Export Product Traceability Matrix to Excel"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Export Product Matrix</span>
                </button>
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
                          <div className="text-right px-2.5 py-1 bg-emerald-50 rounded border border-emerald-200">
                            <span className="text-[10px] text-emerald-700 font-bold uppercase block tracking-wider">
                              Total Prod (Pre-QC)
                            </span>
                            <span className="font-mono font-extrabold text-emerald-800 text-xs">
                              {(prod.preQcProduction ?? prod.finishedProduction ?? 0).toLocaleString()} pcs
                            </span>
                            <span className="text-[9px] text-emerald-600 block font-medium">
                              QC Pass: 100% (Assumed)
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-[10px] text-slate-500 uppercase block">Machine Ops</span>
                            <span className="font-mono font-bold text-slate-900">
                              {prod.metrics.totalActual.toLocaleString()} ops
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-[10px] text-slate-500 uppercase block">Good Ops</span>
                            <span className="font-mono font-bold text-emerald-700">
                              {prod.metrics.goodOutput.toLocaleString()} ops
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-[10px] text-slate-500 uppercase block">In-Proc Rework</span>
                            <span className="font-mono font-bold text-amber-600">
                              {prod.metrics.totalRework.toLocaleString()} ops
                            </span>
                          </div>
                          <div className="text-right pl-2 border-l border-slate-200">
                            <span className="text-[10px] text-slate-500 uppercase block">Machine OEE</span>
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-black border ${getOeeBadgeClass(
                                prod.metrics.oeePct
                              )}`}
                            >
                              {prod.metrics.oeePct}%
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => handleExportItemTraceability(e, prod)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-white bg-emerald-700 hover:bg-emerald-600 rounded shadow-2xs transition-colors cursor-pointer ml-1"
                            title={`Export multi-sheet Excel workbook for ${prod.productName}`}
                          >
                            <FileSpreadsheet className="w-3 h-3" />
                            <span>Export Excel</span>
                          </button>
                        </div>
                      </div>

                      {/* Product Expanded Line & Machine Matrix Table */}
                      {isExpanded && (
                        <div className="border-t border-slate-200">
                          <div className="bg-slate-100/80 px-3 py-1.5 border-b border-slate-200 flex items-center justify-between text-xs font-semibold text-slate-700">
                            <span className="flex items-center gap-1.5">
                              <Cpu className="w-3.5 h-3.5 text-blue-600" />
                              <span>
                                {productMatrixView === "operation"
                                  ? `Operation Groups (${prod.operationGroups.length}) · ${prod.matrix.length} Machine Allocations`
                                  : `Machine Allocations (${prod.matrix.length})`}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={(e) => handleExportItemTraceability(e, prod)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 rounded transition-colors cursor-pointer"
                              title={`Export multi-sheet Excel workbook for ${prod.productName}`}
                            >
                              <FileSpreadsheet className="w-3 h-3" />
                              <span>Export Item Excel</span>
                            </button>
                          </div>
                          <div className="overflow-x-auto">
                            {productMatrixView === "operation" ? (
                              <table className="w-full text-xs text-left">
                                <thead className="bg-slate-900 text-slate-100 uppercase text-[10px] font-semibold">
                                  <tr>
                                    <th className="px-3 py-2">Operation</th>
                                    <th className="px-3 py-2">Machine</th>
                                    <th className="px-3 py-2">Line</th>
                                    <th className="px-3 py-2 text-center">Runs</th>
                                    <th className="px-3 py-2 text-right">Actual / Target</th>
                                    <th className="px-3 py-2 text-right">Rework</th>
                                    <th className="px-3 py-2 text-right">BD (m)</th>
                                    <th className="px-3 py-2 text-right">Avail %</th>
                                    <th className="px-3 py-2 text-right">Qual %</th>
                                    <th className="px-3 py-2 text-right font-black">OEE %</th>
                                    <th className="px-3 py-2 text-right font-bold text-sky-300">Op Combined Prod</th>
                                    <th className="px-3 py-2 text-center">Jump</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {prod.operationGroups.length === 0 ? (
                                    <tr>
                                      <td colSpan={12} className="px-3 py-4 text-center text-slate-400 italic font-sans">
                                        No machine operations recorded for this item.
                                      </td>
                                    </tr>
                                  ) : (
                                    prod.operationGroups.map((group, gIdx) =>
                                      group.machines.map((m, mIdx) => (
                                        <tr
                                          key={`${group.operationKey}_${m.machineId}_${m.line}_${mIdx}`}
                                          className={`hover:bg-slate-50 transition-colors ${
                                            gIdx > 0 && mIdx === 0
                                              ? "border-t-2 border-slate-300"
                                              : "border-t border-slate-200"
                                          }`}
                                        >
                                          {/* Operation Name with Rowspan */}
                                          {mIdx === 0 && (
                                            <td
                                              rowSpan={group.machines.length}
                                              className="px-3 py-2 font-sans font-semibold text-slate-800 align-top bg-slate-50/60 border-r border-slate-200"
                                            >
                                              <div className="flex items-start justify-between gap-1.5">
                                                <span className="font-bold text-slate-900">{group.operation}</span>
                                                <span
                                                  className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                                                    group.machinesCount > 1
                                                      ? "bg-indigo-100 text-indigo-800 border border-indigo-200"
                                                      : "bg-slate-200 text-slate-700"
                                                  }`}
                                                >
                                                  {group.machinesCount} {group.machinesCount === 1 ? "M/c" : "M/cs"}
                                                </span>
                                              </div>
                                            </td>
                                          )}

                                          {/* Machine Name & TEMP Badge */}
                                          <td className="px-3 py-2 font-sans">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                              <button
                                                type="button"
                                                onClick={() => handleSelectAnalyticsMachine(m.machineId)}
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

                                          {/* Line */}
                                          <td className="px-3 py-2 font-sans font-medium text-slate-700 whitespace-nowrap">
                                            {m.line}
                                          </td>

                                          {/* Runs */}
                                          <td className="px-3 py-2 text-center font-mono">
                                            {m.splitRunsCount > 0 ? (
                                              <span
                                                className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 text-[10px] font-bold font-sans"
                                                title={
                                                  m.hasMergedDt
                                                    ? "Shift downtime allocated across split runs"
                                                    : "Split machine runs"
                                                }
                                              >
                                                Split ({m.splitRunsCount})
                                              </span>
                                            ) : (
                                              <span className="text-slate-400">{m.runsCount || 1}</span>
                                            )}
                                          </td>

                                          {/* Actual / Target with Plan % */}
                                          <td className="px-3 py-2 text-right font-mono">
                                            <div className="font-bold text-slate-900">
                                              {m.actualOutput.toLocaleString()}{" "}
                                              <span className="text-slate-400 font-normal">
                                                / {m.stdOutput.toLocaleString()}
                                              </span>
                                            </div>
                                            <div className="text-[10px] text-slate-500 font-sans">
                                              {m.planAchievementPct}% Plan
                                            </div>
                                          </td>

                                          {/* Rework */}
                                          <td className="px-3 py-2 text-right font-mono text-amber-600">
                                            {m.rework.toLocaleString()}
                                          </td>

                                          {/* Downtime (m) */}
                                          <td className={`px-3 py-2 text-right font-mono ${TOTAL_DOWNTIME_THEME.textClass}`}>
                                            {m.downtimeMinutes}m
                                          </td>

                                          {/* Avail % */}
                                          <td className="px-3 py-2 text-right font-mono text-slate-700">
                                            {m.availabilityPct}%
                                          </td>

                                          {/* Qual % */}
                                          <td className="px-3 py-2 text-right font-mono text-slate-700">
                                            {m.qualityPct}%
                                          </td>

                                          {/* OEE % */}
                                          <td className="px-3 py-2 text-right font-mono font-black">
                                            <span
                                              className={`px-1.5 py-0.5 rounded text-[11px] font-extrabold border ${getOeeBadgeClass(
                                                m.oeePct
                                              )}`}
                                            >
                                              {m.oeePct}%
                                            </span>
                                          </td>

                                          {/* Op Combined Prod with Rowspan */}
                                          {mIdx === 0 && (
                                            <td
                                              rowSpan={group.machines.length}
                                              className="px-3 py-2 text-right bg-sky-50/50 align-middle border-l border-slate-200"
                                            >
                                              <div className="font-mono font-black text-slate-900 text-xs">
                                                {group.combinedActualOutput.toLocaleString()} pcs
                                              </div>
                                              <div className="text-[10px] text-slate-500 font-sans">
                                                Std: {group.combinedStdOutput.toLocaleString()} ·{" "}
                                                <span className="font-semibold text-slate-700">
                                                  {group.combinedPlanAchievementPct}%
                                                </span>
                                              </div>
                                              <div className="mt-0.5">
                                                <span
                                                  className={`inline-block px-1.5 py-0.2 rounded text-[10px] font-extrabold border ${getOeeBadgeClass(
                                                    group.combinedOeePct
                                                  )}`}
                                                >
                                                  Op OEE: {group.combinedOeePct}%
                                                </span>
                                              </div>
                                            </td>
                                          )}

                                          {/* Jump Button */}
                                          <td className="px-3 py-2 text-center font-sans">
                                            <button
                                              type="button"
                                              onClick={() => handleSelectAnalyticsMachine(m.machineId)}
                                              className="p-1 text-slate-400 hover:text-blue-600 transition-colors cursor-pointer"
                                              title="View Machine Analytics Drilldown"
                                            >
                                              <ExternalLink className="w-3.5 h-3.5" />
                                            </button>
                                          </td>
                                        </tr>
                                      ))
                                    )
                                  )}
                                </tbody>
                              </table>
                            ) : (
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
                                          <span
                                            className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 text-[10px] font-bold"
                                            title={
                                              m.hasMergedDt
                                                ? "Shift downtime allocated across split runs"
                                                : "Split machine runs"
                                            }
                                          >
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
                                      <td className={`px-3 py-2 text-right ${TOTAL_DOWNTIME_THEME.textClass}`}>{m.breakdownMinutes}m</td>
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
                            )}
                          </div>
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Production Line Performance & OEE Comparison</h3>
                <p className="text-xs text-slate-500">
                  Line-by-line efficiency, downtime, and item breakdown across the selected period.
                </p>
              </div>
              <button
                type="button"
                disabled={lineRollups.length === 0}
                onClick={() => handleExportActiveTab("line")}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed rounded shadow-2xs transition-colors cursor-pointer"
                title="Export Line Performance Matrix to Excel"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Export Line Matrix</span>
              </button>
            </div>

            <div className="overflow-x-auto overflow-y-auto max-h-[68vh] border border-slate-200 rounded-lg">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-900 text-slate-100 uppercase text-[10px] font-semibold sticky top-0 z-20 shadow-xs">
                  <tr>
                    <th className="px-3 py-2.5">Line Name</th>
                    <th className="px-3 py-2.5 text-center">Machines (Perm / Temp)</th>
                    <th className="px-3 py-2.5 text-right">Target (Std)</th>
                    <th className="px-3 py-2.5 text-right">Actual Output</th>
                    <th className="px-3 py-2.5 text-right">Good Output</th>
                    <th className="px-3 py-2.5 text-right text-emerald-400" title="Authoritative Total Production (Pre-QC - 100% Assumed Passed)">Total Prod (Pre-QC)</th>
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
                      <td className="px-3 py-2 font-sans font-bold text-slate-900 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span>{l.line}</span>
                          {l.metrics.totalOvertimeMinutes > 0 && (
                            <span className="px-1.5 py-0.2 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-mono font-bold">
                              +{l.metrics.totalOvertimeMinutes}m OT
                            </span>
                          )}
                        </div>
                      </td>
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
                      <td className="px-3 py-2 text-right text-emerald-700 font-black bg-emerald-50/50">
                        {(l.preQcProduction ?? l.finishedProduction ?? 0).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right text-amber-600">{l.metrics.totalRework.toLocaleString()}</td>
                      <td className={`px-3 py-2 text-right ${TOTAL_DOWNTIME_THEME.textClass}`}>{l.metrics.downtimeMinutes}m</td>
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Shift-Wise Efficiency & OEE Comparison</h3>
                <p className="text-xs text-slate-500">
                  Analysis across Shift A, Shift B, and Shift C. Click any shift row to inspect day-by-day shift sheets.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {shiftRollups.length > 0 && (
                  <div className="inline-flex items-center gap-1 bg-slate-100 border border-slate-200 p-0.5 rounded">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedShiftKeys(new Set(shiftRollups.map((s) => s.shift)))
                      }
                      className="px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-white hover:text-slate-900 rounded transition-colors cursor-pointer"
                    >
                      Expand All
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedShiftKeys(new Set())}
                      disabled={expandedShiftKeys.size === 0}
                      className="px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-white hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors cursor-pointer"
                    >
                      Collapse All
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  disabled={shiftRollups.length === 0}
                  onClick={() => handleExportActiveTab("shift")}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed rounded shadow-2xs transition-colors cursor-pointer"
                  title="Export Shift Efficiency Matrix to Excel"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Export Shift Matrix</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto overflow-y-auto max-h-[68vh] border border-slate-200 rounded-lg">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-900 text-slate-100 uppercase text-[10px] font-semibold sticky top-0 z-20 shadow-xs">
                  <tr>
                    <th className="px-3 py-2.5">Shift Name</th>
                    <th className="px-3 py-2.5 text-center">Active Machines</th>
                    <th className="px-3 py-2.5 text-right">Target (Std)</th>
                    <th className="px-3 py-2.5 text-right">Actual Output</th>
                    <th className="px-3 py-2.5 text-right">Good Output</th>
                    <th className="px-3 py-2.5 text-right text-emerald-400" title="Authoritative Total Production (Pre-QC - 100% Assumed Passed)">Total Prod (Pre-QC)</th>
                    <th className="px-3 py-2.5 text-right">Rework</th>
                    <th className="px-3 py-2.5 text-right">Downtime</th>
                    <th className="px-3 py-2.5 text-right">Availability</th>
                    <th className="px-3 py-2.5 text-right">Quality</th>
                    <th className="px-3 py-2.5 text-right font-black">Shift OEE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {shiftRollups.map((s) => {
                    const isExpanded = expandedShiftKeys.has(s.shift);
                    return (
                      <React.Fragment key={s.shift}>
                        <tr
                          onClick={() => toggleExpandShift(s.shift)}
                          className={`cursor-pointer transition-colors ${
                            isExpanded ? "bg-sky-50/50" : "hover:bg-slate-50"
                          }`}
                        >
                          <td className="px-3 py-2 font-sans font-bold text-slate-900 whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              {isExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              )}
                              <span>{s.shift}</span>
                              <span className="text-[10px] font-normal text-slate-400">
                                ({s.dailyEntries.length} {s.dailyEntries.length === 1 ? "day" : "days"})
                              </span>
                              {s.metrics.totalOvertimeMinutes > 0 && (
                                <span className="px-1.5 py-0.2 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-mono font-bold">
                                  +{s.metrics.totalOvertimeMinutes}m OT
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-center font-sans text-slate-600">{s.machineCount}</td>
                          <td className="px-3 py-2 text-right text-slate-600">{s.metrics.totalStd.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right font-bold text-slate-900">
                            {s.metrics.totalActual.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-right text-emerald-700 font-bold">
                            {s.metrics.goodOutput.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-right text-emerald-700 font-black bg-emerald-50/50">
                            {(s.preQcProduction ?? s.finishedProduction ?? 0).toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-right text-amber-600">{s.metrics.totalRework.toLocaleString()}</td>
                          <td className={`px-3 py-2 text-right ${TOTAL_DOWNTIME_THEME.textClass}`}>{s.metrics.downtimeMinutes}m</td>
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

                        {isExpanded && (
                          <tr className="bg-slate-50/80">
                            <td colSpan={11} className="p-0 border-b border-slate-200 font-sans">
                              <div className="p-3 space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="text-xs font-extrabold text-slate-800">
                                    {s.shift} — Day-by-Day Shift Breakdown ({s.dailyEntries.length} entries)
                                  </span>
                                  {isMachineOrOperatorScoped && (
                                    <span className="text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                                      Pre-QC totals reflect full shift counts
                                    </span>
                                  )}
                                </div>

                                <div className="overflow-x-auto bg-white border border-slate-200 rounded-md shadow-2xs">
                                  <table className="w-full text-xs text-left">
                                    <thead className="bg-slate-800 text-slate-100 uppercase text-[10px] font-semibold">
                                      <tr>
                                        <th className="px-3 py-2">Date</th>
                                        <th className="px-3 py-2">Line</th>
                                        <th className="px-3 py-2 text-center">Machines</th>
                                        <th className="px-3 py-2 text-right text-emerald-300">Total Prod (Pre-QC)</th>
                                        <th className="px-3 py-2 text-right">Machine Ops (Act / Std)</th>
                                        <th className="px-3 py-2 text-right">Plan %</th>
                                        <th className="px-3 py-2 text-right">Rework</th>
                                        <th className="px-3 py-2 text-right">BD (m)</th>
                                        <th className="px-3 py-2 text-right">Avail %</th>
                                        <th className="px-3 py-2 text-right">Qual %</th>
                                        <th className="px-3 py-2 text-right font-black">OEE %</th>
                                        <th className="px-3 py-2 text-center">Actions</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200">
                                      {s.dailyEntries.length === 0 ? (
                                        <tr>
                                          <td colSpan={12} className="px-3 py-4 text-center text-slate-400 italic">
                                            No daily shift records found for this shift.
                                          </td>
                                        </tr>
                                      ) : (
                                        s.dailyEntries.map((entry) => (
                                          <tr
                                            key={`${entry.date}_${entry.line}`}
                                            className="hover:bg-slate-50/80 transition-colors"
                                          >
                                            <td className="px-3 py-2 font-mono font-bold text-slate-900 whitespace-nowrap">
                                              {entry.date}
                                            </td>
                                            <td className="px-3 py-2 font-sans font-semibold text-slate-700 whitespace-nowrap">
                                              {entry.line}
                                            </td>
                                            <td className="px-3 py-2 text-center font-mono text-slate-600">
                                              {entry.machinesCount}
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono tabular-nums bg-emerald-50/40">
                                              {entry.qc.hasLoggedProduction ? (
                                                <span className="font-extrabold text-emerald-800">
                                                  {entry.qc.preQcProduction.toLocaleString()} pcs
                                                </span>
                                              ) : (
                                                <span className="text-slate-400 text-[11px] font-sans">
                                                  0 (Not Logged)
                                                </span>
                                              )}
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono tabular-nums">
                                              <span className="font-bold text-slate-900">
                                                {entry.machineOpsActual.toLocaleString()}
                                              </span>{" "}
                                              <span className="text-slate-400">
                                                / {entry.machineOpsStd.toLocaleString()}
                                              </span>
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">
                                              {entry.planAchievementPct}%
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono tabular-nums">
                                              {entry.rework > 0 ? (
                                                <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 font-bold">
                                                  {entry.rework.toLocaleString()}
                                                </span>
                                              ) : (
                                                <span className="text-slate-400">0</span>
                                              )}
                                            </td>
                                            <td className={`px-3 py-2 text-right font-mono tabular-nums ${TOTAL_DOWNTIME_THEME.textClass}`}>
                                              {entry.downtimeMinutes}m
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">
                                              {entry.availabilityPct}%
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">
                                              {entry.qualityPct}%
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono tabular-nums">
                                              <span
                                                className={`px-1.5 py-0.5 rounded text-[11px] font-extrabold border ${getOeeBadgeClass(
                                                  entry.oeePct
                                                )}`}
                                              >
                                                {entry.oeePct}%
                                              </span>
                                            </td>
                                            <td className="px-3 py-2 text-center whitespace-nowrap">
                                              <div className="inline-flex items-center gap-1">
                                                <button
                                                  type="button"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setShiftSheetModal({
                                                      date: entry.date,
                                                      shift: entry.shift,
                                                      line: entry.line,
                                                    });
                                                  }}
                                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded transition-colors cursor-pointer"
                                                  title="Inspect full Daily Shift Sheet layout"
                                                >
                                                  <FileText className="w-3 h-3" />
                                                  <span>View Shift Sheet</span>
                                                </button>
                                                {onOpenShiftSheet && (
                                                  <button
                                                    type="button"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      onOpenShiftSheet(entry.date, entry.shift, entry.line);
                                                    }}
                                                    className="inline-flex items-center gap-0.5 px-1.5 py-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded transition-colors cursor-pointer"
                                                    title="Jump to editable Daily Shift Sheet tab"
                                                  >
                                                    <span>Open</span>
                                                    <ExternalLink className="w-2.5 h-2.5" />
                                                  </button>
                                                )}
                                              </div>
                                            </td>
                                          </tr>
                                        ))
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
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
                  {periodGranularity === "day"
                    ? "Track day-by-day output and OEE. Click any date row to expand its Shift A / B / C × Item breakdown."
                    : "Track weekly manufacturing output and OEE progression."}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {periodGranularity === "day" && periodRollups.length > 0 && (
                  <div className="inline-flex items-center gap-1 bg-slate-100 border border-slate-200 p-0.5 rounded">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedTrendDates(new Set(periodRollups.map((p) => p.periodKey)))
                      }
                      className="px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-white hover:text-slate-900 rounded transition-colors cursor-pointer"
                    >
                      Expand All
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedTrendDates(new Set())}
                      disabled={expandedTrendDates.size === 0}
                      className="px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-white hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors cursor-pointer"
                    >
                      Collapse All
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded">
                  <button
                    type="button"
                    onClick={() => handleChangePeriodGranularity("day")}
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
                    onClick={() => handleChangePeriodGranularity("week")}
                    className={`px-3 py-1 text-xs font-bold rounded cursor-pointer transition-colors ${
                      periodGranularity === "week"
                        ? "bg-white text-slate-900 shadow-2xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Weekly View
                  </button>
                </div>
                <button
                  type="button"
                  disabled={periodRollups.length === 0}
                  onClick={() => handleExportActiveTab("period")}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed rounded shadow-2xs transition-colors cursor-pointer"
                  title={`Export ${periodGranularity === "week" ? "Weekly" : "Daily"} Manufacturing Matrix to Excel`}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Export {periodGranularity === "week" ? "Weekly" : "Daily"} Matrix</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto overflow-y-auto max-h-[68vh] border border-slate-200 rounded-lg">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-900 text-slate-100 uppercase text-[10px] font-semibold sticky top-0 z-20 shadow-xs">
                  <tr>
                    <th className="px-3 py-2.5">
                      {periodGranularity === "day" ? "Date" : "ISO Week Range"}
                    </th>
                    <th className="px-3 py-2.5">Items Produced</th>
                    <th className="px-3 py-2.5 text-right">Target (Std)</th>
                    <th className="px-3 py-2.5 text-right">Actual Output</th>
                    <th className="px-3 py-2.5 text-right">Good Output</th>
                    <th className="px-3 py-2.5 text-right text-emerald-400" title="Authoritative Total Production (Pre-QC - 100% Assumed Passed)">Total Prod (Pre-QC)</th>
                    <th className="px-3 py-2.5 text-right">Rework</th>
                    <th className="px-3 py-2.5 text-right">Downtime</th>
                    <th className="px-3 py-2.5 text-right">Avail %</th>
                    <th className="px-3 py-2.5 text-right">Qual %</th>
                    <th className="px-3 py-2.5 text-right font-black">Period OEE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {periodRollups.map((p) => {
                    const isDayMode = periodGranularity === "day";
                    const isExpanded = isDayMode && expandedTrendDates.has(p.periodKey);

                    return (
                      <React.Fragment key={p.periodKey}>
                        <tr
                          onClick={isDayMode ? () => toggleExpandTrendDate(p.periodKey) : undefined}
                          className={`transition-colors ${
                            isDayMode
                              ? isExpanded
                                ? "bg-sky-50/50 cursor-pointer"
                                : "hover:bg-slate-50 cursor-pointer"
                              : "hover:bg-slate-50"
                          }`}
                        >
                          <td className="px-3 py-2 font-sans font-bold text-slate-900 whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              {isDayMode && (
                                <span className="text-slate-500">
                                  {isExpanded ? (
                                    <ChevronDown className="w-3.5 h-3.5 text-blue-600" />
                                  ) : (
                                    <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                                  )}
                                </span>
                              )}
                              <span>{p.periodLabel}</span>
                              {p.metrics.totalOvertimeMinutes > 0 && (
                                <span className="px-1.5 py-0.2 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-mono font-bold">
                                  +{p.metrics.totalOvertimeMinutes}m OT
                                </span>
                              )}
                            </div>
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
                          <td className="px-3 py-2 text-right text-emerald-700 font-black bg-emerald-50/50">
                            {(p.preQcProduction ?? p.finishedProduction ?? 0).toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-right text-amber-600">{p.metrics.totalRework.toLocaleString()}</td>
                          <td className={`px-3 py-2 text-right ${TOTAL_DOWNTIME_THEME.textClass}`}>{p.metrics.downtimeMinutes}m</td>
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

                        {isExpanded && (
                          <tr className="bg-slate-50/80">
                            <td colSpan={11} className="p-0 border-b border-slate-200 font-sans">
                              <div className="p-3 space-y-2.5">
                                {/* Mini Header Strip */}
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs font-extrabold text-slate-800">
                                      {p.periodLabel} — Shift-Wise Item Production
                                    </span>
                                    {isMachineOrOperatorScoped && (
                                      <span className="text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                                        Pre-QC totals reflect full shift counts
                                      </span>
                                    )}
                                  </div>
                                  {p.shiftTotals.length > 0 && (
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      {p.shiftTotals.map((st) => (
                                        <span
                                          key={st.shift}
                                          title={`${st.shift} · OEE ${st.oeePct}%`}
                                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-slate-200 text-[11px] text-slate-700 shadow-2xs"
                                        >
                                          <span className="font-bold text-slate-900">
                                            {st.shiftShortLabel}:
                                          </span>
                                          <span className="font-mono font-bold text-emerald-700">
                                            {st.preQcProduction.toLocaleString()} pcs
                                          </span>
                                          <span className="text-slate-400">
                                            (Ops:{" "}
                                            <span className="font-mono font-semibold text-slate-700">
                                              {st.machineOpsActual.toLocaleString()}
                                            </span>
                                            )
                                          </span>
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>

                                {/* Nested Item x Shift Table */}
                                <div className="overflow-x-auto bg-white border border-slate-200 rounded-md shadow-2xs">
                                  <table className="w-full text-xs text-left">
                                    <thead className="bg-slate-800 text-slate-100 uppercase text-[10px] font-semibold">
                                      <tr>
                                        <th className="px-3 py-2">Item</th>
                                        <th className="px-3 py-2">Shift</th>
                                        <th className="px-3 py-2 text-right text-emerald-300">
                                          Total Prod (Pre-QC)
                                        </th>
                                        <th
                                          className="px-3 py-2 text-right text-emerald-300"
                                          title="100% QC Pass Assumed pending QC module"
                                        >
                                          QC Passed (100%*)
                                        </th>
                                        <th className="px-3 py-2 text-right">Machine Ops (Act / Std)</th>
                                        <th className="px-3 py-2 text-right">Rework</th>
                                        <th className="px-3 py-2 text-right">BD (m)</th>
                                        <th className="px-3 py-2 text-right">Avail %</th>
                                        <th className="px-3 py-2 text-right">Qual %</th>
                                        <th className="px-3 py-2 text-right font-black">OEE %</th>
                                        <th className="px-3 py-2 text-center">Action</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {p.itemShiftBreakdown.length === 0 ? (
                                        <tr>
                                          <td
                                            colSpan={11}
                                            className="px-3 py-4 text-center text-slate-400 italic"
                                          >
                                            No item-level production or machine logs recorded for this date.
                                          </td>
                                        </tr>
                                      ) : (
                                        p.itemShiftBreakdown.map((item, itemIdx) =>
                                          item.shifts.map((shiftRow, idx) => (
                                            <tr
                                              key={`${item.itemKey}_${shiftRow.shift}`}
                                              className={`hover:bg-slate-50/80 transition-colors ${
                                                idx === 0 && itemIdx > 0
                                                  ? "border-t-2 border-slate-300"
                                                  : idx > 0
                                                  ? "border-t border-slate-200"
                                                  : ""
                                              }`}
                                            >
                                              {idx === 0 && (
                                                <td
                                                  rowSpan={item.shifts.length}
                                                  className="px-3 py-2 align-top bg-slate-50/60 border-r border-slate-200"
                                                >
                                                  <div className="flex items-center gap-1.5 flex-wrap">
                                                    <span className="font-bold text-slate-900">
                                                      {item.itemName}
                                                    </span>
                                                    {item.itemCode &&
                                                      item.itemCode.trim().toLowerCase() !==
                                                        item.itemName.trim().toLowerCase() && (
                                                        <span className="text-[10px] font-mono font-bold text-slate-600 bg-slate-200 px-1.5 py-0.5 rounded">
                                                          {item.itemCode}
                                                        </span>
                                                      )}
                                                  </div>
                                                  <div className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-[10px] text-emerald-800 font-semibold">
                                                    <span>Day Pre-QC:</span>
                                                    <span className="font-mono font-bold tabular-nums">
                                                      {item.dayQc.preQcProduction.toLocaleString()} pcs
                                                    </span>
                                                    <span className="text-emerald-500">·</span>
                                                    <span>Ops:</span>
                                                    <span className="font-mono font-bold tabular-nums">
                                                      {item.dayMachineOpsActual.toLocaleString()}
                                                    </span>
                                                  </div>
                                                </td>
                                              )}

                                              <td className="px-3 py-2 whitespace-nowrap">
                                                <span
                                                  className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-[11px] font-bold text-slate-800"
                                                  title={shiftRow.shift}
                                                >
                                                  {shiftRow.shiftShortLabel}
                                                </span>
                                              </td>

                                              <td className="px-3 py-2 text-right font-mono tabular-nums bg-emerald-50/40">
                                                {shiftRow.qc.hasLoggedProduction ? (
                                                  <span className="font-extrabold text-emerald-800">
                                                    {shiftRow.qc.preQcProduction.toLocaleString()}
                                                  </span>
                                                ) : (
                                                  <span className="text-slate-400 text-[11px] font-sans">
                                                    0 (Not Logged)
                                                  </span>
                                                )}
                                              </td>

                                              <td className="px-3 py-2 text-right font-mono tabular-nums">
                                                <span
                                                  className={
                                                    shiftRow.qc.hasLoggedProduction
                                                      ? "font-bold text-emerald-700"
                                                      : "text-slate-400"
                                                  }
                                                >
                                                  {shiftRow.qc.qcPassed.toLocaleString()}
                                                </span>
                                              </td>

                                              <td className="px-3 py-2 text-right font-mono tabular-nums">
                                                {shiftRow.machineRunsCount > 0 ? (
                                                  <>
                                                    <div className="font-bold text-slate-900">
                                                      {shiftRow.machineOpsActual.toLocaleString()}{" "}
                                                      <span className="text-slate-400 font-normal">
                                                        / {shiftRow.machineOpsStd.toLocaleString()}
                                                      </span>
                                                    </div>
                                                    <div className="text-[10px] text-slate-500 font-sans">
                                                      {shiftRow.planAchievementPct}% Plan
                                                    </div>
                                                  </>
                                                ) : (
                                                  <span className="text-[11px] text-slate-400 font-sans">
                                                    No machine logs
                                                  </span>
                                                )}
                                              </td>

                                              <td className="px-3 py-2 text-right font-mono tabular-nums">
                                                {shiftRow.rework > 0 ? (
                                                  <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 font-bold">
                                                    {shiftRow.rework.toLocaleString()}
                                                  </span>
                                                ) : (
                                                  <span className="text-slate-400">0</span>
                                                )}
                                              </td>

                                              <td className={`px-3 py-2 text-right font-mono tabular-nums ${TOTAL_DOWNTIME_THEME.textClass}`}>
                                                {shiftRow.machineRunsCount > 0
                                                  ? `${shiftRow.downtimeMinutes}m`
                                                  : "—"}
                                              </td>

                                              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">
                                                {shiftRow.machineRunsCount > 0
                                                  ? `${shiftRow.availabilityPct}%`
                                                  : "—"}
                                              </td>

                                              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">
                                                {shiftRow.machineRunsCount > 0
                                                  ? `${shiftRow.qualityPct}%`
                                                  : "—"}
                                              </td>

                                              <td className="px-3 py-2 text-right font-mono tabular-nums">
                                                {shiftRow.machineRunsCount > 0 ? (
                                                  <span
                                                    className={`px-1.5 py-0.5 rounded text-[11px] font-extrabold border ${getOeeBadgeClass(
                                                      shiftRow.oeePct
                                                    )}`}
                                                  >
                                                    {shiftRow.oeePct}%
                                                  </span>
                                                ) : (
                                                  <span className="text-slate-400">—</span>
                                                )}
                                              </td>

                                              <td className="px-3 py-2 text-center whitespace-nowrap">
                                                <button
                                                  type="button"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setShiftSheetModal({
                                                      date: p.periodKey,
                                                      shift: shiftRow.shift,
                                                      line: filterLine !== "all" ? filterLine : undefined,
                                                    });
                                                  }}
                                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded transition-colors cursor-pointer"
                                                  title={`View Daily Shift Sheet for ${p.periodKey} · ${shiftRow.shiftShortLabel}`}
                                                >
                                                  <FileText className="w-3 h-3" />
                                                  <span>View Shift Sheet</span>
                                                </button>
                                              </td>
                                            </tr>
                                          ))
                                        )
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
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

              {/* Group Toggle, Sort Controls & Export */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="inline-flex p-0.5 bg-slate-100 border border-slate-200 rounded-md">
                  <button
                    type="button"
                    onClick={() => setMachineGroupBy("none")}
                    className={`px-2.5 py-1 text-xs font-bold rounded transition-colors cursor-pointer ${
                      machineGroupBy === "none"
                        ? "bg-white text-slate-900 shadow-2xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Flat (All)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMachineGroupBy("line")}
                    className={`px-2.5 py-1 text-xs font-bold rounded transition-colors cursor-pointer ${
                      machineGroupBy === "line"
                        ? "bg-white text-slate-900 shadow-2xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Group by Line
                  </button>
                  <button
                    type="button"
                    onClick={() => setMachineGroupBy("item")}
                    className={`px-2.5 py-1 text-xs font-bold rounded transition-colors cursor-pointer ${
                      machineGroupBy === "item"
                        ? "bg-white text-slate-900 shadow-2xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Group by Item
                  </button>
                </div>

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
                <button
                  type="button"
                  disabled={machineRollups.length === 0}
                  onClick={() => handleExportActiveTab("machine")}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed rounded shadow-2xs transition-colors cursor-pointer"
                  title="Export Machine Performance Matrix to Excel"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Export Machine Matrix</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto overflow-y-auto max-h-[68vh] border border-slate-200 rounded-lg">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-900 text-slate-100 uppercase text-[10px] font-semibold sticky top-0 z-20 shadow-xs">
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
                  {groupedMachineMatrix.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="px-3 py-8 text-center text-slate-500 font-sans italic">
                        No machine logs found for current filters.
                      </td>
                    </tr>
                  ) : (
                    groupedMachineMatrix.map((group) => (
                      <React.Fragment key={group.groupKey}>
                        {machineGroupBy !== "none" && (
                          <tr className="bg-slate-100 border-t-2 border-slate-300 font-semibold text-slate-900">
                            <td colSpan={3} className="px-3 py-2 font-sans">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-extrabold text-slate-900 text-xs">
                                  {group.groupLabel}
                                </span>
                                {group.groupSubLabel && (
                                  <span className="text-[10px] font-mono font-bold text-slate-600 bg-slate-200 px-1.5 py-0.5 rounded">
                                    {group.groupSubLabel}
                                  </span>
                                )}
                                <span className="px-1.5 py-0.5 rounded bg-slate-200/80 text-slate-700 text-[10px] font-bold">
                                  {group.machinesCount}{" "}
                                  {group.machinesCount === 1 ? "Machine" : "Machines"}
                                </span>
                                {group.groupType === "item" &&
                                  group.groupKey !== "__unspecified__" && (
                                    <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-bold">
                                      Pre-QC: {(group.preQcProduction ?? 0).toLocaleString()} pcs
                                    </span>
                                  )}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right text-slate-700">
                              {group.metrics.totalStd.toLocaleString()}
                            </td>
                            <td className="px-3 py-2 text-right font-bold text-slate-900">
                              {group.metrics.totalActual.toLocaleString()}
                            </td>
                            <td className="px-3 py-2 text-right font-bold text-emerald-700">
                              {group.metrics.goodOutput.toLocaleString()}
                            </td>
                            <td className="px-3 py-2 text-right text-amber-700">
                              {group.metrics.totalRework.toLocaleString()}
                            </td>
                            <td className={`px-3 py-2 text-right ${TOTAL_DOWNTIME_THEME.textClass}`}>
                              {group.metrics.downtimeMinutes}m
                            </td>
                            <td className="px-3 py-2 text-right text-slate-700">
                              {group.metrics.availabilityPct}%
                            </td>
                            <td className="px-3 py-2 text-right text-slate-700">
                              {group.metrics.qualityPct}%
                            </td>
                            <td className="px-3 py-2 text-right">
                              <span
                                className={`px-2 py-0.5 rounded text-xs font-black border ${getOeeBadgeClass(
                                  group.metrics.oeePct
                                )}`}
                              >
                                {group.metrics.oeePct}%
                              </span>
                            </td>
                            <td className="px-3 py-2" />
                          </tr>
                        )}

                        {group.machines.map((m) => (
                          <tr
                            key={`${group.groupKey}_${m.machineId}_${m.line}`}
                            className="hover:bg-slate-50 transition-colors"
                          >
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
                                {m.metrics.totalOvertimeMinutes > 0 && (
                                  <span className="px-1.5 py-0.2 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-mono font-bold">
                                    +{m.metrics.totalOvertimeMinutes}m OT
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2 font-sans font-medium text-slate-700 whitespace-nowrap">
                              {m.line}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {m.splitRunsCount > 0 ? (
                                <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 text-[10px] font-bold">
                                  {m.splitRunsCount} Split
                                </span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-600">
                              {m.metrics.totalStd.toLocaleString()}
                            </td>
                            <td className="px-3 py-2 text-right font-bold text-slate-900">
                              {m.metrics.totalActual.toLocaleString()}
                            </td>
                            <td className="px-3 py-2 text-right text-emerald-700 font-bold">
                              {m.metrics.goodOutput.toLocaleString()}
                            </td>
                            <td className="px-3 py-2 text-right text-amber-600">
                              {m.metrics.totalRework.toLocaleString()}
                            </td>
                            <td className={`px-3 py-2 text-right ${TOTAL_DOWNTIME_THEME.textClass}`}>
                              {m.metrics.downtimeMinutes}m
                            </td>
                            <td className="px-3 py-2 text-right text-slate-700">
                              {m.metrics.availabilityPct}%
                            </td>
                            <td className="px-3 py-2 text-right text-slate-700">
                              {m.metrics.qualityPct}%
                            </td>
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
                      </React.Fragment>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 6: DAILY SHEET (INLINE SHIFT SHEET VIEW) */}
        {activeTab === "daily_sheet" && (() => {
          const currentDateIdx = availableDailySheetDates.indexOf(dsDate);
          const hasPrevDate =
            currentDateIdx >= 0 && currentDateIdx < availableDailySheetDates.length - 1;
          const hasNextDate = currentDateIdx > 0;
          const openTargetLine =
            dsLine !== "all"
              ? dsLine
              : dailySheetRows[0]?.line || dsOptions.lines[0] || "";
          const openTargetShift =
            dsShift !== "all"
              ? dsShift
              : dailySheetRows[0]?.shift || dsOptions.shifts[0] || "";
          const hasGranularFilter =
            dsItemKey !== "all" ||
            dsMachineId !== "all" ||
            dsOperator !== "all" ||
            dsShift !== "all";

          return (
            <div className="p-4 space-y-4">
              {/* Row 1 & Row 2 Full-Width Control Bar */}
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2.5">
                {/* Row 1: Date Navigator, Line Pills, Shift Pills & Actions */}
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex flex-wrap items-center gap-2.5">
                    {/* Date Navigator */}
                    <div className="inline-flex items-center bg-white border border-slate-300 rounded-md shadow-2xs overflow-hidden">
                      <button
                        type="button"
                        disabled={!hasPrevDate}
                        onClick={() =>
                          hasPrevDate &&
                          setDsDate(availableDailySheetDates[currentDateIdx + 1])
                        }
                        className="px-2 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed border-r border-slate-200 inline-flex items-center gap-0.5 cursor-pointer"
                        title="Previous active date"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        <span>Prev</span>
                      </button>
                      <select
                        value={dsDate}
                        onChange={(e) => setDsDate(e.target.value)}
                        disabled={availableDailySheetDates.length === 0}
                        className="px-2.5 py-1.5 text-xs font-mono font-bold text-slate-900 bg-white focus:outline-none cursor-pointer"
                        aria-label="Select Daily Sheet Date"
                      >
                        {availableDailySheetDates.length === 0 ? (
                          <option value="">No dates in range</option>
                        ) : (
                          availableDailySheetDates.map((d) => (
                            <option key={d} value={d}>
                              {formatDateWithWeekday(d)}
                            </option>
                          ))
                        )}
                      </select>
                      <button
                        type="button"
                        disabled={!hasNextDate}
                        onClick={() =>
                          hasNextDate &&
                          setDsDate(availableDailySheetDates[currentDateIdx - 1])
                        }
                        className="px-2 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed border-l border-slate-200 inline-flex items-center gap-0.5 cursor-pointer"
                        title="Next active date"
                      >
                        <span>Next</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Line Pills */}
                    <div className="inline-flex items-center gap-1 bg-slate-200/70 p-0.5 rounded-md border border-slate-200 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setDsLine("all")}
                        className={`px-2.5 py-1 text-xs font-bold rounded transition-colors cursor-pointer ${
                          dsLine === "all"
                            ? "bg-white text-slate-900 shadow-2xs"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        All Lines
                      </button>
                      {dsOptions.lines.map((line) => (
                        <button
                          key={line}
                          type="button"
                          onClick={() => setDsLine(line)}
                          className={`px-2.5 py-1 text-xs font-bold rounded transition-colors cursor-pointer ${
                            dsLine.toLowerCase() === line.toLowerCase()
                              ? "bg-blue-600 text-white shadow-2xs"
                              : "text-slate-600 hover:text-slate-900 hover:bg-white/60"
                          }`}
                        >
                          {line}
                        </button>
                      ))}
                    </div>

                    {/* Shift Pills */}
                    <div className="inline-flex items-center gap-1 bg-slate-200/70 p-0.5 rounded-md border border-slate-200 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setDsShift("all")}
                        className={`px-2.5 py-1 text-xs font-bold rounded transition-colors cursor-pointer ${
                          dsShift === "all"
                            ? "bg-white text-slate-900 shadow-2xs"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        All Shifts
                      </button>
                      {dsOptions.shifts.map((shift) => (
                        <button
                          key={shift}
                          type="button"
                          onClick={() => setDsShift(shift)}
                          title={shift}
                          className={`px-2.5 py-1 text-xs font-bold rounded transition-colors cursor-pointer ${
                            dsShift.toLowerCase() === shift.toLowerCase()
                              ? "bg-slate-900 text-white shadow-2xs"
                              : "text-slate-600 hover:text-slate-900 hover:bg-white/60"
                          }`}
                        >
                          {getShortShiftLabel(shift)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Right-Aligned Actions */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {onOpenShiftSheet && dsDate && (
                      <button
                        type="button"
                        disabled={!openTargetShift || !openTargetLine}
                        onClick={() =>
                          onOpenShiftSheet(dsDate, openTargetShift, openTargetLine)
                        }
                        title={
                          openTargetShift && openTargetLine
                            ? `Open editable Daily Shift Sheet for ${dsDate} · ${getShortShiftLabel(
                                openTargetShift
                              )} · ${openTargetLine}`
                            : "Select a date with active shift data"
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-emerald-950 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed rounded shadow-2xs transition-colors cursor-pointer"
                      >
                        <span>Open in Daily Shift Sheet</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={
                        !dsDate ||
                        (dailySheetRows.length === 0 && dailySheetItemProdRows.length === 0)
                      }
                      onClick={handleExportDailySheetExcel}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed rounded shadow-2xs transition-colors cursor-pointer"
                      title="Export current Daily Sheet selection to styled Excel"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      <span>Export Daily Sheet Excel</span>
                    </button>
                  </div>
                </div>

                {/* Row 2: Item & Granular Filters */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="font-semibold text-slate-600">Item:</span>
                      <select
                        value={dsItemKey}
                        onChange={(e) => setDsItemKey(e.target.value)}
                        className="bg-white border border-slate-300 rounded px-2 py-1 text-xs font-semibold text-slate-800 max-w-52"
                      >
                        <option value="all">All Items</option>
                        {dsOptions.items.map((it) => (
                          <option key={it.key} value={it.key}>
                            {it.code && it.code.toLowerCase() !== it.name.toLowerCase()
                              ? `${it.name} [${it.code}]`
                              : it.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="font-semibold text-slate-600">Machine:</span>
                      <select
                        value={dsMachineId}
                        onChange={(e) => setDsMachineId(e.target.value)}
                        className="bg-white border border-slate-300 rounded px-2 py-1 text-xs font-semibold text-slate-800 max-w-48"
                      >
                        <option value="all">All Machines</option>
                        {dsOptions.machines.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="font-semibold text-slate-600">Operator:</span>
                      <select
                        value={dsOperator}
                        onChange={(e) => setDsOperator(e.target.value)}
                        className="bg-white border border-slate-300 rounded px-2 py-1 text-xs font-semibold text-slate-800 max-w-44"
                      >
                        <option value="all">All Operators</option>
                        {dsOptions.operators.map((op) => (
                          <option key={op} value={op}>
                            {op}
                          </option>
                        ))}
                      </select>
                    </div>

                    {hasGranularFilter && (
                      <button
                        type="button"
                        onClick={() => {
                          setDsItemKey("all");
                          setDsMachineId("all");
                          setDsOperator("all");
                          setDsShift("all");
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded transition-colors cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Reset Sheet Filters</span>
                      </button>
                    )}
                  </div>

                  {(dsMachineId !== "all" || dsOperator !== "all") && (
                    <span className="text-[11px] font-medium text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                      Showing filtered machine rows — Pre-QC Shift Production reflects shift-level item totals.
                    </span>
                  )}
                </div>
              </div>

              {/* Full-Width Inline Daily Shift Sheet Table + Pre-QC Card */}
              <ShiftSheetReadOnlyContent
                rows={dailySheetRows}
                itemProdRows={dailySheetItemProdRows}
                groupByShift={dsShift === "all"}
                emptyMessage={
                  dsDate
                    ? `No machine log rows recorded for ${dsDate} matching the selected sheet filters.`
                    : "No production logs loaded in the selected date range."
                }
                onSelectMachine={(machineId) => handleSelectAnalyticsMachine(machineId)}
              />
            </div>
          );
        })()}
      </div>

      <ShiftSheetPreviewModal
        isOpen={Boolean(shiftSheetModal)}
        date={shiftSheetModal?.date || ""}
        shift={shiftSheetModal?.shift || ""}
        initialLine={shiftSheetModal?.line}
        allRows={enrichedAllRows}
        filteredRows={filteredRows}
        allItemProduction={historicalItemProduction}
        filteredItemProduction={filteredShiftItemTotals}
        hasActiveScopeFilter={hasActiveScopeFilter}
        onClose={() => setShiftSheetModal(null)}
        onSelectMachine={(machineId) => handleSelectAnalyticsMachine(machineId)}
        onOpenShiftSheet={onOpenShiftSheet}
      />
    </div>
  );
};

export default AnalyticsPreview;
