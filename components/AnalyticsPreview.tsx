"use client";
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  TrendingUp,
  AlertOctagon,
  Clock,
  Download,
  FileSpreadsheet,
  Search,
  Calendar,
  Layers,
  Package,
  Activity,
} from 'lucide-react';
import {
  MachineMaster,
  MachineShiftRow,
  MasterDataState,
  ShiftType,
  ItemProductionRollup,
} from '@/types';
import { INITIAL_MACHINES, PRODUCTION_LINES } from '@/data/initialData';
import { calculateEfficiency, calculateTotalBreakdown } from '@/services/storageService';
import { exportHistoricalToCSV, exportShiftToExcel } from '@/services/excelExport';
import { getAnalyticsLogs, getItemProductionRollups } from '@/actions/shiftActions';
import { useFeedback } from '@/context/FeedbackContext';

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

  const { runWithFeedback } = useFeedback();

  // Start with current shift rows, then merge 30-day history from Supabase on mount
  const [historicalLogs, setHistoricalLogs] = useState<MachineShiftRow[]>([]);
  const [itemRollups, setItemRollups] = useState<ItemProductionRollup[]>([]);
  const [isLoadingRollups, setIsLoadingRollups] = useState(false);

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

  // Fetch Item Production rollups (Today, MTD, Till Now) anchored to selectedDate
  useEffect(() => {
    let isMounted = true;
    setIsLoadingRollups(true);
    runWithFeedback(
      async () => {
        const data = await getItemProductionRollups(selectedDate);
        if (isMounted && data) {
          setItemRollups(data);
        }
        return data;
      },
      {
        loadingMessage: "Fetching analytics data...",
        errorTitle: "Analytics Fetch Failed",
      }
    ).finally(() => {
      if (isMounted) setIsLoadingRollups(false);
    });

    return () => {
      isMounted = false;
    };
  }, [selectedDate, runWithFeedback]);

  // Merge current shift rows with historical logs (deduplicated by row.id or unique composite key)
  const allLogs = useMemo(() => {
    const logMap = new Map<string, MachineShiftRow>();
    historicalLogs.forEach((log) => {
      const key = log.id || `${log.date}_${log.shift}_${log.line}_${log.machineId}_${log.runNo || 1}`;
      logMap.set(key, log);
    });
    rows.forEach((row) => {
      const key = row.id || `${row.date}_${row.shift}_${row.line}_${row.machineId}_${row.runNo || 1}`;
      logMap.set(key, row); // Latest current shift rows win
    });
    return Array.from(logMap.values());
  }, [historicalLogs, rows]);

  // Filters
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'yesterday' | '7d' | 'week' | 'custom' | 'selected'>('all');
  const [shiftFilter, setShiftFilter] = useState<string>('all');
  const [lineFilter, setLineFilter] = useState<string>('all');
  const [machineLineFilter, setMachineLineFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [itemSearchQuery, setItemSearchQuery] = useState<string>('');
  const [itemDropdownFilter, setItemDropdownFilter] = useState<string>('all');
  const [showIdleMachines, setShowIdleMachines] = useState<boolean>(false);

  // Canonical item index for consistent resolution across masterData, rollups, and shift logs
  const itemLookup = useMemo(() => {
    const lookup = new Map<
      string,
      { canonicalKey: string; itemId: string; itemCode: string; itemName: string }
    >();

    // 1. Index from masterData.items first (highest priority)
    (masterData?.items || []).forEach((item) => {
      const id = (item.id || '').trim();
      const code = (item.itemCode || '').trim();
      const name = (item.itemName || '').trim();
      const canonicalKey = (code || id || name).toLowerCase();
      if (!canonicalKey) return;

      const canonicalItem = {
        canonicalKey,
        itemId: id || canonicalKey,
        itemCode: code || '—',
        itemName: name || code || 'Unknown Part',
      };

      if (id) lookup.set(id.toLowerCase(), canonicalItem);
      if (code) lookup.set(code.toLowerCase(), canonicalItem);
      if (name) lookup.set(name.toLowerCase(), canonicalItem);
      lookup.set(canonicalKey, canonicalItem);
    });

    // 2. Index from itemRollups (for items present in DB shift_logs)
    itemRollups.forEach((r) => {
      const id = (r.itemId || '').trim();
      const code = (r.itemCode || '').trim();
      const name = (r.itemName || '').trim();

      const existing =
        (id ? lookup.get(id.toLowerCase()) : null) ||
        (code ? lookup.get(code.toLowerCase()) : null) ||
        (name ? lookup.get(name.toLowerCase()) : null);

      const canonicalKey = existing?.canonicalKey || (code || id || name).toLowerCase();
      if (!canonicalKey) return;

      const canonicalItem = existing || {
        canonicalKey,
        itemId: id || canonicalKey,
        itemCode: code || (id && !id.startsWith('item_') && !id.startsWith('it_') ? id : '—'),
        itemName: name || code || 'Unknown Part',
      };

      if (id && !lookup.has(id.toLowerCase())) lookup.set(id.toLowerCase(), canonicalItem);
      if (code && !lookup.has(code.toLowerCase())) lookup.set(code.toLowerCase(), canonicalItem);
      if (name && !lookup.has(name.toLowerCase())) lookup.set(name.toLowerCase(), canonicalItem);
      if (!lookup.has(canonicalKey)) lookup.set(canonicalKey, canonicalItem);
    });

    return lookup;
  }, [masterData?.items, itemRollups]);

  // Resolve any raw item reference into canonical item info
  const resolveItem = useCallback(
    (rawId?: string, rawCode?: string, rawName?: string) => {
      const id = (rawId || '').trim();
      const code = (rawCode || '').trim();
      const name = (rawName || '').trim();

      const matched =
        (id ? itemLookup.get(id.toLowerCase()) : null) ||
        (code ? itemLookup.get(code.toLowerCase()) : null) ||
        (name ? itemLookup.get(name.toLowerCase()) : null);

      if (matched) return matched;

      const fallbackCode = code || (id && !id.startsWith('item_') && !id.startsWith('it_') ? id : '');
      const canonicalKey = (fallbackCode || id || name || 'unknown').toLowerCase();
      return {
        canonicalKey,
        itemId: id || canonicalKey,
        itemCode: fallbackCode || '—',
        itemName: name || fallbackCode || id || 'Unknown Part',
      };
    },
    [itemLookup]
  );

  // Unique parts for dropdown with canonical deduplication
  const uniquePartOptions = useMemo(() => {
    const map = new Map<string, { value: string; label: string }>();

    (masterData?.items || []).forEach((it) => {
      const resolved = resolveItem(it.id, it.itemCode, it.itemName);
      const code = resolved.itemCode !== '—' ? resolved.itemCode : '';
      const name = resolved.itemName;
      const label = code && name && code !== name ? `${code} — ${name}` : (code || name);
      if (resolved.canonicalKey && !map.has(resolved.canonicalKey)) {
        map.set(resolved.canonicalKey, { value: resolved.canonicalKey, label });
      }
    });

    itemRollups.forEach((r) => {
      const resolved = resolveItem(r.itemId, r.itemCode, r.itemName);
      const code = resolved.itemCode !== '—' ? resolved.itemCode : '';
      const name = resolved.itemName;
      const label = code && name && code !== name ? `${code} — ${name}` : (code || name);
      if (resolved.canonicalKey && !map.has(resolved.canonicalKey)) {
        map.set(resolved.canonicalKey, { value: resolved.canonicalKey, label });
      }
    });

    allLogs.forEach((l) => {
      if (!l.itemName && !l.itemId) return;
      const resolved = resolveItem(l.itemId, undefined, l.itemName);
      const code = resolved.itemCode !== '—' ? resolved.itemCode : '';
      const name = resolved.itemName;
      const label = code && name && code !== name ? `${code} — ${name}` : (code || name);
      if (resolved.canonicalKey && !map.has(resolved.canonicalKey)) {
        map.set(resolved.canonicalKey, { value: resolved.canonicalKey, label });
      }
    });

    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [masterData?.items, itemRollups, allLogs, resolveItem]);

  // Custom Date Range State (defaults to past 30 days up to today)
  const [fromDate, setFromDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [appliedCustomRange, setAppliedCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [isLoadingCustom, setIsLoadingCustom] = useState(false);

  // Prevent invalid ranges: clamp toDate if fromDate > toDate, or vice versa
  const handleFromDateChange = (val: string) => {
    setFromDate(val);
    if (toDate && val > toDate) {
      setToDate(val);
    }
  };

  const handleToDateChange = (val: string) => {
    if (fromDate && val < fromDate) {
      setToDate(fromDate);
    } else {
      setToDate(val);
    }
  };

  // Fetch older dates outside initial cache from Supabase when "Apply" is clicked
  const handleApplyCustomRange = async () => {
    if (!fromDate || !toDate) return;
    setAppliedCustomRange({ from: fromDate, to: toDate });
    setIsLoadingCustom(true);
    try {
      await runWithFeedback(
        async () => {
          const customLogs = await getAnalyticsLogs({ startDate: fromDate, endDate: toDate });
          if (customLogs && customLogs.length > 0) {
            setHistoricalLogs((prev) => {
              const map = new Map<string, MachineShiftRow>();
              prev.forEach((l) => map.set(l.id, l));
              customLogs.forEach((l) => map.set(l.id, l));
              return Array.from(map.values());
            });
          }
          return customLogs;
        },
        {
          loadingMessage: "Fetching analytics data...",
          successTitle: "Analytics Updated",
          successDetail: `Loaded historical logs for ${fromDate} to ${toDate}`,
          errorTitle: "Analytics Fetch Failed",
        }
      );
    } finally {
      setIsLoadingCustom(false);
    }
  };

  // Sync internal filters with Header props when they change
  useEffect(() => {
    if (selectedLine) {
      setLineFilter(selectedLine);
      setMachineLineFilter(selectedLine);
    }
  }, [selectedLine]);

  useEffect(() => {
    if (selectedShift) {
      const parts = selectedShift.split(' ');
      const shiftPrefix = parts.length >= 2 ? `${parts[0]} ${parts[1]}` : parts[0];
      setShiftFilter(shiftPrefix || 'all');
    }
  }, [selectedShift]);

  const prevSelectedDateRef = React.useRef(selectedDate);
  useEffect(() => {
    if (prevSelectedDateRef.current === selectedDate) return;
    prevSelectedDateRef.current = selectedDate;
    if (dateFilter === 'custom') return; // Do not stomp active custom date range

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
  }, [selectedDate, dateFilter]);

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
      if ((dateFilter === 'week' || dateFilter === '7d') && log.date < weekAgo) return false;
      if (dateFilter === 'custom') {
        const from = appliedCustomRange?.from || fromDate;
        const to = appliedCustomRange?.to || toDate;
        if (from && log.date < from) return false;
        if (to && log.date > to) return false;
      }

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
  }, [allLogs, dateFilter, selectedDate, shiftFilter, lineFilter, searchQuery, appliedCustomRange, fromDate, toDate]);

  // Dynamic Export Filename Builder that includes the active date range
  const getExportFilename = (extension: 'csv' | 'xlsx', basePrefix: string = 'neco_production') => {
    let datePart = dateFilter as string;
    if (dateFilter === 'custom') {
      const from = appliedCustomRange?.from || fromDate;
      const to = appliedCustomRange?.to || toDate;
      datePart = `${from}_to_${to}`;
    } else if (dateFilter === 'today') {
      datePart = new Date().toISOString().slice(0, 10);
    } else if (dateFilter === 'yesterday') {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      datePart = d.toISOString().slice(0, 10);
    } else if (dateFilter === 'week' || dateFilter === '7d') {
      datePart = 'last_7_days';
    } else if (dateFilter === 'selected' && selectedDate) {
      datePart = selectedDate;
    } else {
      datePart = 'all_time';
    }

    const cleanLine = lineFilter !== 'all' ? `_${lineFilter.replace(/\s+/g, '_')}` : '';
    const cleanShift = shiftFilter !== 'all' ? `_${shiftFilter.replace(/\s+/g, '_')}` : '';
    return `${basePrefix}_logs_${datePart}${cleanLine}${cleanShift}.${extension}`;
  };

  const handleExportCSV = () => {
    const from = dateFilter === 'custom' ? (appliedCustomRange?.from || fromDate) : undefined;
    const to = dateFilter === 'custom' ? (appliedCustomRange?.to || toDate) : undefined;
    const filename = getExportFilename('csv', 'neco_powerbi');
    exportHistoricalToCSV(filteredLogs, from, to, filename);
  };

  const handleExportExcel = () => {
    const from = dateFilter === 'custom' ? (appliedCustomRange?.from || fromDate) : undefined;
    const to = dateFilter === 'custom' ? (appliedCustomRange?.to || toDate) : undefined;
    const dateRangeLabel = from && to ? `${from}_to_${to}` : (dateFilter === 'selected' ? selectedDate : dateFilter);
    const filename = getExportFilename('xlsx', 'neco_shift_report');
    exportShiftToExcel(
      filteredLogs,
      dateRangeLabel,
      shiftFilter !== 'all' ? shiftFilter : undefined,
      lineFilter !== 'all' ? lineFilter : undefined,
      filename,
      masterData,
      itemRollups
    );
  };

  // Aggregate Primary KPIs (Partial-Line Rule: only stdOutput > 0)
  const kpis = useMemo(() => {
    const activeLogs = filteredLogs.filter((r) => Number(r.stdOutput) > 0);

    const totalStd = activeLogs.reduce((acc, r) => acc + (Number(r.stdOutput) || 0), 0);
    const totalAct = activeLogs.reduce((acc, r) => acc + (Number(r.actualOutput) || 0), 0);
    const totalRework = activeLogs.reduce((acc, r) => acc + (Number(r.rework) || 0), 0);

    const totalNoDisc = Number(activeLogs.reduce((acc, r) => acc + (Number(r.breakdown.noDisc) || 0), 0).toFixed(2));
    const totalChange = Number(activeLogs.reduce((acc, r) => acc + (Number(r.breakdown.change) || 0), 0).toFixed(2));
    const totalPower = Number(activeLogs.reduce((acc, r) => acc + (Number(r.breakdown.power) || 0), 0).toFixed(2));
    const totalOperator = Number(activeLogs.reduce((acc, r) => acc + (Number(r.breakdown.operator) || 0), 0).toFixed(2));
    const totalMachineBd = Number(activeLogs.reduce((acc, r) => acc + (Number(r.breakdown.machineBreakdown) || 0), 0).toFixed(2));
    const totalFixProg = Number(activeLogs.reduce((acc, r) => acc + (Number(r.breakdown.fixProgSettings) || 0), 0).toFixed(2));
    const totalBreakdown = Number(
      (
        totalNoDisc +
        totalChange +
        totalPower +
        totalOperator +
        totalMachineBd +
        totalFixProg
      ).toFixed(2)
    );

    const plantEfficiency = totalStd > 0 ? Math.round((totalAct / totalStd) * 100) : 0;
    const reworkRate = totalAct > 0 ? ((totalRework / totalAct) * 100).toFixed(1) : '0.0';

    const totalWorkingMins =
      activeLogs.reduce(
        (acc, r) => acc + (Number(r.totalWorkingMinutes) || 1305),
        0
      ) || (activeLogs.length * 1305 || 1305);

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

    const machineBdPctOfWorking =
      totalWorkingMins > 0
        ? ((totalMachineBd / totalWorkingMins) * 100).toFixed(1)
        : '0.0';

    const fixProgPctOfWorking =
      totalWorkingMins > 0
        ? ((totalFixProg / totalWorkingMins) * 100).toFixed(1)
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
        machineBreakdown: totalMachineBd,
        fixProgSettings: totalFixProg,
      },
      categoryWorkingPct: {
        noDisc: noDiscPctOfWorking,
        change: changePctOfWorking,
        power: powerPctOfWorking,
        operator: operatorPctOfWorking,
        machineBreakdown: machineBdPctOfWorking,
        fixProgSettings: fixProgPctOfWorking,
      },
      logCount: activeLogs.length,
    };
  }, [filteredLogs]);

  // Section 1: Line Efficiency & Shift-Wise Comparison Matrix (Domain Rule: Partial-Line stdOutput > 0)
  const lineComparisonData = useMemo(() => {
    const lineList =
      masterData?.lines && masterData.lines.length > 0
        ? masterData.lines.filter((l) => l.isActive !== false).map((l) => l.name)
        : PRODUCTION_LINES;

    const allMachines = masterData?.machines && masterData.machines.length > 0
      ? masterData.machines
      : INITIAL_MACHINES;

    let grandTotalMachines = 0;
    const grandActiveSet = new Set<string>();
    let grandStd = 0;
    let grandAct = 0;
    let grandAStd = 0;
    let grandAAct = 0;
    let grandBStd = 0;
    let grandBAct = 0;
    let grandCStd = 0;
    let grandCAct = 0;
    let grandBd = 0;

    const lines = lineList.map((lineName) => {
      const lineMachines = allMachines.filter((m) => (m.line || 'Line 1') === lineName);
      const totalMachines = lineMachines.length;
      grandTotalMachines += totalMachines;

      const lineLogs = filteredLogs.filter((r) => (r.line || 'Line 1') === lineName);
      // Strictly filter active rows where stdOutput > 0
      const activeLogs = lineLogs.filter((r) => Number(r.stdOutput) > 0);

      const activeMachineSet = new Set(activeLogs.map((r) => r.machineId || r.machineName));
      activeLogs.forEach((r) => grandActiveSet.add(r.machineId || r.machineName));

      const std = activeLogs.reduce((acc, r) => acc + (Number(r.stdOutput) || 0), 0);
      const act = activeLogs.reduce((acc, r) => acc + (Number(r.actualOutput) || 0), 0);
      const eff = std > 0 ? Math.round((act / std) * 100) : 0;

      const filterShift = (prefix: string) =>
        activeLogs.filter((r) => (r.shift || '').toLowerCase().includes(prefix.toLowerCase()));

      const aLogs = filterShift('shift a');
      const bLogs = filterShift('shift b');
      const cLogs = filterShift('shift c');

      const aStd = aLogs.reduce((acc, r) => acc + (Number(r.stdOutput) || 0), 0);
      const aAct = aLogs.reduce((acc, r) => acc + (Number(r.actualOutput) || 0), 0);
      const aEff = aStd > 0 ? Math.round((aAct / aStd) * 100) : null;

      const bStd = bLogs.reduce((acc, r) => acc + (Number(r.stdOutput) || 0), 0);
      const bAct = bLogs.reduce((acc, r) => acc + (Number(r.actualOutput) || 0), 0);
      const bEff = bStd > 0 ? Math.round((bAct / bStd) * 100) : null;

      const cStd = cLogs.reduce((acc, r) => acc + (Number(r.stdOutput) || 0), 0);
      const cAct = cLogs.reduce((acc, r) => acc + (Number(r.actualOutput) || 0), 0);
      const cEff = cStd > 0 ? Math.round((cAct / cStd) * 100) : null;

      const runningEffs = [aEff, bEff, cEff].filter((v): v is number => v !== null);
      const spread = runningEffs.length >= 2 ? Math.max(...runningEffs) - Math.min(...runningEffs) : null;

      const totalBd = Number(lineLogs.reduce((acc, r) => acc + calculateTotalBreakdown(r.breakdown), 0).toFixed(2));

      grandStd += std;
      grandAct += act;
      grandAStd += aStd;
      grandAAct += aAct;
      grandBStd += bStd;
      grandBAct += bAct;
      grandCStd += cStd;
      grandCAct += cAct;
      grandBd = Number((grandBd + totalBd).toFixed(2));

      return {
        lineName,
        activeCount: activeMachineSet.size,
        totalMachines,
        std,
        act,
        variance: act - std,
        eff,
        aAct,
        aStd,
        aEff,
        bAct,
        bStd,
        bEff,
        cAct,
        cStd,
        cEff,
        spread,
        totalBd,
      };
    });

    const grandEff = grandStd > 0 ? Math.round((grandAct / grandStd) * 100) : 0;
    const grandAEff = grandAStd > 0 ? Math.round((grandAAct / grandAStd) * 100) : null;
    const grandBEff = grandBStd > 0 ? Math.round((grandBAct / grandBStd) * 100) : null;
    const grandCEff = grandCStd > 0 ? Math.round((grandCAct / grandCStd) * 100) : null;
    const grandRunningEffs = [grandAEff, grandBEff, grandCEff].filter((v): v is number => v !== null);
    const grandSpread =
      grandRunningEffs.length >= 2 ? Math.max(...grandRunningEffs) - Math.min(...grandRunningEffs) : null;

    const plantTotal = {
      lineName: 'Total Plant (All Lines)',
      activeCount: grandActiveSet.size,
      totalMachines: grandTotalMachines,
      std: grandStd,
      act: grandAct,
      variance: grandAct - grandStd,
      eff: grandEff,
      aAct: grandAAct,
      aStd: grandAStd,
      aEff: grandAEff,
      bAct: grandBAct,
      bStd: grandBStd,
      bEff: grandBEff,
      cAct: grandCAct,
      cStd: grandCStd,
      cEff: grandCEff,
      spread: grandSpread,
      totalBd: grandBd,
    };

    return { lines, plantTotal };
  }, [masterData?.lines, masterData?.machines, filteredLogs]);

  // Section 2: Item Production Rollups Summary (Period, Today, MTD, All-Time Till Now)
  const itemSummaryRows = useMemo(() => {
    const map = new Map<
      string,
      {
        canonicalKey: string;
        itemId: string;
        itemCode: string;
        itemName: string;
        periodQty: number;
        periodStd: number;
        periodRework: number;
        todayQty: number;
        mtdQty: number;
        tillNowQty: number;
        tillNowStd: number;
        tillNowRework: number;
      }
    >();

    // 1. Seed master definitions and historical rollups from itemRollups
    for (const roll of itemRollups) {
      const resolved = resolveItem(roll.itemId, roll.itemCode, roll.itemName);
      if (!map.has(resolved.canonicalKey)) {
        map.set(resolved.canonicalKey, {
          canonicalKey: resolved.canonicalKey,
          itemId: resolved.itemId,
          itemCode: resolved.itemCode || '—',
          itemName: resolved.itemName,
          periodQty: 0,
          periodStd: 0,
          periodRework: 0,
          todayQty: 0,
          mtdQty: 0,
          tillNowQty: 0,
          tillNowStd: 0,
          tillNowRework: 0,
        });
      }
      const entry = map.get(resolved.canonicalKey)!;
      entry.todayQty += Number(roll.todayOutput) || 0;
      entry.mtdQty += Number(roll.mtdOutput) || 0;
      entry.tillNowQty += Number(roll.tillNowOutput) || 0;
      entry.tillNowStd += Number(roll.tillNowStd) || 0;
      entry.tillNowRework += Number(roll.tillNowRework) || 0;
    }

    // 2. Accumulate period quantities from current filteredLogs
    for (const log of filteredLogs) {
      if (!log.itemId && !log.itemName) continue;
      const resolved = resolveItem(log.itemId, undefined, log.itemName);
      if (!map.has(resolved.canonicalKey)) {
        map.set(resolved.canonicalKey, {
          canonicalKey: resolved.canonicalKey,
          itemId: resolved.itemId,
          itemCode: resolved.itemCode || '—',
          itemName: resolved.itemName || 'Unknown Part',
          periodQty: 0,
          periodStd: 0,
          periodRework: 0,
          todayQty: 0,
          mtdQty: 0,
          tillNowQty: 0,
          tillNowStd: 0,
          tillNowRework: 0,
        });
      }
      const entry = map.get(resolved.canonicalKey)!;
      if (entry.itemCode === '—' && resolved.itemCode !== '—') {
        entry.itemCode = resolved.itemCode;
      }
      if ((!entry.itemName || entry.itemName === 'Unknown Part') && resolved.itemName) {
        entry.itemName = resolved.itemName;
      }
      entry.periodQty += Number(log.actualOutput) || 0;
      entry.periodStd += Number(log.stdOutput) || 0;
      entry.periodRework += Number(log.rework) || 0;
    }

    let list = Array.from(map.values());

    if (itemDropdownFilter && itemDropdownFilter !== 'all') {
      const target = itemDropdownFilter.trim().toLowerCase();
      list = list.filter(
        (it) =>
          it.canonicalKey === target ||
          it.itemId.trim().toLowerCase() === target ||
          it.itemCode.trim().toLowerCase() === target ||
          it.itemName.trim().toLowerCase() === target
      );
    }

    if (itemSearchQuery.trim()) {
      const q = itemSearchQuery.trim().toLowerCase();
      list = list.filter(
        (it) =>
          it.canonicalKey.includes(q) ||
          it.itemName.toLowerCase().includes(q) ||
          it.itemCode.toLowerCase().includes(q) ||
          it.itemId.toLowerCase().includes(q)
      );
    }

    return list.sort((a, b) => b.periodQty - a.periodQty || b.tillNowQty - a.tillNowQty);
  }, [itemRollups, filteredLogs, resolveItem, itemDropdownFilter, itemSearchQuery]);

  // Aggregate totals for the filtered item summary rows
  const itemSummaryTotals = useMemo(() => {
    const periodQty = itemSummaryRows.reduce((acc, it) => acc + it.periodQty, 0);
    const periodStd = itemSummaryRows.reduce((acc, it) => acc + it.periodStd, 0);
    const periodRework = itemSummaryRows.reduce((acc, it) => acc + it.periodRework, 0);
    const todayQty = itemSummaryRows.reduce((acc, it) => acc + it.todayQty, 0);
    const mtdQty = itemSummaryRows.reduce((acc, it) => acc + it.mtdQty, 0);
    const tillNowQty = itemSummaryRows.reduce((acc, it) => acc + it.tillNowQty, 0);
    const tillNowStd = itemSummaryRows.reduce((acc, it) => acc + it.tillNowStd, 0);
    const tillNowRework = itemSummaryRows.reduce((acc, it) => acc + it.tillNowRework, 0);
    const eff = periodStd > 0 ? Math.round((periodQty / periodStd) * 100) : null;

    return {
      periodQty,
      periodStd,
      periodRework,
      todayQty,
      mtdQty,
      tillNowQty,
      tillNowStd,
      tillNowRework,
      eff,
      count: itemSummaryRows.length,
    };
  }, [itemSummaryRows]);

  // Section 3: Machine-wise Detailed Efficiency Matrix
  const machineMetrics = useMemo(() => {
    const baseMachines =
      machineLineFilter === 'all'
        ? machines
        : machines.filter((m) => (m.line || 'Line 1') === machineLineFilter);

    const baseMachineIds = new Set(machines.map((m) => m.id));

    // Find any temporary machines present in filteredLogs for the selected machineLineFilter
    const tempMachinesMap = new Map<
      string,
      { id: string; name: string; code: string; line: string; isTemp: boolean }
    >();

    for (const log of filteredLogs) {
      const isTemp = Boolean(
        log.isTempMachine ||
        log.machineId?.startsWith('temp_') ||
        !baseMachineIds.has(log.machineId)
      );

      if (isTemp && log.machineId) {
        const line = log.line || 'Line 1';
        if (machineLineFilter === 'all' || line === machineLineFilter) {
          if (!tempMachinesMap.has(log.machineId)) {
            tempMachinesMap.set(log.machineId, {
              id: log.machineId,
              name: `${log.machineName || 'Temp Machine'} (Temp)`,
              code: log.machineCode || 'TEMP',
              line,
              isTemp: true,
            });
          }
        }
      }
    }

    const relevantMachines = [
      ...baseMachines.map((m) => ({ ...m, isTemp: false })),
      ...Array.from(tempMachinesMap.values()),
    ];

    return relevantMachines.map((machine) => {
      const machLogs = filteredLogs.filter(
        (l) => l.machineId === machine.id || (!machine.isTemp && l.machineName === machine.name)
      );
      const activeLogs = machLogs.filter((l) => Number(l.stdOutput) > 0);
      const isOperating = activeLogs.length > 0;

      const std = activeLogs.reduce((acc, r) => acc + (Number(r.stdOutput) || 0), 0);
      const act = activeLogs.reduce((acc, r) => acc + (Number(r.actualOutput) || 0), 0);
      const rework = machLogs.reduce((acc, r) => acc + (Number(r.rework) || 0), 0);
      const downtime = Number(
        machLogs.reduce((acc, r) => acc + calculateTotalBreakdown(r.breakdown), 0).toFixed(2)
      );
      const efficiency = std > 0 ? Math.round((act / std) * 100) : null;

      const filterShift = (prefix: string) =>
        activeLogs.filter((r) => (r.shift || '').toLowerCase().includes(prefix.toLowerCase()));

      const aLogs = filterShift('shift a');
      const bLogs = filterShift('shift b');
      const cLogs = filterShift('shift c');

      const aAct = aLogs.reduce((acc, r) => acc + (Number(r.actualOutput) || 0), 0);
      const aStd = aLogs.reduce((acc, r) => acc + (Number(r.stdOutput) || 0), 0);
      const aEff = aStd > 0 ? Math.round((aAct / aStd) * 100) : null;

      const bAct = bLogs.reduce((acc, r) => acc + (Number(r.actualOutput) || 0), 0);
      const bStd = bLogs.reduce((acc, r) => acc + (Number(r.stdOutput) || 0), 0);
      const bEff = bStd > 0 ? Math.round((bAct / bStd) * 100) : null;

      const cAct = cLogs.reduce((acc, r) => acc + (Number(r.actualOutput) || 0), 0);
      const cStd = cLogs.reduce((acc, r) => acc + (Number(r.stdOutput) || 0), 0);
      const cEff = cStd > 0 ? Math.round((cAct / cStd) * 100) : null;

      const activeShifts: { name: string; eff: number; act: number; std: number }[] = [];
      if (aEff !== null) activeShifts.push({ name: 'Shift A', eff: aEff, act: aAct, std: aStd });
      if (bEff !== null) activeShifts.push({ name: 'Shift B', eff: bEff, act: bAct, std: bStd });
      if (cEff !== null) activeShifts.push({ name: 'Shift C', eff: cEff, act: cAct, std: cStd });

      const shiftsOperatedText = isOperating ? `${activeShifts.length} / 3 shifts` : '0 / 3 (Idle)';

      let bestWorstHighlight: {
        text: string;
        spread: number | null;
        isHighSpread: boolean;
      } = {
        text: '—',
        spread: null,
        isHighSpread: false,
      };

      if (activeShifts.length >= 2) {
        const sorted = [...activeShifts].sort((x, y) => y.eff - x.eff);
        const best = sorted[0];
        const worst = sorted[sorted.length - 1];
        const diff = best.eff - worst.eff;
        bestWorstHighlight = {
          text: `Best: ${best.name} (${best.eff}%) | Worst: ${worst.name} (${worst.eff}%)`,
          spread: diff,
          isHighSpread: diff >= 10,
        };
      } else if (activeShifts.length === 1) {
        bestWorstHighlight = {
          text: `${activeShifts[0].name} only (${activeShifts[0].eff}%)`,
          spread: null,
          isHighSpread: false,
        };
      }

      const latestOperator = activeLogs[activeLogs.length - 1]?.operatorName || '—';
      const latestItem = activeLogs[activeLogs.length - 1]?.itemName || '—';

      return {
        id: machine.id,
        name: machine.name,
        code: machine.code,
        line: machine.line || 'Line 1',
        isOperating,
        std,
        act,
        variance: act - std,
        rework,
        downtime,
        efficiency,
        shiftsOperatedCount: activeShifts.length,
        shiftsOperatedText,
        aAct,
        aEff,
        bAct,
        bEff,
        cAct,
        cEff,
        bestWorstHighlight,
        latestOperator,
        latestItem,
        hasData: machLogs.length > 0,
      };
    });
  }, [machines, filteredLogs, machineLineFilter]);

  // Filtered machine metrics for display based on showIdleMachines toggle
  const visibleMachineMetrics = useMemo(() => {
    if (showIdleMachines) return machineMetrics;
    return machineMetrics.filter((m) => m.isOperating || m.hasData);
  }, [machineMetrics, showIdleMachines]);

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
  const machineBdPct = Math.round((kpis.breakdownSplit.machineBreakdown / grandBreakdown) * 100);
  const fixProgPct = Math.round((kpis.breakdownSplit.fixProgSettings / grandBreakdown) * 100);

  return (
    <div className="space-y-6">
      {/* Top Controls & Power BI Feed Export */}
      <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-2xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h2 className="text-base font-bold text-slate-900 tracking-tight">
              Production Intelligence & Power BI Telemetry
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Plant-wide efficiency matrix, item production totals, and telemetry for audit & executive review.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Quick Date Presets */}
          <div className="flex flex-wrap items-center gap-0.5 bg-slate-100 p-1 rounded border border-slate-200 text-xs max-w-full">
            <button
              onClick={() => setDateFilter('all')}
              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                dateFilter === 'all' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Time
            </button>
            <button
              onClick={() => setDateFilter('today')}
              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                dateFilter === 'today' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setDateFilter('yesterday')}
              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                dateFilter === 'yesterday' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Yesterday
            </button>
            <button
              onClick={() => setDateFilter('7d')}
              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                dateFilter === '7d' || dateFilter === 'week' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Last 7 Days
            </button>
            <button
              onClick={() => {
                setDateFilter('custom');
                if (!appliedCustomRange) {
                  setAppliedCustomRange({ from: fromDate, to: toDate });
                }
              }}
              className={`px-2.5 py-1 rounded font-medium transition-colors flex items-center gap-1.5 ${
                dateFilter === 'custom' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              <span>Custom Range</span>
            </button>
            {selectedDate && selectedDate !== new Date().toISOString().slice(0, 10) && (
              <button
                onClick={() => setDateFilter('selected')}
                className={`px-2.5 py-1 rounded font-medium transition-colors ${
                  dateFilter === 'selected' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Log Date ({selectedDate})
              </button>
            )}
          </div>

          {/* Inline Custom Date Range Picker */}
          {dateFilter === 'custom' && (
            <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 p-1 rounded border border-slate-300 text-xs shadow-2xs">
              <div className="flex items-center gap-1">
                <span className="text-[11px] font-semibold text-slate-600 uppercase">From:</span>
                <input
                  type="date"
                  aria-label="From Date"
                  value={fromDate}
                  max={toDate}
                  onChange={(e) => handleFromDateChange(e.target.value)}
                  className="px-2 py-0.5 text-xs bg-white border border-slate-300 rounded font-mono text-slate-800 focus:outline-none focus:border-slate-800"
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[11px] font-semibold text-slate-600 uppercase">To:</span>
                <input
                  type="date"
                  aria-label="To Date"
                  value={toDate}
                  min={fromDate}
                  onChange={(e) => handleToDateChange(e.target.value)}
                  className="px-2 py-0.5 text-xs bg-white border border-slate-300 rounded font-mono text-slate-800 focus:outline-none focus:border-slate-800"
                />
              </div>
              <button
                type="button"
                onClick={handleApplyCustomRange}
                disabled={isLoadingCustom || !fromDate || !toDate}
                className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-semibold flex items-center gap-1 transition-colors shadow-2xs disabled:opacity-50"
              >
                {isLoadingCustom ? (
                  <span>Loading...</span>
                ) : (
                  <span>Apply</span>
                )}
              </button>
            </div>
          )}

          {/* Shift Filter */}
          <select
            value={shiftFilter}
            onChange={(e) => setShiftFilter(e.target.value)}
            className="bg-white border border-slate-200 text-xs font-medium text-slate-700 rounded px-2.5 py-1.5 focus:outline-none focus:border-slate-800"
          >
            <option value="all">All Shifts</option>
            <option value="Shift A">Shift A (7AM-3:30PM)</option>
            <option value="Shift B">Shift B (3:30PM-12AM)</option>
            <option value="Shift C">Shift C (12AM-7AM)</option>
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

          {/* Direct CSV / Excel Export */}
          <button
            onClick={handleExportCSV}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs"
            title="Download clean CSV table structured for Power BI desktop import"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>Power BI CSV</span>
          </button>

          <button
            onClick={handleExportExcel}
            className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs"
            title="Download 4-sheet multi-table Excel workbook"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            <span>Export .xlsx (4 Sheets)</span>
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

        {/* KPI 2: Overall Plant Efficiency (Partial-Line Weighted) */}
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <span>Plant-Wide Efficiency</span>
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
            <span className="text-slate-500">Operating Machines:</span>
            <span className="font-semibold text-emerald-700 font-mono">
              {lineComparisonData.plantTotal.activeCount} / {lineComparisonData.plantTotal.totalMachines} active
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
              {kpis.totalBdPctOfWorking}% of total
            </span>
          </div>
        </div>
      </div>

      {/* SECTION 1: Item Production Tracker & Temporal Progress (Today, MTD, All-Time Till Now) */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-2xs overflow-hidden space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <Package className="w-4 h-4 text-slate-700" />
              <span>Item Production Tracker & Temporal Progress</span>
            </h3>
            <p className="text-xs text-slate-500">
              Real-time part production tracking across temporal horizons: Selected Period, Today, Month-to-Date (MTD), and Total Till Now (All-Time).
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Part Dropdown Filter */}
            <select
              value={itemDropdownFilter}
              onChange={(e) => setItemDropdownFilter(e.target.value)}
              className="bg-white border border-slate-300 text-xs font-medium text-slate-700 rounded px-2.5 py-1 focus:outline-none focus:border-slate-800 max-w-[200px] truncate"
              title="Filter by specific item"
            >
              <option value="all">All Items (Plant-wide)</option>
              {uniquePartOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            {/* Part Search Box */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search part code or name..."
                value={itemSearchQuery}
                onChange={(e) => setItemSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1 text-xs border border-slate-300 rounded focus:border-slate-800 focus:outline-none w-48 sm:w-56"
              />
            </div>

            {isLoadingRollups && (
              <span className="text-[11px] text-slate-400 font-mono animate-pulse">Syncing...</span>
            )}
          </div>
        </div>

        <div className="overflow-x-auto max-h-80 border border-slate-200 rounded">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="bg-slate-900 text-slate-200 sticky top-0 z-10 text-[11px] font-semibold uppercase">
              <tr>
                <th className="px-3 py-2 border-r border-slate-800">Part Code</th>
                <th className="px-3 py-2 border-r border-slate-800">Item Name</th>
                <th className="px-2.5 py-2 border-r border-slate-800 text-center bg-slate-800/80">Selected Range (Pcs)</th>
                <th className="px-2.5 py-2 border-r border-slate-800 text-center">Today Output</th>
                <th className="px-2.5 py-2 border-r border-slate-800 text-center">Month-to-Date (MTD)</th>
                <th className="px-2.5 py-2 border-r border-slate-800 text-center font-bold text-amber-300">Total Till Now (All-Time)</th>
                <th className="px-2.5 py-2 border-r border-slate-800 text-center">Till Now Target</th>
                <th className="px-2.5 py-2 border-r border-slate-800 text-center">Rework Defect</th>
                <th className="px-3 py-2 text-center">Period Eff %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono">
              {itemSummaryRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-6 text-slate-500 font-sans">
                    No matching item production records found.
                  </td>
                </tr>
              ) : (
                itemSummaryRows.map((it) => {
                  const eff = it.periodStd > 0 ? Math.round((it.periodQty / it.periodStd) * 100) : null;
                  return (
                    <tr key={it.canonicalKey || it.itemId || it.itemName} className="hover:bg-slate-50">
                      <td className="px-3 py-1.5 text-slate-700 whitespace-nowrap font-semibold">
                        {it.itemCode}
                      </td>
                      <td className="px-3 py-1.5 font-sans font-bold text-slate-900 whitespace-nowrap">
                        {it.itemName}
                      </td>
                      <td className="px-2.5 py-1.5 text-center font-extrabold text-slate-900 bg-slate-50/70">
                        {it.periodQty}
                      </td>
                      <td className="px-2.5 py-1.5 text-center text-slate-700">{it.todayQty}</td>
                      <td className="px-2.5 py-1.5 text-center text-slate-700">{it.mtdQty}</td>
                      <td className="px-2.5 py-1.5 text-center font-black text-amber-800 bg-amber-50/40">
                        {it.tillNowQty}
                      </td>
                      <td className="px-2.5 py-1.5 text-center text-slate-600">{it.tillNowStd}</td>
                      <td className="px-2.5 py-1.5 text-center text-rose-700">{it.tillNowRework}</td>
                      <td className="px-3 py-1.5 text-center">
                        {eff !== null ? (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${
                              eff >= 85
                                ? 'bg-emerald-100 text-emerald-800'
                                : eff >= 75
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {eff}%
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {itemSummaryRows.length > 0 && (
              <tfoot className="bg-slate-100 font-mono font-bold text-slate-900 border-t-2 border-slate-300">
                <tr>
                  <td colSpan={2} className="px-3 py-2 font-sans uppercase text-xs tracking-tight">
                    TOTAL ({itemSummaryTotals.count} Parts)
                  </td>
                  <td className="px-2.5 py-2 text-center text-slate-950 font-black bg-slate-200/50">
                    {itemSummaryTotals.periodQty}
                  </td>
                  <td className="px-2.5 py-2 text-center text-slate-800">
                    {itemSummaryTotals.todayQty}
                  </td>
                  <td className="px-2.5 py-2 text-center text-slate-800">
                    {itemSummaryTotals.mtdQty}
                  </td>
                  <td className="px-2.5 py-2 text-center text-amber-900 font-black bg-amber-100/40">
                    {itemSummaryTotals.tillNowQty}
                  </td>
                  <td className="px-2.5 py-2 text-center text-slate-700">
                    {itemSummaryTotals.tillNowStd}
                  </td>
                  <td className="px-2.5 py-2 text-center text-rose-700">
                    {itemSummaryTotals.tillNowRework}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {itemSummaryTotals.eff !== null ? (
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-black ${
                          itemSummaryTotals.eff >= 85
                            ? 'bg-emerald-600 text-white'
                            : itemSummaryTotals.eff >= 75
                            ? 'bg-amber-500 text-slate-950'
                            : 'bg-rose-600 text-white'
                        }`}
                      >
                        {itemSummaryTotals.eff}%
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* SECTION 2: Line Efficiency & Shift-to-Shift Comparison Table */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-2xs overflow-hidden space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <Layers className="w-4 h-4 text-slate-700" />
              <span>Line Efficiency & Shift-to-Shift Comparison</span>
            </h3>
            <p className="text-xs text-slate-500">
              Evaluated strictly on active machines (Std Output &gt; 0). Idle machines never drag down line efficiency.
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-mono text-slate-500">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>≥ 85% Target</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span>75-84% Moderate</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              <span>&lt; 75% Critical</span>
            </span>
          </div>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="bg-slate-900 text-slate-200 text-[11px] font-semibold uppercase">
              <tr>
                <th className="px-3 py-2 border-r border-slate-800">Production Line</th>
                <th className="px-2.5 py-2 border-r border-slate-800 text-center">Operating Footprint</th>
                <th className="px-2.5 py-2 border-r border-slate-800 text-center">Target (Std)</th>
                <th className="px-2.5 py-2 border-r border-slate-800 text-center">Actual (Pcs)</th>
                <th className="px-2.5 py-2 border-r border-slate-800 text-center">Line Eff %</th>
                <th className="px-2.5 py-2 border-r border-slate-800 text-center bg-slate-800/60">Shift A (7AM-3:30PM)</th>
                <th className="px-2.5 py-2 border-r border-slate-800 text-center bg-slate-800/60">Shift B (3:30PM-12AM)</th>
                <th className="px-2.5 py-2 border-r border-slate-800 text-center bg-slate-800/60">Shift C (12AM-7AM)</th>
                <th className="px-2.5 py-2 border-r border-slate-800 text-center">Shift Spread</th>
                <th className="px-3 py-2 text-center">Downtime</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono">
              {lineComparisonData.lines.map((line) => {
                const footprintPct = line.totalMachines > 0 ? Math.round((line.activeCount / line.totalMachines) * 100) : 0;
                return (
                  <tr key={line.lineName} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-sans font-bold text-slate-900 whitespace-nowrap">
                      {line.lineName}
                    </td>
                    <td className="px-2.5 py-2 text-center text-slate-700 whitespace-nowrap">
                      <span className="font-semibold text-emerald-800">{line.activeCount}</span>
                      <span className="text-slate-400"> / {line.totalMachines} active </span>
                      <span className="text-slate-500 font-mono text-[11px]">({footprintPct}%)</span>
                    </td>
                    <td className="px-2.5 py-2 text-center text-slate-600">{line.std}</td>
                    <td className="px-2.5 py-2 text-center font-bold text-slate-900">{line.act}</td>
                    <td className="px-2.5 py-2 text-center">
                      {line.std > 0 ? (
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-extrabold ${
                            line.eff >= 85
                              ? 'bg-emerald-100 text-emerald-800'
                              : line.eff >= 75
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {line.eff}%
                        </span>
                      ) : (
                        <span className="text-slate-400 font-sans italic text-[11px]">No Target</span>
                      )}
                    </td>
                    {/* Shift A */}
                    <td className="px-2.5 py-2 text-center bg-slate-50/60">
                      {line.aEff !== null ? (
                        <div>
                          <span className="font-bold text-slate-800">{line.aAct} pcs</span>
                          <span className="text-slate-500 text-[10px] ml-1">({line.aEff}%)</span>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-[11px]">Idle</span>
                      )}
                    </td>
                    {/* Shift B */}
                    <td className="px-2.5 py-2 text-center bg-slate-50/60">
                      {line.bEff !== null ? (
                        <div>
                          <span className="font-bold text-slate-800">{line.bAct} pcs</span>
                          <span className="text-slate-500 text-[10px] ml-1">({line.bEff}%)</span>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-[11px]">Idle</span>
                      )}
                    </td>
                    {/* Shift C */}
                    <td className="px-2.5 py-2 text-center bg-slate-50/60">
                      {line.cEff !== null ? (
                        <div>
                          <span className="font-bold text-slate-800">{line.cAct} pcs</span>
                          <span className="text-slate-500 text-[10px] ml-1">({line.cEff}%)</span>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-[11px]">Idle</span>
                      )}
                    </td>
                    {/* Shift Spread */}
                    <td className="px-2.5 py-2 text-center">
                      {line.spread !== null ? (
                        <span
                          className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${
                            line.spread >= 15
                              ? 'bg-rose-100 text-rose-800 border border-rose-300'
                              : line.spread >= 10
                              ? 'bg-amber-100 text-amber-800 border border-amber-300'
                              : 'text-slate-600'
                          }`}
                          title={line.spread >= 10 ? 'High efficiency disparity between shifts (≥ 10%)' : undefined}
                        >
                          {line.spread}% spread
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[11px]">Single Shift</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center text-amber-800 font-bold">{line.totalBd}m</td>
                  </tr>
                );
              })}
            </tbody>
            {/* Plant Total Footer Row */}
            <tfoot className="bg-slate-100 font-mono font-bold text-slate-900 border-t-2 border-slate-300">
              <tr>
                <td className="px-3 py-2.5 font-sans uppercase tracking-tight text-xs">
                  {lineComparisonData.plantTotal.lineName}
                </td>
                <td className="px-2.5 py-2.5 text-center text-emerald-800">
                  {lineComparisonData.plantTotal.activeCount} / {lineComparisonData.plantTotal.totalMachines} active (
                  {lineComparisonData.plantTotal.totalMachines > 0
                    ? Math.round(
                        (lineComparisonData.plantTotal.activeCount / lineComparisonData.plantTotal.totalMachines) * 100
                      )
                    : 0}
                  %)
                </td>
                <td className="px-2.5 py-2.5 text-center text-slate-700">{lineComparisonData.plantTotal.std}</td>
                <td className="px-2.5 py-2.5 text-center text-slate-950 font-black">{lineComparisonData.plantTotal.act}</td>
                <td className="px-2.5 py-2.5 text-center">
                  <span
                    className={`px-2.5 py-1 rounded text-xs font-black ${
                      lineComparisonData.plantTotal.eff >= 85
                        ? 'bg-emerald-600 text-white'
                        : lineComparisonData.plantTotal.eff >= 75
                        ? 'bg-amber-500 text-slate-950'
                        : 'bg-rose-600 text-white'
                    }`}
                  >
                    {lineComparisonData.plantTotal.eff}%
                  </span>
                </td>
                <td className="px-2.5 py-2.5 text-center text-slate-800">
                  {lineComparisonData.plantTotal.aEff !== null ? (
                    <span>{lineComparisonData.plantTotal.aAct} ({lineComparisonData.plantTotal.aEff}%)</span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-2.5 py-2.5 text-center text-slate-800">
                  {lineComparisonData.plantTotal.bEff !== null ? (
                    <span>{lineComparisonData.plantTotal.bAct} ({lineComparisonData.plantTotal.bEff}%)</span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-2.5 py-2.5 text-center text-slate-800">
                  {lineComparisonData.plantTotal.cEff !== null ? (
                    <span>{lineComparisonData.plantTotal.cAct} ({lineComparisonData.plantTotal.cEff}%)</span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-2.5 py-2.5 text-center">
                  {lineComparisonData.plantTotal.spread !== null ? (
                    <span className="font-bold text-slate-800">{lineComparisonData.plantTotal.spread}%</span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2.5 text-center text-amber-800">{lineComparisonData.plantTotal.totalBd}m</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* SECTION 3: Machine Efficiency Matrix & Shift Distribution */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-2xs overflow-hidden space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <Activity className="w-4 h-4 text-slate-700" />
              <span>Machine Efficiency Matrix & Shift Distribution</span>
            </h3>
            <p className="text-xs text-slate-500">
              Machine-level performance across active shifts with partial-line status tracking and shift variance analysis.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Machine Line Filter */}
            <select
              value={machineLineFilter}
              onChange={(e) => setMachineLineFilter(e.target.value)}
              className="bg-white border border-slate-300 text-xs font-medium text-slate-700 rounded px-2.5 py-1 focus:outline-none focus:border-slate-800"
            >
              <option value="all">All Lines (Machines)</option>
              {((masterData?.lines && masterData.lines.length > 0)
                ? masterData.lines.filter((l) => l.isActive !== false).map((l) => l.name)
                : PRODUCTION_LINES
              ).map((line) => (
                <option key={line} value={line}>
                  {line}
                </option>
              ))}
            </select>

            <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showIdleMachines}
                onChange={(e) => setShowIdleMachines(e.target.checked)}
                className="rounded text-slate-900 focus:ring-slate-800"
              />
              <span className="font-medium">Show Idle / Unassigned Machines</span>
            </label>
          </div>
        </div>

        <div className="overflow-x-auto max-h-96 border border-slate-200 rounded">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="bg-slate-900 text-slate-200 sticky top-0 z-10 text-[11px] font-semibold uppercase">
              <tr>
                <th className="px-3 py-2 border-r border-slate-800">Machine Name</th>
                <th className="px-2 py-2 border-r border-slate-800">Code</th>
                <th className="px-2.5 py-2 border-r border-slate-800">Line</th>
                <th className="px-2.5 py-2 border-r border-slate-800 text-center">Shifts Operated</th>
                <th className="px-2 py-2 border-r border-slate-800 text-center">Std</th>
                <th className="px-2 py-2 border-r border-slate-800 text-center">Actual</th>
                <th className="px-2 py-2 border-r border-slate-800 text-center">Machine Eff %</th>
                <th className="px-2.5 py-2 border-r border-slate-800 text-center bg-slate-800/60">Shift A (7AM-3:30PM)</th>
                <th className="px-2.5 py-2 border-r border-slate-800 text-center bg-slate-800/60">Shift B (3:30PM-12AM)</th>
                <th className="px-2.5 py-2 border-r border-slate-800 text-center bg-slate-800/60">Shift C (12AM-7AM)</th>
                <th className="px-3 py-2 border-r border-slate-800 text-center">Best / Worst Shift</th>
                <th className="px-2 py-2 border-r border-slate-800 text-center">Downtime</th>
                <th className="px-2 py-2 text-center">Rework</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono">
              {visibleMachineMetrics.length === 0 ? (
                <tr>
                  <td colSpan={13} className="text-center py-6 text-slate-500 font-sans">
                    No active machines found for current filters.
                    <button
                      type="button"
                      onClick={() => setShowIdleMachines(true)}
                      className="ml-2 font-semibold text-slate-900 underline hover:text-slate-700"
                    >
                      Show Idle Machines
                    </button>
                  </td>
                </tr>
              ) : (
                visibleMachineMetrics.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className="px-3 py-1.5 font-sans font-bold text-slate-900 whitespace-nowrap">
                      {m.name}
                    </td>
                    <td className="px-2 py-1.5 text-slate-600 whitespace-nowrap">{m.code}</td>
                    <td className="px-2.5 py-1.5 font-sans text-slate-700 whitespace-nowrap">{m.line}</td>
                    <td className="px-2.5 py-1.5 text-center whitespace-nowrap">
                      {m.isOperating ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                          {m.shiftsOperatedText}
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-500">
                          0 / 3 (Idle)
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-center text-slate-600">{m.std}</td>
                    <td className="px-2 py-1.5 text-center font-bold text-slate-900">{m.act}</td>
                    <td className="px-2 py-1.5 text-center">
                      {m.efficiency !== null ? (
                        <span
                          className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${
                            m.efficiency >= 85
                              ? 'bg-emerald-100 text-emerald-800'
                              : m.efficiency >= 75
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {m.efficiency}%
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-2.5 py-1.5 text-center bg-slate-50/60 whitespace-nowrap">
                      {m.aEff !== null ? (
                        <span>
                          {m.aAct} <strong className="text-[10px]">({m.aEff}%)</strong>
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-2.5 py-1.5 text-center bg-slate-50/60 whitespace-nowrap">
                      {m.bEff !== null ? (
                        <span>
                          {m.bAct} <strong className="text-[10px]">({m.bEff}%)</strong>
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-2.5 py-1.5 text-center bg-slate-50/60 whitespace-nowrap">
                      {m.cEff !== null ? (
                        <span>
                          {m.cAct} <strong className="text-[10px]">({m.cEff}%)</strong>
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-center whitespace-nowrap font-sans">
                      {m.bestWorstHighlight.isHighSpread ? (
                        <span
                          className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300"
                          title="Disparity ≥ 10% between shifts"
                        >
                          {m.bestWorstHighlight.text}
                        </span>
                      ) : (
                        <span className="text-slate-600 text-[11px]">
                          {m.bestWorstHighlight.text}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-center text-amber-700 font-bold">{m.downtime}m</td>
                    <td className="px-2 py-1.5 text-center text-rose-700">{m.rework}</td>
                  </tr>
                ))
              )}
            </tbody>
            {visibleMachineMetrics.length > 0 && (
              <tfoot className="bg-slate-100 font-mono font-bold text-slate-900 border-t-2 border-slate-300">
                {(() => {
                  const totalStd = visibleMachineMetrics.reduce((acc, m) => acc + m.std, 0);
                  const totalAct = visibleMachineMetrics.reduce((acc, m) => acc + m.act, 0);
                  const totalDowntime = Number(
                    visibleMachineMetrics.reduce((acc, m) => acc + m.downtime, 0).toFixed(2)
                  );
                  const totalRework = visibleMachineMetrics.reduce((acc, m) => acc + m.rework, 0);
                  const eff = totalStd > 0 ? Math.round((totalAct / totalStd) * 100) : null;
                  return (
                    <tr>
                      <td colSpan={4} className="px-3 py-2 font-sans uppercase text-xs tracking-tight">
                        TOTAL VISIBLE MACHINES ({visibleMachineMetrics.length})
                      </td>
                      <td className="px-2 py-2 text-center text-slate-700">{totalStd}</td>
                      <td className="px-2 py-2 text-center text-slate-950 font-black">{totalAct}</td>
                      <td className="px-2 py-2 text-center">
                        {eff !== null ? (
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-black ${
                              eff >= 85
                                ? 'bg-emerald-600 text-white'
                                : eff >= 75
                                ? 'bg-amber-500 text-slate-950'
                                : 'bg-rose-600 text-white'
                            }`}
                          >
                            {eff}%
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td colSpan={4} className="px-2 py-2 text-center text-slate-400 font-sans font-normal text-[11px]">
                        Shift-level summaries displayed in Section 2 above
                      </td>
                      <td className="px-2 py-2 text-center text-amber-800 font-bold">{totalDowntime}m</td>
                      <td className="px-2 py-2 text-center text-rose-700">{totalRework}</td>
                    </tr>
                  );
                })()}
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Breakdown Downtime Split & Pareto */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Machine Breakdown Categorization */}
        <div className="lg:col-span-2 bg-white rounded-lg border border-slate-200 p-4 sm:p-5 shadow-2xs space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 tracking-tight">
              Breakdown Downtime Categorization
            </h3>
            <p className="text-xs text-slate-500">
              Split across the 6 factory logging categories (Total: {kpis.totalBreakdown} mins)
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
            <div
              style={{ width: `${machineBdPct}%` }}
              className="bg-orange-500 h-full"
              title={`BREAK DOWN: ${kpis.breakdownSplit.machineBreakdown}m (${machineBdPct}%)`}
            />
            <div
              style={{ width: `${fixProgPct}%` }}
              className="bg-indigo-500 h-full"
              title={`FIX/PROG: ${kpis.breakdownSplit.fixProgSettings}m (${fixProgPct}%)`}
            />
          </div>

          {/* List breakdown with minutes and percentages */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
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
                  <span className="text-amber-700 font-semibold">{kpis.categoryWorkingPct.noDisc}% of total</span>
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
                  <span className="text-amber-700 font-semibold">{kpis.categoryWorkingPct.change}% of total</span>
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
                  <span className="text-amber-700 font-semibold">{kpis.categoryWorkingPct.power}% of total</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-100">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded bg-purple-500 inline-block" />
                <div>
                  <span className="font-bold text-slate-800">OPERATOR</span>
                  <p className="text-[10px] text-slate-500">Worker delay & unattended</p>
                </div>
              </div>
              <div className="text-right font-mono">
                <span className="font-bold text-slate-900">{kpis.breakdownSplit.operator} mins</span>
                <div className="flex items-center justify-end gap-1.5 text-[10px]">
                  <span className="text-slate-600 font-semibold">{operatorPct}% share</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-amber-700 font-semibold">{kpis.categoryWorkingPct.operator}% of total</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-100">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded bg-orange-500 inline-block" />
                <div>
                  <span className="font-bold text-slate-800">BREAK DOWN</span>
                  <p className="text-[10px] text-slate-500">Machine & mechanical fault</p>
                </div>
              </div>
              <div className="text-right font-mono">
                <span className="font-bold text-slate-900">{kpis.breakdownSplit.machineBreakdown} mins</span>
                <div className="flex items-center justify-end gap-1.5 text-[10px]">
                  <span className="text-slate-600 font-semibold">{machineBdPct}% share</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-amber-700 font-semibold">{kpis.categoryWorkingPct.machineBreakdown}% of total</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-100">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded bg-indigo-500 inline-block" />
                <div>
                  <span className="font-bold text-slate-800">FIX/PROG</span>
                  <p className="text-[10px] text-slate-500">Fixture & program setting</p>
                </div>
              </div>
              <div className="text-right font-mono">
                <span className="font-bold text-slate-900">{kpis.breakdownSplit.fixProgSettings} mins</span>
                <div className="flex items-center justify-end gap-1.5 text-[10px]">
                  <span className="text-slate-600 font-semibold">{fixProgPct}% share</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-amber-700 font-semibold">{kpis.categoryWorkingPct.fixProgSettings}% of total</span>
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
              onClick={handleExportCSV}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded flex items-center gap-1.5 shadow-2xs"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
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
                <th className="px-2 py-2 border-r border-slate-800 text-center">Run</th>
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
                  <td colSpan={15} className="text-center py-8 text-slate-500 font-sans">
                    No records found matching current date/shift/line filters.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((row, index) => {
                  const bdTotal = calculateTotalBreakdown(row.breakdown);
                  const eff = row.stdOutput > 0 ? calculateEfficiency(row.actualOutput, row.stdOutput) : 0;
                  const bdPct =
                    row.breakdownPct?.totalBdPct != null && row.breakdownPct.totalBdPct > 0
                      ? `${row.breakdownPct.totalBdPct}%`
                      : bdTotal > 0 && (row.totalWorkingMinutes || 1305) > 0
                      ? `${((bdTotal / (row.totalWorkingMinutes || 1305)) * 100).toFixed(1)}%`
                      : '0.0%';

                  return (
                    <tr key={row.id || `${row.date}_${row.shift}_${row.machineId}_${row.runNo || 1}_${index}`} className="hover:bg-slate-50">
                      <td className="px-3 py-1.5 text-slate-700 whitespace-nowrap">{row.date}</td>
                      <td className="px-2.5 py-1.5 text-slate-800 font-sans font-semibold whitespace-nowrap text-[11px]">
                        {row.line || 'Line 1'}
                      </td>
                      <td className="px-3 py-1.5 text-slate-700 whitespace-nowrap">{row.shift.split(' ')[0]}</td>
                      <td className="px-3 py-1.5 font-bold font-sans text-slate-900 whitespace-nowrap">
                        {row.machineName}
                      </td>
                      <td className="px-2 py-1.5 text-center text-slate-700 font-semibold whitespace-nowrap">
                        #{row.runNo || 1}
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
