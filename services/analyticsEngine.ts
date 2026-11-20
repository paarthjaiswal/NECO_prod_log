/**
 * Pure TypeScript Manufacturing Analytics & OEE Calculation Engine
 * 
 * Computes:
 * - Split-aware allocated planned time (prevents planned minutes from being double-counted)
 * - Availability %, Performance %, Quality %, OEE %, and Plan Achievement %
 * - Multi-dimensional rollups: Product-to-Line-Machine Matrix, Line, Shift, Period (Day/Week), Machine
 * 
 * Ultra-lightweight with ZERO external libraries.
 */

import { MachineShiftRow } from "@/types";
import { calculateTotalBreakdown } from "@/services/storageService";

export interface EnrichedAnalyticsRow extends MachineShiftRow {
  allocatedPlannedMinutes: number;
  isSplitRun: boolean;
  totalBreakdownMinutes: number;
  operatingMinutes: number;
  idealRunMinutes: number;
  goodOutput: number;
}

export interface BreakdownTotals {
  noDisc: number;
  change: number;
  power: number;
  operator: number;
  machineBreakdown: number;
  fixProgSettings: number;
  miscellaneous: number;
  total: number;
}

export interface OeeMetrics {
  plannedMinutes: number;
  downtimeMinutes: number;
  operatingMinutes: number;
  idealRunMinutes: number;
  totalActual: number;
  totalStd: number;
  totalRework: number;
  goodOutput: number;
  availabilityPct: number;
  performancePct: number;
  qualityPct: number;
  oeePct: number;
  planAchievementPct: number;
  breakdownTotals: BreakdownTotals;
  tempMachineRunsCount: number;
  splitRunsCount: number;
  rowCount: number;
}

export interface ProductMatrixRow {
  line: string;
  machineId: string;
  machineName: string;
  operation: string;
  isTempMachine: boolean;
  splitRunsCount: number;
  runNos: number[];
  stdOutput: number;
  actualOutput: number;
  rework: number;
  goodOutput: number;
  breakdownMinutes: number;
  metrics: OeeMetrics;
  latestDate: string;
  latestShift: string;
  latestLine: string;
}

export interface ProductMatrixItem {
  productKey: string;
  productName: string;
  productCode: string;
  metrics: OeeMetrics;
  lines: string[];
  matrix: ProductMatrixRow[];
}

export interface ItemSummary {
  itemId: string;
  itemName: string;
  actualOutput: number;
  stdOutput: number;
  rework: number;
  goodOutput: number;
}

export interface LineRollupItem {
  line: string;
  metrics: OeeMetrics;
  itemsProduced: ItemSummary[];
  machineCount: number;
  permMachineCount: number;
  tempMachineCount: number;
}

export interface ShiftRollupItem {
  shift: string;
  metrics: OeeMetrics;
  topItems: ItemSummary[];
  machineCount: number;
}

export interface PeriodRollupItem {
  periodKey: string;
  periodLabel: string;
  metrics: OeeMetrics;
  itemsProduced: ItemSummary[];
  activeDates: string[];
  activeShifts: string[];
  activeLines: string[];
}

export interface MachineRollupItem {
  machineId: string;
  machineName: string;
  line: string;
  isTempMachine: boolean;
  splitRunsCount: number;
  itemsProduced: ItemSummary[];
  metrics: OeeMetrics;
  latestDate: string;
  latestShift: string;
  latestLine: string;
}

/**
 * Filter out completely empty/unlogged rows (e.g. idle machines with zero targets and zero activity).
 */
export function isUnloggedEmptyRow(row: MachineShiftRow): boolean {
  const actual = Number(row.actualOutput) || 0;
  const std = Number(row.stdOutput) || 0;
  const rework = Number(row.rework) || 0;
  const bd = calculateTotalBreakdown(row.breakdown);
  const itemId = (row.itemId || "").trim();
  const itemName = (row.itemName || "").trim();
  const operatorName = (row.operatorName || "").trim();

  return actual === 0 && std === 0 && rework === 0 && bd === 0 && !itemId && !itemName && !operatorName;
}

/**
 * Step 1: Split-Aware Allocated Planned Time Helper
 * Groups logs by `${date}|${shift}|${line}|${machineId}` and allocates shift working minutes
 * proportionally across split runs so planned minutes are NEVER double-counted.
 */
export function computeAllocatedPlannedMinutes(logs: MachineShiftRow[]): EnrichedAnalyticsRow[] {
  // 1. Drop untouched, unlogged placeholder rows
  const activeLogs = logs.filter((r) => !isUnloggedEmptyRow(r));

  // 2. Group by machine-shift key
  const groups = new Map<string, MachineShiftRow[]>();
  for (const row of activeLogs) {
    const key = `${row.date || ""}|${row.shift || ""}|${row.line || ""}|${row.machineId || row.machineName || ""}`;
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }

  const enrichedRows: EnrichedAnalyticsRow[] = [];

  for (const group of groups.values()) {
    const isSplit = group.length > 1;
    const shiftTotal = Math.max(...group.map((r) => Number(r.totalWorkingMinutes) || 465));

    if (!isSplit) {
      const r = group[0];
      const allocatedPlanned = Number(r.totalWorkingMinutes) || 465;
      const bdMins = calculateTotalBreakdown(r.breakdown);
      const actual = Number(r.actualOutput) || 0;
      const rework = Number(r.rework) || 0;
      const ct = Number(r.cycleTime) || 0;

      enrichedRows.push({
        ...r,
        allocatedPlannedMinutes: allocatedPlanned,
        isSplitRun: false,
        totalBreakdownMinutes: bdMins,
        operatingMinutes: Math.max(0, allocatedPlanned - bdMins),
        idealRunMinutes: Number((actual * ct).toFixed(2)),
        goodOutput: Math.max(0, actual - rework),
      });
    } else {
      // Multiple split runs for this machine-shift: compute weights
      const rawSlices = group.map((r) => {
        const std = Number(r.stdOutput) || 0;
        const actual = Number(r.actualOutput) || 0;
        const ct = Number(r.cycleTime) || 0;
        const bd = calculateTotalBreakdown(r.breakdown);
        const prodWeight = std > 0 && ct > 0 ? std * ct : actual * ct;
        return prodWeight + bd;
      });

      const sumRawSlice = rawSlices.reduce((acc, val) => acc + val, 0);

      group.forEach((r, idx) => {
        let allocated: number;
        if (sumRawSlice > 0) {
          allocated = Number(((rawSlices[idx] / sumRawSlice) * shiftTotal).toFixed(2));
        } else {
          allocated = Number((shiftTotal / group.length).toFixed(2));
        }

        const bdMins = calculateTotalBreakdown(r.breakdown);
        const actual = Number(r.actualOutput) || 0;
        const rework = Number(r.rework) || 0;
        const ct = Number(r.cycleTime) || 0;

        enrichedRows.push({
          ...r,
          allocatedPlannedMinutes: allocated,
          isSplitRun: true,
          totalBreakdownMinutes: bdMins,
          operatingMinutes: Math.max(0, allocated - bdMins),
          idealRunMinutes: Number((actual * ct).toFixed(2)),
          goodOutput: Math.max(0, actual - rework),
        });
      });
    }
  }

  return enrichedRows;
}

/**
 * Step 2: Core OEE Calculator
 * Calculates Availability, Performance, Quality, OEE, Plan Achievement, and 7-category breakdown totals.
 */
export function calculateOeeMetrics(enrichedRows: EnrichedAnalyticsRow[]): OeeMetrics {
  let plannedMinutes = 0;
  let downtimeMinutes = 0;
  let idealRunMinutes = 0;
  let totalActual = 0;
  let totalStd = 0;
  let totalRework = 0;
  let goodOutput = 0;

  let noDisc = 0;
  let change = 0;
  let power = 0;
  let operator = 0;
  let machineBreakdown = 0;
  let fixProgSettings = 0;
  let miscellaneous = 0;

  let tempMachineRunsCount = 0;
  let splitRunsCount = 0;

  for (const r of enrichedRows) {
    plannedMinutes += Number(r.allocatedPlannedMinutes) || 0;
    downtimeMinutes += Number(r.totalBreakdownMinutes) || 0;
    idealRunMinutes += Number(r.idealRunMinutes) || 0;
    totalActual += Number(r.actualOutput) || 0;
    totalStd += Number(r.stdOutput) || 0;
    totalRework += Number(r.rework) || 0;
    goodOutput += Number(r.goodOutput) || 0;

    const b = r.breakdown;
    if (b) {
      noDisc += Number(b.noDisc) || 0;
      change += Number(b.change) || 0;
      power += Number(b.power) || 0;
      operator += Number(b.operator) || 0;
      machineBreakdown += Number(b.machineBreakdown) || 0;
      fixProgSettings += Number(b.fixProgSettings) || 0;
      miscellaneous += Number(b.miscellaneous) || 0;
    }

    if (r.isTempMachine) tempMachineRunsCount++;
    if (r.isSplitRun) splitRunsCount++;
  }

  plannedMinutes = Number(plannedMinutes.toFixed(2));
  downtimeMinutes = Number(downtimeMinutes.toFixed(2));
  const operatingMinutes = Number(Math.max(0, plannedMinutes - downtimeMinutes).toFixed(2));
  idealRunMinutes = Number(idealRunMinutes.toFixed(2));

  const availabilityPct =
    plannedMinutes > 0 ? Number(((operatingMinutes / plannedMinutes) * 100).toFixed(2)) : 0;
  const performancePct =
    operatingMinutes > 0 ? Number(((idealRunMinutes / operatingMinutes) * 100).toFixed(2)) : 0;
  const qualityPct =
    totalActual > 0 ? Number(((goodOutput / totalActual) * 100).toFixed(2)) : 0;
  const oeePct = Number(((availabilityPct * performancePct * qualityPct) / 10000).toFixed(2));
  const planAchievementPct =
    totalStd > 0 ? Number(((totalActual / totalStd) * 100).toFixed(2)) : 0;

  return {
    plannedMinutes,
    downtimeMinutes,
    operatingMinutes,
    idealRunMinutes,
    totalActual,
    totalStd,
    totalRework,
    goodOutput,
    availabilityPct,
    performancePct,
    qualityPct,
    oeePct,
    planAchievementPct,
    breakdownTotals: {
      noDisc: Number(noDisc.toFixed(2)),
      change: Number(change.toFixed(2)),
      power: Number(power.toFixed(2)),
      operator: Number(operator.toFixed(2)),
      machineBreakdown: Number(machineBreakdown.toFixed(2)),
      fixProgSettings: Number(fixProgSettings.toFixed(2)),
      miscellaneous: Number(miscellaneous.toFixed(2)),
      total: downtimeMinutes,
    },
    tempMachineRunsCount,
    splitRunsCount,
    rowCount: enrichedRows.length,
  };
}

/**
 * Step 3A: Product-to-Line/Machine Traceability Matrix
 * Groups by Product (canonical itemName / itemId), returning overall OEE + Line & Machine Matrix Table.
 */
export function buildProductLineMachineMatrix(
  enrichedRows: EnrichedAnalyticsRow[]
): ProductMatrixItem[] {
  const productMap = new Map<string, EnrichedAnalyticsRow[]>();

  for (const r of enrichedRows) {
    const rawName = (r.itemName || "").trim();
    const rawId = (r.itemId || "").trim();
    if (!rawName && !rawId) continue;
    const key = (rawName || rawId).toLowerCase();

    const list = productMap.get(key) || [];
    list.push(r);
    productMap.set(key, list);
  }

  const result: ProductMatrixItem[] = [];

  for (const [key, rows] of productMap.entries()) {
    const sample = rows[0];
    const productName = sample.itemName || sample.itemId || key;
    const productCode = sample.itemId || "";
    const lines = Array.from(new Set(rows.map((r) => r.line || "Line 1"))).sort();
    const overallMetrics = calculateOeeMetrics(rows);

    // Group by Line -> Machine -> Operation
    const subMap = new Map<string, EnrichedAnalyticsRow[]>();
    for (const r of rows) {
      const line = r.line || "Line 1";
      const mId = r.machineId || r.machineName || "Unknown";
      const op = (r.operation || "Default").trim();
      const subKey = `${line}__${mId}__${op.toLowerCase()}`;
      const subList = subMap.get(subKey) || [];
      subList.push(r);
      subMap.set(subKey, subList);
    }

    const matrix: ProductMatrixRow[] = [];
    for (const subRows of subMap.values()) {
      const s = subRows[0];
      const line = s.line || "Line 1";
      const machineId = s.machineId || "";
      const machineName = s.machineName || s.machineId || "Unknown";
      const operation = s.operation || "-";
      const isTemp = subRows.some((r) => r.isTempMachine);
      const splitCount = subRows.filter((r) => r.isSplitRun).length;
      const runNos = Array.from(new Set(subRows.map((r) => r.runNo || 1))).sort((a, b) => a - b);

      const std = subRows.reduce((acc, r) => acc + (Number(r.stdOutput) || 0), 0);
      const act = subRows.reduce((acc, r) => acc + (Number(r.actualOutput) || 0), 0);
      const rew = subRows.reduce((acc, r) => acc + (Number(r.rework) || 0), 0);
      const good = subRows.reduce((acc, r) => acc + (r.goodOutput || 0), 0);
      const bd = subRows.reduce((acc, r) => acc + (r.totalBreakdownMinutes || 0), 0);

      // Latest contextual date & shift
      const sortedByDate = [...subRows].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      const latest = sortedByDate[0];

      matrix.push({
        line,
        machineId,
        machineName,
        operation,
        isTempMachine: isTemp,
        splitRunsCount: splitCount,
        runNos,
        stdOutput: std,
        actualOutput: act,
        rework: rew,
        goodOutput: good,
        breakdownMinutes: Number(bd.toFixed(2)),
        metrics: calculateOeeMetrics(subRows),
        latestDate: latest?.date || "",
        latestShift: latest?.shift || "",
        latestLine: latest?.line || line,
      });
    }

    // Sort matrix by Line then Machine
    matrix.sort((a, b) => {
      const lineCmp = a.line.localeCompare(b.line);
      if (lineCmp !== 0) return lineCmp;
      return a.machineName.localeCompare(b.machineName);
    });

    result.push({
      productKey: key,
      productName,
      productCode,
      metrics: overallMetrics,
      lines,
      matrix,
    });
  }

  // Sort products by Actual Output descending
  result.sort((a, b) => b.metrics.totalActual - a.metrics.totalActual);
  return result;
}

/**
 * Step 3B: Group By Line
 */
export function groupByLine(enrichedRows: EnrichedAnalyticsRow[]): LineRollupItem[] {
  const lineMap = new Map<string, EnrichedAnalyticsRow[]>();

  for (const r of enrichedRows) {
    const line = r.line || "Line 1";
    const list = lineMap.get(line) || [];
    list.push(r);
    lineMap.set(line, list);
  }

  const result: LineRollupItem[] = [];

  for (const [line, rows] of lineMap.entries()) {
    const metrics = calculateOeeMetrics(rows);

    // Summarize items
    const itemMap = new Map<string, ItemSummary>();
    for (const r of rows) {
      const name = r.itemName || r.itemId || "Unknown";
      const id = r.itemId || name;
      const key = `${id}__${name}`;
      const existing = itemMap.get(key) || {
        itemId: id,
        itemName: name,
        actualOutput: 0,
        stdOutput: 0,
        rework: 0,
        goodOutput: 0,
      };
      existing.actualOutput += Number(r.actualOutput) || 0;
      existing.stdOutput += Number(r.stdOutput) || 0;
      existing.rework += Number(r.rework) || 0;
      existing.goodOutput += Number(r.goodOutput) || 0;
      itemMap.set(key, existing);
    }

    const itemsProduced = Array.from(itemMap.values()).sort(
      (a, b) => b.actualOutput - a.actualOutput
    );

    const machines = new Set(rows.map((r) => r.machineId || r.machineName));
    const tempMachines = new Set(
      rows.filter((r) => r.isTempMachine).map((r) => r.machineId || r.machineName)
    );
    const permMachinesCount = machines.size - tempMachines.size;

    result.push({
      line,
      metrics,
      itemsProduced,
      machineCount: machines.size,
      permMachineCount: Math.max(0, permMachinesCount),
      tempMachineCount: tempMachines.size,
    });
  }

  result.sort((a, b) => a.line.localeCompare(b.line));
  return result;
}

/**
 * Step 3C: Group By Shift
 */
export function groupByShift(enrichedRows: EnrichedAnalyticsRow[]): ShiftRollupItem[] {
  const shiftMap = new Map<string, EnrichedAnalyticsRow[]>();

  for (const r of enrichedRows) {
    const shift = r.shift || "Shift A";
    const list = shiftMap.get(shift) || [];
    list.push(r);
    shiftMap.set(shift, list);
  }

  const result: ShiftRollupItem[] = [];

  for (const [shift, rows] of shiftMap.entries()) {
    const metrics = calculateOeeMetrics(rows);

    const itemMap = new Map<string, ItemSummary>();
    for (const r of rows) {
      const name = r.itemName || r.itemId || "Unknown";
      const id = r.itemId || name;
      const key = `${id}__${name}`;
      const existing = itemMap.get(key) || {
        itemId: id,
        itemName: name,
        actualOutput: 0,
        stdOutput: 0,
        rework: 0,
        goodOutput: 0,
      };
      existing.actualOutput += Number(r.actualOutput) || 0;
      existing.stdOutput += Number(r.stdOutput) || 0;
      existing.rework += Number(r.rework) || 0;
      existing.goodOutput += Number(r.goodOutput) || 0;
      itemMap.set(key, existing);
    }

    const topItems = Array.from(itemMap.values()).sort((a, b) => b.actualOutput - a.actualOutput);
    const machines = new Set(rows.map((r) => r.machineId || r.machineName));

    result.push({
      shift,
      metrics,
      topItems,
      machineCount: machines.size,
    });
  }

  result.sort((a, b) => a.shift.localeCompare(b.shift));
  return result;
}

/**
 * Helper to get ISO Week info (e.g. "2026-W47", label: "W47 (16 Nov – 22 Nov 2026)")
 */
export function getIsoWeekInfo(dateStr: string): {
  weekKey: string;
  label: string;
  weekNumber: number;
  year: number;
} {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0, Sunday = 6
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = d.getTime();
  d.setUTCMonth(0, 1);
  if (d.getUTCDay() !== 4) {
    d.setUTCMonth(0, 1 + ((4 - d.getUTCDay() + 7) % 7));
  }
  const weekNumber = 1 + Math.ceil((firstThursday - d.getTime()) / 604800000);
  const targetYear = new Date(firstThursday).getUTCFullYear();

  const srcDate = new Date(dateStr + "T00:00:00Z");
  const dayOffset = (srcDate.getUTCDay() + 6) % 7;
  const monday = new Date(srcDate);
  monday.setUTCDate(srcDate.getUTCDate() - dayOffset);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monStr = `${monday.getUTCDate()} ${months[monday.getUTCMonth()]}`;
  const sunStr = `${sunday.getUTCDate()} ${months[sunday.getUTCMonth()]}`;
  const weekKey = `${targetYear}-W${String(weekNumber).padStart(2, "0")}`;
  const label = `W${weekNumber} (${monStr} – ${sunStr})`;

  return { weekKey, label, weekNumber, year: targetYear };
}

/**
 * Step 3D: Group By Period ('day' | 'week')
 */
export function groupByPeriod(
  enrichedRows: EnrichedAnalyticsRow[],
  granularity: "day" | "week"
): PeriodRollupItem[] {
  const periodMap = new Map<string, { label: string; rows: EnrichedAnalyticsRow[] }>();

  for (const r of enrichedRows) {
    const dateStr = r.date || "";
    if (!dateStr) continue;

    let periodKey: string;
    let periodLabel: string;

    if (granularity === "day") {
      periodKey = dateStr;
      // Format: 19 Nov 2026
      try {
        const parts = dateStr.split("-");
        if (parts.length === 3) {
          const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          const monthIdx = parseInt(parts[1], 10) - 1;
          periodLabel = `${parts[2]} ${months[monthIdx] || parts[1]} ${parts[0]}`;
        } else {
          periodLabel = dateStr;
        }
      } catch {
        periodLabel = dateStr;
      }
    } else {
      const weekInfo = getIsoWeekInfo(dateStr);
      periodKey = weekInfo.weekKey;
      periodLabel = weekInfo.label;
    }

    const existing = periodMap.get(periodKey) || { label: periodLabel, rows: [] };
    existing.rows.push(r);
    periodMap.set(periodKey, existing);
  }

  const result: PeriodRollupItem[] = [];

  for (const [periodKey, { label, rows }] of periodMap.entries()) {
    const metrics = calculateOeeMetrics(rows);

    const itemMap = new Map<string, ItemSummary>();
    for (const r of rows) {
      const name = r.itemName || r.itemId || "Unknown";
      const id = r.itemId || name;
      const key = `${id}__${name}`;
      const existing = itemMap.get(key) || {
        itemId: id,
        itemName: name,
        actualOutput: 0,
        stdOutput: 0,
        rework: 0,
        goodOutput: 0,
      };
      existing.actualOutput += Number(r.actualOutput) || 0;
      existing.stdOutput += Number(r.stdOutput) || 0;
      existing.rework += Number(r.rework) || 0;
      existing.goodOutput += Number(r.goodOutput) || 0;
      itemMap.set(key, existing);
    }

    const itemsProduced = Array.from(itemMap.values()).sort((a, b) => b.actualOutput - a.actualOutput);
    const activeDates = Array.from(new Set(rows.map((r) => r.date).filter(Boolean) as string[])).sort();
    const activeShifts = Array.from(new Set(rows.map((r) => r.shift).filter(Boolean) as string[])).sort();
    const activeLines = Array.from(new Set(rows.map((r) => r.line).filter(Boolean) as string[])).sort();

    result.push({
      periodKey,
      periodLabel: label,
      metrics,
      itemsProduced,
      activeDates,
      activeShifts,
      activeLines,
    });
  }

  // Sort descending by periodKey (newest first)
  result.sort((a, b) => b.periodKey.localeCompare(a.periodKey));
  return result;
}

/**
 * Step 3E: Group By Machine
 */
export function groupByMachine(enrichedRows: EnrichedAnalyticsRow[]): MachineRollupItem[] {
  const machineMap = new Map<string, EnrichedAnalyticsRow[]>();

  for (const r of enrichedRows) {
    const mId = r.machineId || r.machineName || "Unknown";
    const list = machineMap.get(mId) || [];
    list.push(r);
    machineMap.set(mId, list);
  }

  const result: MachineRollupItem[] = [];

  for (const [mId, rows] of machineMap.entries()) {
    const s = rows[0];
    const machineName = s.machineName || s.machineId || mId;
    const line = s.line || "Line 1";
    const isTemp = rows.some((r) => r.isTempMachine);
    const splitCount = rows.filter((r) => r.isSplitRun).length;
    const metrics = calculateOeeMetrics(rows);

    const itemMap = new Map<string, ItemSummary>();
    for (const r of rows) {
      const name = r.itemName || r.itemId || "Unknown";
      const id = r.itemId || name;
      const key = `${id}__${name}`;
      const existing = itemMap.get(key) || {
        itemId: id,
        itemName: name,
        actualOutput: 0,
        stdOutput: 0,
        rework: 0,
        goodOutput: 0,
      };
      existing.actualOutput += Number(r.actualOutput) || 0;
      existing.stdOutput += Number(r.stdOutput) || 0;
      existing.rework += Number(r.rework) || 0;
      existing.goodOutput += Number(r.goodOutput) || 0;
      itemMap.set(key, existing);
    }

    const itemsProduced = Array.from(itemMap.values()).sort((a, b) => b.actualOutput - a.actualOutput);

    const sortedByDate = [...rows].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const latest = sortedByDate[0];

    result.push({
      machineId: mId,
      machineName,
      line,
      isTempMachine: isTemp,
      splitRunsCount: splitCount,
      itemsProduced,
      metrics,
      latestDate: latest?.date || "",
      latestShift: latest?.shift || "",
      latestLine: latest?.line || line,
    });
  }

  return result;
}
