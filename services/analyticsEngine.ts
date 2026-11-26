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

import {
  MachineShiftRow,
  MachineMaster,
  ItemMaster,
  MachineItemCycleTime,
  BreakdownMinutes,
  ShiftItemProductionRow,
} from "@/types";
import { calculateTotalBreakdown, isShiftRowEmpty, buildCanonicalItemKey } from "@/services/storageService";

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

export interface ProductQcMetrics {
  preQcProduction: number;      // Authoritative count from shift_item_production.total_production
  qcPassed: number;             // Currently === preQcProduction (100% assumed pending QC module)
  qcRejected: number;           // Currently 0
  qcPassPct: number;            // preQcProduction > 0 ? 100 : 0
  isQcAssumed: boolean;         // true until Quality Inspection module is connected
  hasLoggedProduction: boolean; // true if at least one shift_item_production row exists
}

/**
 * Future-proof QC resolver:
 * Currently assumes 100% pass rate for pre-QC finished production.
 * Once a dedicated Quality Inspection module is added, this function can be easily swapped
 * to read real inspection lots/rejections without breaking existing downstream consumers.
 */
export function resolveProductQcMetrics(
  preQcProduction: number,
  hasLoggedProduction: boolean = true
): ProductQcMetrics {
  const prod = Math.max(0, Number(preQcProduction) || 0);
  return {
    preQcProduction: prod,
    qcPassed: prod,
    qcRejected: 0,
    qcPassPct: prod > 0 ? 100 : 0,
    isQcAssumed: true,
    hasLoggedProduction,
  };
}

export interface ProductOperationMachineRow {
  machineId: string;
  machineName: string;
  line: string;
  isTempMachine: boolean;
  splitRunsCount: number;
  runsCount: number;
  minSrNo: number;
  stdOutput: number;
  actualOutput: number;
  goodOutput: number;
  rework: number;
  downtimeMinutes: number;
  planAchievementPct: number;
  availabilityPct: number;
  qualityPct: number;
  oeePct: number;
  breakdownTotals?: BreakdownTotals;
  metrics?: OeeMetrics;
}

export interface ProductOperationGroup {
  operationKey: string;          // normalized lowercase trimmed op, or "__unspecified__"
  operation: string;             // display label, or "Unspecified Operation"
  minSrNo: number;               // earliest machine sr_no in this operation to preserve line process order
  machinesCount: number;
  combinedActualOutput: number;  // sum of actualOutput across all machines doing this op on this item
  combinedStdOutput: number;     // sum of stdOutput across all machines doing this op
  combinedGoodOutput: number;
  combinedRework: number;
  combinedPlanAchievementPct: number;
  combinedOeePct: number;        // computed via calculateOeeMetrics(opRows)
  machines: ProductOperationMachineRow[];
}

export interface ProductMatrixItem {
  productKey: string;
  productName: string;
  productCode: string;
  metrics: OeeMetrics;
  lines: string[];
  matrix: ProductMatrixRow[];
  operationGroups: ProductOperationGroup[];
  preQcProduction: number;
  finishedProduction: number; // Kept for backwards-compatibility aliased to preQcProduction
  dailyPreQcProduction: Record<string, number>;
  dailyFinishedProduction: Record<string, number>; // Kept for backwards-compatibility
  qcMetrics: ProductQcMetrics;
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
  preQcProduction: number;
  finishedProduction: number;
  qcMetrics: ProductQcMetrics;
}

export interface ShiftDayLineEntry {
  date: string;                 // YYYY-MM-DD
  shift: string;                // full shift string
  line: string;                 // e.g. 'Line 4'
  machinesCount: number;
  qc: ProductQcMetrics;         // from resolveProductQcMetrics for (date, shift, line)
  machineOpsActual: number;
  machineOpsStd: number;
  rework: number;
  downtimeMinutes: number;
  planAchievementPct: number;
  availabilityPct: number;
  qualityPct: number;
  oeePct: number;
}

export interface ShiftRollupItem {
  shift: string;
  metrics: OeeMetrics;
  topItems: ItemSummary[];
  machineCount: number;
  preQcProduction: number;
  finishedProduction: number;
  qcMetrics: ProductQcMetrics;
  dailyEntries: ShiftDayLineEntry[];
}

export interface DailyItemShiftRow {
  shift: string;                 // e.g. 'Shift A (7AM-3:30PM)'
  shiftShortLabel: string;       // e.g. 'Shift A', 'Shift B', 'Shift C'
  qc: ProductQcMetrics;          // from resolveProductQcMetrics on shift_item_production for (date, shift, itemKey)
  machineOpsActual: number;      // sum of shift_logs.actualOutput for (date, shift, itemKey)
  machineOpsStd: number;         // sum of shift_logs.stdOutput
  machineRunsCount: number;      // count of shift_logs rows
  rework: number;
  downtimeMinutes: number;
  planAchievementPct: number;
  availabilityPct: number;
  qualityPct: number;
  oeePct: number;
}

export interface DailyItemBreakdown {
  itemKey: string;               // buildCanonicalItemKey(itemCode, itemName)
  itemCode: string;
  itemName: string;
  dayQc: ProductQcMetrics;       // full-day Pre-QC / QC Passed total for this item on this date
  dayMachineOpsActual: number;
  dayMachineOpsStd: number;
  dayRework: number;
  dayDowntimeMinutes: number;
  dayOeePct: number;
  shifts: DailyItemShiftRow[];   // ordered Shift A -> Shift B -> Shift C (plus any other shifts alphabetically)
}

export interface DailyShiftSummaryTotal {
  shift: string;
  shiftShortLabel: string;
  preQcProduction: number;
  machineOpsActual: number;
  oeePct: number;
}

export interface PeriodRollupItem {
  periodKey: string;
  periodLabel: string;
  metrics: OeeMetrics;
  itemsProduced: ItemSummary[];
  activeDates: string[];
  activeShifts: string[];
  activeLines: string[];
  preQcProduction: number;
  finishedProduction: number;
  qcMetrics: ProductQcMetrics;
  itemShiftBreakdown: DailyItemBreakdown[];
  shiftTotals: DailyShiftSummaryTotal[];
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

export type MachineGroupByMode = "none" | "line" | "item";

export interface MachineMatrixGroup {
  groupKey: string;
  groupLabel: string;
  groupSubLabel?: string;
  groupType: MachineGroupByMode;
  machinesCount: number;
  preQcProduction?: number;
  qcMetrics?: ProductQcMetrics;
  metrics: OeeMetrics;
  machines: MachineRollupItem[];
}

/**
 * Filter out completely empty/unlogged rows (e.g. idle machines with zero targets and zero activity).
 */
export function isUnloggedEmptyRow(row: MachineShiftRow): boolean {
  return isShiftRowEmpty(row);
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
  let goodIdealMinutes = 0;
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
    const rGood = Number(r.goodOutput) || 0;
    goodOutput += rGood;
    const ct = Number(r.cycleTime) || 0;
    goodIdealMinutes += rGood * ct;

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
  goodIdealMinutes = Number(goodIdealMinutes.toFixed(2));

  const availabilityPct =
    plannedMinutes > 0 ? Number(((operatingMinutes / plannedMinutes) * 100).toFixed(2)) : 0;
  const qualityPct =
    totalActual > 0 ? Number(((goodOutput / totalActual) * 100).toFixed(2)) : 0;
  const oeePct =
    plannedMinutes > 0 ? Number(((goodIdealMinutes / plannedMinutes) * 100).toFixed(2)) : 0;
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
 * Operation-Grouped Matrix Builder:
 * Groups an item's machine runs by operation so machines performing the same operation
 * on an item are clustered together with combined production totals.
 */
export function buildProductOperationGroups(
  productRows: EnrichedAnalyticsRow[]
): ProductOperationGroup[] {
  // 1. Group rows by normalized operationKey
  const opMap = new Map<string, { opDisplay: string; rows: EnrichedAnalyticsRow[] }>();

  for (const r of productRows) {
    const rawOp = (r.operation || "").trim();
    const opKey = rawOp.length > 0 ? rawOp.toLowerCase() : "__unspecified__";
    const opDisplay = rawOp.length > 0 ? rawOp : "Unspecified Operation";

    const entry = opMap.get(opKey) || { opDisplay, rows: [] };
    entry.rows.push(r);
    opMap.set(opKey, entry);
  }

  const operationGroups: ProductOperationGroup[] = [];

  for (const [opKey, { opDisplay, rows: opGroupRows }] of opMap.entries()) {
    // 2. Sub-group by (line, machineId || machineName, isTempMachine)
    const machineMap = new Map<string, EnrichedAnalyticsRow[]>();
    for (const r of opGroupRows) {
      const line = r.line || "Line 1";
      const mId = r.machineId || r.machineName || "Unknown";
      const isTemp = Boolean(r.isTempMachine);
      const subKey = `${line}__${mId}__${isTemp}`;
      const list = machineMap.get(subKey) || [];
      list.push(r);
      machineMap.set(subKey, list);
    }

    const machines: ProductOperationMachineRow[] = [];
    for (const machineOpRows of machineMap.values()) {
      const mMetrics = calculateOeeMetrics(machineOpRows);
      // Only include machines that actually produced or reworked on this item
      if (mMetrics.totalActual <= 0 && mMetrics.totalRework <= 0) continue;

      const s = machineOpRows[0];
      const minSrNo = Math.min(...machineOpRows.map((r) => Number(r.srNo) || 9999));

      machines.push({
        machineId: s.machineId || "",
        machineName: s.machineName || s.machineId || "Unknown",
        line: s.line || "Line 1",
        isTempMachine: machineOpRows.some((r) => r.isTempMachine),
        splitRunsCount: machineOpRows.filter((r) => r.isSplitRun).length,
        runsCount: machineOpRows.length,
        minSrNo,
        stdOutput: mMetrics.totalStd,
        actualOutput: mMetrics.totalActual,
        goodOutput: mMetrics.goodOutput,
        rework: mMetrics.totalRework,
        downtimeMinutes: mMetrics.downtimeMinutes,
        planAchievementPct: mMetrics.planAchievementPct,
        availabilityPct: mMetrics.availabilityPct,
        qualityPct: mMetrics.qualityPct,
        oeePct: mMetrics.oeePct,
        breakdownTotals: mMetrics.breakdownTotals,
        metrics: mMetrics,
      });
    }

    if (machines.length === 0) continue;

    // 3. Sort machines inside this operation group by minSrNo ASC, then actualOutput DESC, then machineName ASC
    machines.sort((a, b) => {
      if (a.minSrNo !== b.minSrNo) return a.minSrNo - b.minSrNo;
      if (b.actualOutput !== a.actualOutput) return b.actualOutput - a.actualOutput;
      return a.machineName.localeCompare(b.machineName);
    });

    const combinedActualOutput = machines.reduce((acc, m) => acc + m.actualOutput, 0);
    const combinedStdOutput = machines.reduce((acc, m) => acc + m.stdOutput, 0);
    const combinedGoodOutput = machines.reduce((acc, m) => acc + m.goodOutput, 0);
    const combinedRework = machines.reduce((acc, m) => acc + m.rework, 0);
    const combinedPlanAchievementPct =
      combinedStdOutput > 0
        ? Number(((combinedActualOutput / combinedStdOutput) * 100).toFixed(2))
        : 0;

    const opMetrics = calculateOeeMetrics(opGroupRows);
    const combinedOeePct = opMetrics.oeePct;
    const groupMinSrNo = Math.min(...machines.map((m) => m.minSrNo));

    operationGroups.push({
      operationKey: opKey,
      operation: opDisplay,
      minSrNo: groupMinSrNo,
      machinesCount: machines.length,
      combinedActualOutput,
      combinedStdOutput,
      combinedGoodOutput,
      combinedRework,
      combinedPlanAchievementPct,
      combinedOeePct,
      machines,
    });
  }

  // 4. Sort operationGroups by minSrNo ASC, then operation ASC
  operationGroups.sort((a, b) => {
    if (a.minSrNo !== b.minSrNo) return a.minSrNo - b.minSrNo;
    return a.operation.localeCompare(b.operation);
  });

  return operationGroups;
}

/**
 * Step 3A: Product-to-Line/Machine Traceability Matrix
 * Groups by Product (canonical itemName / itemId), returning overall OEE + Line & Machine Matrix Table.
 */
export function buildProductLineMachineMatrix(
  enrichedRows: EnrichedAnalyticsRow[],
  shiftItemTotals?: ShiftItemProductionRow[]
): ProductMatrixItem[] {
  const productMap = new Map<string, EnrichedAnalyticsRow[]>();

  for (const r of enrichedRows) {
    const rawName = (r.itemName ?? "").trim();
    const rawId = (r.itemId ?? "").trim();
    if (rawName.length === 0 && rawId.length === 0) continue;
    const act = Number(r.actualOutput) || 0;
    const rew = Number(r.rework) || 0;
    if (act <= 0 && rew <= 0) continue;

    const key = (rawName.length > 0 ? rawName : rawId).toLowerCase();

    const list = productMap.get(key) || [];
    list.push(r);
    productMap.set(key, list);
  }

  const result: ProductMatrixItem[] = [];

  for (const [key, rows] of productMap.entries()) {
    const sample = rows[0];
    const rawSampleName = (sample.itemName ?? "").trim();
    const rawSampleId = (sample.itemId ?? "").trim();
    const productName = rawSampleName.length > 0 ? rawSampleName : (rawSampleId.length > 0 ? rawSampleId : key);
    const productCode = rawSampleId;
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
      const std = subRows.reduce((acc, r) => acc + (Number(r.stdOutput) || 0), 0);
      const act = subRows.reduce((acc, r) => acc + (Number(r.actualOutput) || 0), 0);
      const rew = subRows.reduce((acc, r) => acc + (Number(r.rework) || 0), 0);
      const good = subRows.reduce((acc, r) => acc + (r.goodOutput || 0), 0);
      const bd = subRows.reduce((acc, r) => acc + (r.totalBreakdownMinutes || 0), 0);

      // Only show machines under a product's Product Traceability & Machine Matrix if they actually produced/ran that product
      if (act <= 0 && rew <= 0) continue;

      const s = subRows[0];
      const line = s.line || "Line 1";
      const machineId = s.machineId || "";
      const machineName = s.machineName || s.machineId || "Unknown";
      const operation = s.operation || "-";
      const isTemp = subRows.some((r) => r.isTempMachine);
      const splitCount = subRows.filter((r) => r.isSplitRun).length;
      const runNos = Array.from(new Set(subRows.map((r) => r.runNo || 1))).sort((a, b) => a - b);

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

    if (matrix.length === 0) continue;

    // Sort matrix by Line then Machine
    matrix.sort((a, b) => {
      const lineCmp = a.line.localeCompare(b.line);
      if (lineCmp !== 0) return lineCmp;
      return a.machineName.localeCompare(b.machineName);
    });

    // Finished / Pre-QC production totals from shift_item_production
    let preQcProduction = 0;
    let hasLoggedProduction = false;
    const dailyPreQc: Record<string, number> = {};
    if (shiftItemTotals && shiftItemTotals.length > 0) {
      for (const p of shiftItemTotals) {
        const pKey = p.itemKey || buildCanonicalItemKey(p.itemCode, p.itemName);
        const matches =
          pKey === key ||
          (p.itemCode && productCode && p.itemCode.trim().toLowerCase() === productCode.trim().toLowerCase()) ||
          (p.itemName && productName && p.itemName.trim().toLowerCase() === productName.trim().toLowerCase());
        if (matches) {
          hasLoggedProduction = true;
          const qty = Number(p.totalProduction) || 0;
          preQcProduction += qty;
          if (p.date) {
            dailyPreQc[p.date] = (dailyPreQc[p.date] || 0) + qty;
          }
        }
      }
    }

    const qcMetrics = resolveProductQcMetrics(preQcProduction, hasLoggedProduction);
    const operationGroups = buildProductOperationGroups(rows);

    result.push({
      productKey: key,
      productName,
      productCode,
      metrics: overallMetrics,
      lines,
      matrix,
      operationGroups,
      preQcProduction,
      finishedProduction: preQcProduction,
      dailyPreQcProduction: dailyPreQc,
      dailyFinishedProduction: dailyPreQc,
      qcMetrics,
    });
  }

  // Include any finished production items that had no machine operations logged
  if (shiftItemTotals && shiftItemTotals.length > 0) {
    const presentKeys = new Set(result.map((r) => r.productKey));
    const extraMap = new Map<string, ShiftItemProductionRow[]>();
    for (const p of shiftItemTotals) {
      const k = p.itemKey || buildCanonicalItemKey(p.itemCode, p.itemName);
      if (!k || presentKeys.has(k)) continue;
      const list = extraMap.get(k) || [];
      list.push(p);
      extraMap.set(k, list);
    }
    for (const [k, pRows] of extraMap.entries()) {
      const sample = pRows[0];
      const preQcProduction = pRows.reduce((acc, r) => acc + (Number(r.totalProduction) || 0), 0);
      const dailyPreQc: Record<string, number> = {};
      for (const r of pRows) {
        if (r.date) {
          dailyPreQc[r.date] = (dailyPreQc[r.date] || 0) + (Number(r.totalProduction) || 0);
        }
      }
      const lines = Array.from(new Set(pRows.map((r) => r.line || "Line 1"))).sort();
      const qcMetrics = resolveProductQcMetrics(preQcProduction, true);
      result.push({
        productKey: k,
        productName: sample.itemName || sample.itemCode || k,
        productCode: sample.itemCode || "",
        metrics: calculateOeeMetrics([]),
        lines,
        matrix: [],
        operationGroups: [],
        preQcProduction,
        finishedProduction: preQcProduction,
        dailyPreQcProduction: dailyPreQc,
        dailyFinishedProduction: dailyPreQc,
        qcMetrics,
      });
    }
  }

  // Sort products by Actual Output descending, fallback to Finished Production
  result.sort((a, b) => {
    if (b.metrics.totalActual !== a.metrics.totalActual) {
      return b.metrics.totalActual - a.metrics.totalActual;
    }
    return b.finishedProduction - a.finishedProduction;
  });
  return result;
}

/**
 * Step 3B: Group By Line
 */
export function groupByLine(
  enrichedRows: EnrichedAnalyticsRow[],
  shiftItemTotals?: ShiftItemProductionRow[]
): LineRollupItem[] {
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

    // Summarize items (only products actually produced or reworked)
    const itemMap = new Map<string, ItemSummary>();
    for (const r of rows) {
      const act = Number(r.actualOutput) || 0;
      const rew = Number(r.rework) || 0;
      if (act <= 0 && rew <= 0) continue;
      const rawName = (r.itemName ?? "").trim();
      const rawId = (r.itemId ?? "").trim();
      if (rawName.length === 0 && rawId.length === 0) continue;
      const name = rawName.length > 0 ? rawName : rawId;
      const id = rawId.length > 0 ? rawId : name;
      const key = `${id.toLowerCase()}__${name.toLowerCase()}`;
      const existing = itemMap.get(key) || {
        itemId: id,
        itemName: name,
        actualOutput: 0,
        stdOutput: 0,
        rework: 0,
        goodOutput: 0,
      };
      existing.actualOutput += act;
      existing.stdOutput += Number(r.stdOutput) || 0;
      existing.rework += rew;
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

    const linePreQc = (shiftItemTotals || [])
      .filter((r) => (r.line || "Line 1").toLowerCase() === line.toLowerCase())
      .reduce((sum, r) => sum + (Number(r.totalProduction) || 0), 0);
    const lineHasLogged = (shiftItemTotals || []).some(
      (r) => (r.line || "Line 1").toLowerCase() === line.toLowerCase()
    );
    const qcMetrics = resolveProductQcMetrics(linePreQc, lineHasLogged);

    result.push({
      line,
      metrics,
      itemsProduced,
      machineCount: machines.size,
      permMachineCount: Math.max(0, permMachinesCount),
      tempMachineCount: tempMachines.size,
      preQcProduction: linePreQc,
      finishedProduction: linePreQc,
      qcMetrics,
    });
  }

  result.sort((a, b) => a.line.localeCompare(b.line));
  return result;
}

/**
 * Step 3C: Group By Shift
 */
export function groupByShift(
  enrichedRows: EnrichedAnalyticsRow[],
  shiftItemTotals?: ShiftItemProductionRow[]
): ShiftRollupItem[] {
  const shiftMap = new Map<string, EnrichedAnalyticsRow[]>();

  for (const r of enrichedRows) {
    const shift = r.shift || "Shift A";
    const list = shiftMap.get(shift) || [];
    list.push(r);
    shiftMap.set(shift, list);
  }

  // Union shifts that only have shiftItemTotals logged
  if (shiftItemTotals && shiftItemTotals.length > 0) {
    for (const p of shiftItemTotals) {
      const shift = p.shift || "Shift A";
      if (!shiftMap.has(shift)) {
        shiftMap.set(shift, []);
      }
    }
  }

  const result: ShiftRollupItem[] = [];

  for (const [shift, rows] of shiftMap.entries()) {
    const metrics = calculateOeeMetrics(rows);

    const itemMap = new Map<string, ItemSummary>();
    for (const r of rows) {
      const act = Number(r.actualOutput) || 0;
      const rew = Number(r.rework) || 0;
      if (act <= 0 && rew <= 0) continue;
      const rawName = (r.itemName ?? "").trim();
      const rawId = (r.itemId ?? "").trim();
      if (rawName.length === 0 && rawId.length === 0) continue;
      const name = rawName.length > 0 ? rawName : rawId;
      const id = rawId.length > 0 ? rawId : name;
      const key = `${id.toLowerCase()}__${name.toLowerCase()}`;
      const existing = itemMap.get(key) || {
        itemId: id,
        itemName: name,
        actualOutput: 0,
        stdOutput: 0,
        rework: 0,
        goodOutput: 0,
      };
      existing.actualOutput += act;
      existing.stdOutput += Number(r.stdOutput) || 0;
      existing.rework += rew;
      existing.goodOutput += Number(r.goodOutput) || 0;
      itemMap.set(key, existing);
    }

    const topItems = Array.from(itemMap.values()).sort((a, b) => b.actualOutput - a.actualOutput);
    const machines = new Set(rows.map((r) => r.machineId || r.machineName));

    const shiftProdRows = (shiftItemTotals || []).filter(
      (r) => (r.shift || "Shift A").toLowerCase() === shift.toLowerCase()
    );
    const shiftPreQc = shiftProdRows.reduce((sum, r) => sum + (Number(r.totalProduction) || 0), 0);
    const shiftHasLogged = shiftProdRows.length > 0;
    const qcMetrics = resolveProductQcMetrics(shiftPreQc, shiftHasLogged);

    // Union (date, line) pairs from both enrichedRows and shiftProdRows
    const dateLineMap = new Map<
      string,
      {
        date: string;
        line: string;
        logRows: EnrichedAnalyticsRow[];
        prodRows: ShiftItemProductionRow[];
      }
    >();

    for (const r of rows) {
      const dateStr = r.date || "";
      if (!dateStr) continue;
      const lineStr = r.line || "Line 1";
      const dlKey = `${dateStr}__${lineStr.toLowerCase()}`;
      let entry = dateLineMap.get(dlKey);
      if (!entry) {
        entry = { date: dateStr, line: lineStr, logRows: [], prodRows: [] };
        dateLineMap.set(dlKey, entry);
      }
      entry.logRows.push(r);
    }

    for (const p of shiftProdRows) {
      const dateStr = p.date || "";
      if (!dateStr) continue;
      const lineStr = p.line || "Line 1";
      const dlKey = `${dateStr}__${lineStr.toLowerCase()}`;
      let entry = dateLineMap.get(dlKey);
      if (!entry) {
        entry = { date: dateStr, line: lineStr, logRows: [], prodRows: [] };
        dateLineMap.set(dlKey, entry);
      }
      entry.prodRows.push(p);
    }

    const dailyEntries: ShiftDayLineEntry[] = Array.from(dateLineMap.values()).map((entry) => {
      const dlPreQc = entry.prodRows.reduce((sum, p) => sum + (Number(p.totalProduction) || 0), 0);
      const dlQc = resolveProductQcMetrics(dlPreQc, entry.prodRows.length > 0);
      const dlMetrics = calculateOeeMetrics(entry.logRows);
      const dlMachines = new Set(
        entry.logRows.map((r) => r.machineId || r.machineName).filter(Boolean)
      );

      return {
        date: entry.date,
        shift,
        line: entry.line,
        machinesCount: dlMachines.size,
        qc: dlQc,
        machineOpsActual: dlMetrics.totalActual,
        machineOpsStd: dlMetrics.totalStd,
        rework: dlMetrics.totalRework,
        downtimeMinutes: dlMetrics.downtimeMinutes,
        planAchievementPct: dlMetrics.planAchievementPct,
        availabilityPct: dlMetrics.availabilityPct,
        qualityPct: dlMetrics.qualityPct,
        oeePct: dlMetrics.oeePct,
      };
    });

    dailyEntries.sort((a, b) => {
      const dCmp = b.date.localeCompare(a.date);
      if (dCmp !== 0) return dCmp;
      return a.line.localeCompare(b.line);
    });

    result.push({
      shift,
      metrics,
      topItems,
      machineCount: machines.size,
      preQcProduction: shiftPreQc,
      finishedProduction: shiftPreQc,
      qcMetrics,
      dailyEntries,
    });
  }

  result.sort((a, b) => compareShiftsCanonically(a.shift, b.shift));
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

function getShiftShortLabel(shift: string): string {
  const s = (shift || "").trim();
  if (/^shift\s*a\b/i.test(s)) return "Shift A";
  if (/^shift\s*b\b/i.test(s)) return "Shift B";
  if (/^shift\s*c\b/i.test(s)) return "Shift C";
  const parenIdx = s.indexOf("(");
  if (parenIdx > 0) return s.slice(0, parenIdx).trim();
  return s || "Unknown";
}

function getShiftSortRank(shift: string): number {
  const s = (shift || "").trim();
  if (/^shift\s*a\b/i.test(s)) return 1;
  if (/^shift\s*b\b/i.test(s)) return 2;
  if (/^shift\s*c\b/i.test(s)) return 3;
  return 4;
}

function compareShiftsCanonically(a: string, b: string): number {
  const rA = getShiftSortRank(a);
  const rB = getShiftSortRank(b);
  if (rA !== rB) return rA - rB;
  return a.localeCompare(b);
}

function buildCanonicalItemResolver(
  masterItems?: ItemMaster[],
  shiftItemTotals?: ShiftItemProductionRow[]
): (r: EnrichedAnalyticsRow) => { key: string; code: string; name: string } | null {
  const idToCanonical = new Map<string, { key: string; code: string; name: string }>();
  const nameToCanonical = new Map<string, { key: string; code: string; name: string }>();
  const codeToCanonical = new Map<string, { key: string; code: string; name: string }>();

  if (masterItems && masterItems.length > 0) {
    for (const it of masterItems) {
      const code = (it.itemCode || "").trim();
      const name = (it.itemName || "").trim();
      const key = buildCanonicalItemKey(code, name);
      if (!key) continue;
      const meta = { key, code, name: name || code };
      if (it.id) idToCanonical.set(it.id.trim().toLowerCase(), meta);
      if (name) nameToCanonical.set(name.toLowerCase(), meta);
      if (code) codeToCanonical.set(code.toLowerCase(), meta);
    }
  }

  if (shiftItemTotals && shiftItemTotals.length > 0) {
    for (const p of shiftItemTotals) {
      const code = (p.itemCode || "").trim();
      const name = (p.itemName || "").trim();
      const key = (p.itemKey || buildCanonicalItemKey(code, name)).trim().toLowerCase();
      if (!key) continue;
      const meta = { key, code, name: name || code || key };
      if (p.itemId && !idToCanonical.has(p.itemId.trim().toLowerCase())) {
        idToCanonical.set(p.itemId.trim().toLowerCase(), meta);
      }
      if (name && !nameToCanonical.has(name.toLowerCase())) {
        nameToCanonical.set(name.toLowerCase(), meta);
      }
      if (code && !codeToCanonical.has(code.toLowerCase())) {
        codeToCanonical.set(code.toLowerCase(), meta);
      }
    }
  }

  return (r: EnrichedAnalyticsRow) => {
    const rawName = (r.itemName || "").trim();
    const rawId = (r.itemId || "").trim();
    if (!rawName && !rawId) return null;

    const byId = rawId ? idToCanonical.get(rawId.toLowerCase()) : undefined;
    const byName = rawName ? nameToCanonical.get(rawName.toLowerCase()) : undefined;
    const byCode = rawId ? codeToCanonical.get(rawId.toLowerCase()) : undefined;
    const matched = byId || byName || byCode;
    if (matched) {
      return {
        key: matched.key,
        code: matched.code,
        name: rawName || matched.name,
      };
    }
    const fallbackKey =
      buildCanonicalItemKey(undefined, rawName) || buildCanonicalItemKey(rawId, undefined);
    if (!fallbackKey) return null;
    return {
      key: fallbackKey,
      code: "",
      name: rawName || rawId,
    };
  };
}
export function groupByPeriod(
  enrichedRows: EnrichedAnalyticsRow[],
  granularity: "day" | "week",
  shiftItemTotals?: ShiftItemProductionRow[],
  masterItems?: ItemMaster[]
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

  // Also include any period keys present in shiftItemTotals
  if (shiftItemTotals && shiftItemTotals.length > 0) {
    for (const p of shiftItemTotals) {
      const dateStr = p.date || "";
      if (!dateStr) continue;
      let pKey: string;
      let pLabel: string;
      if (granularity === "day") {
        pKey = dateStr;
        try {
          const parts = dateStr.split("-");
          if (parts.length === 3) {
            const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            const monthIdx = parseInt(parts[1], 10) - 1;
            pLabel = `${parts[2]} ${months[monthIdx] || parts[1]} ${parts[0]}`;
          } else {
            pLabel = dateStr;
          }
        } catch {
          pLabel = dateStr;
        }
      } else {
        const weekInfo = getIsoWeekInfo(dateStr);
        pKey = weekInfo.weekKey;
        pLabel = weekInfo.label;
      }
      if (!periodMap.has(pKey)) {
        periodMap.set(pKey, { label: pLabel, rows: [] });
      }
    }
  }

  // Pre-index canonical item keys when granularity === 'day' so shift_logs & shift_item_production unify cleanly
  const resolveLogItemMeta =
    granularity === "day"
      ? buildCanonicalItemResolver(masterItems, shiftItemTotals)
      : () => null;

  const result: PeriodRollupItem[] = [];

  for (const [periodKey, { label, rows }] of periodMap.entries()) {
    const metrics = calculateOeeMetrics(rows);

    const itemMap = new Map<string, ItemSummary>();
    for (const r of rows) {
      const act = Number(r.actualOutput) || 0;
      const rew = Number(r.rework) || 0;
      if (act <= 0 && rew <= 0) continue;
      const rawName = (r.itemName ?? "").trim();
      const rawId = (r.itemId ?? "").trim();
      if (rawName.length === 0 && rawId.length === 0) continue;
      const name = rawName.length > 0 ? rawName : rawId;
      const id = rawId.length > 0 ? rawId : name;
      const key = `${id.toLowerCase()}__${name.toLowerCase()}`;
      const existing = itemMap.get(key) || {
        itemId: id,
        itemName: name,
        actualOutput: 0,
        stdOutput: 0,
        rework: 0,
        goodOutput: 0,
      };
      existing.actualOutput += act;
      existing.stdOutput += Number(r.stdOutput) || 0;
      existing.rework += rew;
      existing.goodOutput += Number(r.goodOutput) || 0;
      itemMap.set(key, existing);
    }

    const itemsProduced = Array.from(itemMap.values()).sort((a, b) => b.actualOutput - a.actualOutput);
    const activeDates = Array.from(new Set(rows.map((r) => r.date).filter(Boolean) as string[])).sort();
    const activeShifts = Array.from(new Set(rows.map((r) => r.shift).filter(Boolean) as string[])).sort();
    const activeLines = Array.from(new Set(rows.map((r) => r.line).filter(Boolean) as string[])).sort();

    const matchingProdRows = (shiftItemTotals || []).filter((r) => {
      if (!r.date) return false;
      if (granularity === "day") return r.date === periodKey;
      return getIsoWeekInfo(r.date).weekKey === periodKey;
    });

    const periodPreQc = matchingProdRows.reduce((sum, r) => sum + (Number(r.totalProduction) || 0), 0);
    const periodHasLogged = matchingProdRows.length > 0;
    const qcMetrics = resolveProductQcMetrics(periodPreQc, periodHasLogged);

    // Compute Daily Shift-Wise x Item Breakdown only when granularity === 'day'
    let itemShiftBreakdown: DailyItemBreakdown[] = [];
    let shiftTotals: DailyShiftSummaryTotal[] = [];

    if (granularity === "day") {
      const dayItemBuckets = new Map<
        string,
        {
          itemKey: string;
          itemCode: string;
          itemName: string;
          logRows: EnrichedAnalyticsRow[];
          prodRows: ShiftItemProductionRow[];
        }
      >();

      for (const p of matchingProdRows) {
        const pCode = (p.itemCode || "").trim();
        const pName = (p.itemName || "").trim();
        const pKey = (p.itemKey || buildCanonicalItemKey(pCode, pName)).trim().toLowerCase();
        if (!pKey) continue;

        let bucket = dayItemBuckets.get(pKey);
        if (!bucket) {
          bucket = {
            itemKey: pKey,
            itemCode: pCode,
            itemName: pName || pCode || pKey,
            logRows: [],
            prodRows: [],
          };
          dayItemBuckets.set(pKey, bucket);
        } else {
          if (!bucket.itemCode && pCode) bucket.itemCode = pCode;
          if ((!bucket.itemName || bucket.itemName === bucket.itemCode) && pName) bucket.itemName = pName;
        }
        bucket.prodRows.push(p);
      }

      for (const r of rows) {
        const meta = resolveLogItemMeta(r);
        if (!meta) continue;
        let bucket = dayItemBuckets.get(meta.key);
        if (!bucket) {
          bucket = {
            itemKey: meta.key,
            itemCode: meta.code,
            itemName: meta.name,
            logRows: [],
            prodRows: [],
          };
          dayItemBuckets.set(meta.key, bucket);
        } else {
          if (!bucket.itemCode && meta.code) bucket.itemCode = meta.code;
          if (!bucket.itemName && meta.name) bucket.itemName = meta.name;
        }
        bucket.logRows.push(r);
      }

      itemShiftBreakdown = Array.from(dayItemBuckets.values()).map((bucket) => {
        const shiftsSet = new Set<string>();
        for (const r of bucket.logRows) {
          if (r.shift) shiftsSet.add(r.shift);
        }
        for (const p of bucket.prodRows) {
          if (p.shift) shiftsSet.add(p.shift);
        }

        const orderedShifts = Array.from(shiftsSet).sort(compareShiftsCanonically);

        const shiftRows: DailyItemShiftRow[] = orderedShifts.map((shift) => {
          const sProd = bucket.prodRows.filter((p) => p.shift === shift);
          const sPreQc = sProd.reduce((sum, p) => sum + (Number(p.totalProduction) || 0), 0);
          const qc = resolveProductQcMetrics(sPreQc, sProd.length > 0);

          const sLogs = bucket.logRows.filter((r) => r.shift === shift);
          const sMetrics = calculateOeeMetrics(sLogs);

          return {
            shift,
            shiftShortLabel: getShiftShortLabel(shift),
            qc,
            machineOpsActual: sMetrics.totalActual,
            machineOpsStd: sMetrics.totalStd,
            machineRunsCount: sMetrics.rowCount,
            rework: sMetrics.totalRework,
            downtimeMinutes: sMetrics.downtimeMinutes,
            planAchievementPct: sMetrics.planAchievementPct,
            availabilityPct: sMetrics.availabilityPct,
            qualityPct: sMetrics.qualityPct,
            oeePct: sMetrics.oeePct,
          };
        });

        const dayPreQc = bucket.prodRows.reduce((sum, p) => sum + (Number(p.totalProduction) || 0), 0);
        const dayQc = resolveProductQcMetrics(dayPreQc, bucket.prodRows.length > 0);
        const dayMetrics = calculateOeeMetrics(bucket.logRows);

        return {
          itemKey: bucket.itemKey,
          itemCode: bucket.itemCode,
          itemName: bucket.itemName,
          dayQc,
          dayMachineOpsActual: dayMetrics.totalActual,
          dayMachineOpsStd: dayMetrics.totalStd,
          dayRework: dayMetrics.totalRework,
          dayDowntimeMinutes: dayMetrics.downtimeMinutes,
          dayOeePct: dayMetrics.oeePct,
          shifts: shiftRows,
        };
      });

      // Sort: dayQc.preQcProduction DESC, then dayMachineOpsActual DESC, then itemName ASC
      itemShiftBreakdown.sort((a, b) => {
        if (b.dayQc.preQcProduction !== a.dayQc.preQcProduction) {
          return b.dayQc.preQcProduction - a.dayQc.preQcProduction;
        }
        if (b.dayMachineOpsActual !== a.dayMachineOpsActual) {
          return b.dayMachineOpsActual - a.dayMachineOpsActual;
        }
        return a.itemName.localeCompare(b.itemName);
      });

      // Compact shift summary totals across the whole date
      const dayShiftsSet = new Set<string>();
      for (const r of rows) {
        if (r.shift) dayShiftsSet.add(r.shift);
      }
      for (const p of matchingProdRows) {
        if (p.shift) dayShiftsSet.add(p.shift);
      }
      const orderedDayShifts = Array.from(dayShiftsSet).sort(compareShiftsCanonically);

      shiftTotals = orderedDayShifts.map((shift) => {
        const preQcProduction = matchingProdRows
          .filter((p) => p.shift === shift)
          .reduce((sum, p) => sum + (Number(p.totalProduction) || 0), 0);
        const sMetrics = calculateOeeMetrics(rows.filter((r) => r.shift === shift));
        return {
          shift,
          shiftShortLabel: getShiftShortLabel(shift),
          preQcProduction,
          machineOpsActual: sMetrics.totalActual,
          oeePct: sMetrics.oeePct,
        };
      });
    }

    result.push({
      periodKey,
      periodLabel: label,
      metrics,
      itemsProduced,
      activeDates,
      activeShifts,
      activeLines,
      preQcProduction: periodPreQc,
      finishedProduction: periodPreQc,
      qcMetrics,
      itemShiftBreakdown,
      shiftTotals,
    });
  }

  // Sort descending by periodKey (newest first)
  result.sort((a, b) => b.periodKey.localeCompare(a.periodKey));
  return result;
}

function buildMachineRollupItem(mId: string, rows: EnrichedAnalyticsRow[]): MachineRollupItem {
  const s = rows[0];
  const machineName = s.machineName || s.machineId || mId;
  const line = s.line || "Line 1";
  const isTemp = rows.some((r) => r.isTempMachine);
  const splitCount = rows.filter((r) => r.isSplitRun).length;
  const metrics = calculateOeeMetrics(rows);

  const itemMap = new Map<string, ItemSummary>();
  for (const r of rows) {
    const act = Number(r.actualOutput) || 0;
    const rew = Number(r.rework) || 0;
    if (act <= 0 && rew <= 0) continue;
    const rawName = (r.itemName ?? "").trim();
    const rawId = (r.itemId ?? "").trim();
    if (rawName.length === 0 && rawId.length === 0) continue;
    const name = rawName.length > 0 ? rawName : rawId;
    const id = rawId.length > 0 ? rawId : name;
    const key = `${id.toLowerCase()}__${name.toLowerCase()}`;
    const existing = itemMap.get(key) || {
      itemId: id,
      itemName: name,
      actualOutput: 0,
      stdOutput: 0,
      rework: 0,
      goodOutput: 0,
    };
    existing.actualOutput += act;
    existing.stdOutput += Number(r.stdOutput) || 0;
    existing.rework += rew;
    existing.goodOutput += Number(r.goodOutput) || 0;
    itemMap.set(key, existing);
  }

  const itemsProduced = Array.from(itemMap.values()).sort((a, b) => b.actualOutput - a.actualOutput);
  const sortedByDate = [...rows].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const latest = sortedByDate[0];

  return {
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
  };
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
    result.push(buildMachineRollupItem(mId, rows));
  }
  return result;
}

/**
 * Step 3F: Grouped Machine Matrix Builder ('none' | 'line' | 'item')
 * Preserves active sort comparator within every group.
 */
export function buildGroupedMachineMatrix(
  enrichedRows: EnrichedAnalyticsRow[],
  groupBy: MachineGroupByMode,
  sortFn: (a: MachineRollupItem, b: MachineRollupItem) => number,
  filteredItemProdRows?: ShiftItemProductionRow[],
  masterItems?: ItemMaster[]
): MachineMatrixGroup[] {
  if (enrichedRows.length === 0) return [];

  if (groupBy === "none") {
    const machines = groupByMachine(enrichedRows).sort(sortFn);
    if (machines.length === 0) return [];
    return [
      {
        groupKey: "__all__",
        groupLabel: "All Machines",
        groupType: "none",
        machinesCount: machines.length,
        metrics: calculateOeeMetrics(enrichedRows),
        machines,
      },
    ];
  }

  if (groupBy === "line") {
    const lineRowsMap = new Map<string, EnrichedAnalyticsRow[]>();
    for (const r of enrichedRows) {
      const line = (r.line || "Line 1").trim() || "Line 1";
      const list = lineRowsMap.get(line) || [];
      list.push(r);
      lineRowsMap.set(line, list);
    }

    const groups: MachineMatrixGroup[] = [];
    for (const [line, lineRows] of lineRowsMap.entries()) {
      const machines = groupByMachine(lineRows).sort(sortFn);
      groups.push({
        groupKey: line.toLowerCase(),
        groupLabel: line,
        groupType: "line",
        machinesCount: machines.length,
        metrics: calculateOeeMetrics(lineRows),
        machines,
      });
    }

    groups.sort((a, b) => a.groupLabel.localeCompare(b.groupLabel));
    return groups;
  }

  // groupBy === 'item'
  const resolveItemMeta = buildCanonicalItemResolver(masterItems, filteredItemProdRows);

  const itemBuckets = new Map<
    string,
    {
      itemKey: string;
      itemCode: string;
      itemName: string;
      rows: EnrichedAnalyticsRow[];
      machineSubMap: Map<string, EnrichedAnalyticsRow[]>;
    }
  >();

  for (const r of enrichedRows) {
    const meta = resolveItemMeta(r);
    const itemKey = meta ? meta.key : "__unspecified__";
    const itemName = meta ? meta.name : "Unspecified Item";
    const itemCode = meta ? meta.code : "";

    let bucket = itemBuckets.get(itemKey);
    if (!bucket) {
      bucket = {
        itemKey,
        itemCode,
        itemName,
        rows: [],
        machineSubMap: new Map<string, EnrichedAnalyticsRow[]>(),
      };
      itemBuckets.set(itemKey, bucket);
    } else {
      if (!bucket.itemCode && itemCode) bucket.itemCode = itemCode;
      if (!bucket.itemName && itemName) bucket.itemName = itemName;
    }

    bucket.rows.push(r);
    const subKey = `${(r.line || "Line 1").toLowerCase()}__${(r.machineId || r.machineName || "Unknown").toLowerCase()}__${r.isTempMachine ? "1" : "0"}`;
    const subList = bucket.machineSubMap.get(subKey) || [];
    subList.push(r);
    bucket.machineSubMap.set(subKey, subList);
  }

  const groups: MachineMatrixGroup[] = [];
  for (const bucket of itemBuckets.values()) {
    const machines: MachineRollupItem[] = [];
    for (const subRows of bucket.machineSubMap.values()) {
      const s = subRows[0];
      const mId = s.machineId || s.machineName || "Unknown";
      machines.push(buildMachineRollupItem(mId, subRows));
    }
    machines.sort(sortFn);

    let preQcProduction = 0;
    let hasLogged = false;
    if (bucket.itemKey !== "__unspecified__" && filteredItemProdRows && filteredItemProdRows.length > 0) {
      for (const p of filteredItemProdRows) {
        const pCode = (p.itemCode || "").trim();
        const pName = (p.itemName || "").trim();
        const pKey = (p.itemKey || buildCanonicalItemKey(pCode, pName)).trim().toLowerCase();
        const matches =
          pKey === bucket.itemKey ||
          (bucket.itemCode && pCode && pCode.toLowerCase() === bucket.itemCode.toLowerCase()) ||
          (bucket.itemName && pName && pName.toLowerCase() === bucket.itemName.toLowerCase());
        if (matches) {
          hasLogged = true;
          preQcProduction += Number(p.totalProduction) || 0;
        }
      }
    }

    const qcMetrics = resolveProductQcMetrics(preQcProduction, hasLogged);

    groups.push({
      groupKey: bucket.itemKey,
      groupLabel: bucket.itemName,
      groupSubLabel:
        bucket.itemCode &&
        bucket.itemCode.trim().toLowerCase() !== bucket.itemName.trim().toLowerCase()
          ? bucket.itemCode
          : undefined,
      groupType: "item",
      machinesCount: machines.length,
      preQcProduction,
      qcMetrics,
      metrics: calculateOeeMetrics(bucket.rows),
      machines,
    });
  }

  // Sort item groups by itemName ASC, putting "Unspecified Item" last
  groups.sort((a, b) => {
    const aUnspec = a.groupKey === "__unspecified__";
    const bUnspec = b.groupKey === "__unspecified__";
    if (aUnspec !== bUnspec) return aUnspec ? 1 : -1;
    return a.groupLabel.localeCompare(b.groupLabel);
  });

  return groups;
}

// ============================================================================
// STEP 4: MACHINE DETAIL ANALYTICS BUILDER (MachineAnalyticsView)
// ============================================================================

export interface MachineConfiguredCapability {
  itemId: string;
  itemCode: string;
  itemName: string;
  operation: string;
  cycleTime: number;
  ranInPeriod: boolean;
  periodActualOutput: number;
  periodRunsCount: number;
}

export interface MachineOperationPerformed {
  itemCode: string;
  itemName: string;
  operation: string;
  runsCount: number;
  avgCycleTime: number;
  stdOutput: number;
  actualOutput: number;
  rework: number;
  goodOutput: number;
  downtimeMinutes: number;
  availabilityPct: number;
  qualityPct: number;
  oeePct: number;
}

export interface MachineOperatorBreakdown {
  operatorName: string;
  shiftsCount: number;
  runsCount: number;
  itemsRun: string[];
  stdOutput: number;
  actualOutput: number;
  rework: number;
  goodOutput: number;
  downtimeMinutes: number;
  planAchievementPct: number;
  oeePct: number;
}

export interface MachineDailySummary {
  rowKey: string;
  date: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  operation: string;
  isDowntimeOnly: boolean;
  shiftsRun: string[];
  runsCount: number;
  avgCycleTime: number;
  stdOutput: number;
  actualOutput: number;
  rework: number;
  goodOutput: number;
  downtimeMinutes: number;
  planAchievementPct: number;
  availabilityPct: number;
  qualityPct: number;
  oeePct: number;
}

export interface MachineShiftLogHistoryItem {
  id: string;
  date: string;
  shift: string;
  line: string;
  runNo: number;
  isSplitRun: boolean;
  operatorName: string;
  itemName: string;
  operation: string;
  cycleTime: number;
  stdOutput: number;
  actualOutput: number;
  rework: number;
  totalBdMinutes: number;
  breakdown: BreakdownMinutes;
  oeePct: number;
  remarks: string;
}

export interface MachineDetailAnalytics {
  machineMeta: {
    id: string;
    name: string;
    line: string;
    isTempMachine: boolean;
  };
  overallMetrics: OeeMetrics;
  configuredCapabilities: MachineConfiguredCapability[];
  operationsPerformed: MachineOperationPerformed[];
  operatorBreakdown: MachineOperatorBreakdown[];
  dailySummary: MachineDailySummary[];
  shiftLogHistory: MachineShiftLogHistoryItem[];
}

export function buildMachineDetailAnalytics(params: {
  machineId: string;
  machineName?: string;
  enrichedRows: EnrichedAnalyticsRow[];
  masterData: {
    machines: MachineMaster[];
    items: ItemMaster[];
    cycleTimes: MachineItemCycleTime[];
  };
  shiftFilter?: string;
}): MachineDetailAnalytics {
  const normId = (params.machineId || "").trim();
  const normName = (params.machineName || "").trim().toLowerCase();

  // 1. Filter rows for this machine
  let machineRows = params.enrichedRows.filter((r) => {
    if (normId && r.machineId === normId) return true;
    if (normName && !r.machineId && (r.machineName || "").trim().toLowerCase() === normName) {
      return true;
    }
    return false;
  });

  if (params.shiftFilter && params.shiftFilter.toUpperCase() !== "ALL") {
    const sf = params.shiftFilter.trim().toLowerCase();
    machineRows = machineRows.filter((r) => (r.shift || "").trim().toLowerCase() === sf);
  }

  // 2. Machine Meta
  const found = params.masterData.machines.find(
    (m) =>
      (normId && m.id === normId) ||
      (normName && (m.name || "").trim().toLowerCase() === normName)
  );

  const machineMeta = {
    id: found?.id || normId || machineRows[0]?.machineId || "Unknown",
    name: found?.name || params.machineName || machineRows[0]?.machineName || "Unknown Machine",
    line: found?.line || machineRows[0]?.line || "Line 1",
    isTempMachine: Boolean(
      found?.id?.startsWith("temp_") ||
        machineRows[0]?.isTempMachine ||
        normId.startsWith("temp_")
    ),
  };

  // 3. Overall Metrics
  const overallMetrics = calculateOeeMetrics(machineRows);

  // 4. Configured Capabilities
  const itemMap = new Map<string, ItemMaster>();
  for (const it of params.masterData.items) {
    if (it.id) itemMap.set(it.id.trim().toLowerCase(), it);
    if (it.itemCode) itemMap.set(it.itemCode.trim().toLowerCase(), it);
    if (it.itemName) itemMap.set(it.itemName.trim().toLowerCase(), it);
  }

  const rawCts = (params.masterData.cycleTimes || []).filter(
    (ct) => ct.machineId === normId || (found && ct.machineId === found.id)
  );

  const configuredCapabilities: MachineConfiguredCapability[] = rawCts.map((ct) => {
    const rawCtItemId = (ct.itemId || "").trim().toLowerCase();
    const it = itemMap.get(rawCtItemId);
    const itemCode = it?.itemCode || "";
    const itemName = it?.itemName || ct.itemId;
    const op = (ct.operation || "").trim();
    const cycleTime = Number(ct.cycleTime) || 0;

    // Check performance in current period
    const matchingRows = machineRows.filter((r) => {
      const matchItem =
        (r.itemId && r.itemId.trim().toLowerCase() === rawCtItemId) ||
        (it && r.itemName && r.itemName.trim().toLowerCase() === it.itemName.trim().toLowerCase());
      const matchOp =
        !op || !r.operation || r.operation.trim().toLowerCase() === op.toLowerCase();
      return matchItem && matchOp;
    });

    const periodActualOutput = matchingRows.reduce(
      (sum, r) => sum + (Number(r.actualOutput) || 0),
      0
    );
    const periodRunsCount = matchingRows.length;
    const ranInPeriod = periodRunsCount > 0 && periodActualOutput > 0;

    return {
      itemId: ct.itemId,
      itemCode,
      itemName,
      operation: op,
      cycleTime,
      ranInPeriod,
      periodActualOutput,
      periodRunsCount,
    };
  });

  configuredCapabilities.sort((a, b) => {
    if (a.ranInPeriod !== b.ranInPeriod) return a.ranInPeriod ? -1 : 1;
    return a.itemName.localeCompare(b.itemName);
  });

  // 5. Operations Performed
  const activeOpRows = machineRows.filter((r) => {
    const hasItem = Boolean((r.itemId || "").trim() || (r.itemName || "").trim());
    const hasOutput = (Number(r.actualOutput) || 0) > 0 || (Number(r.rework) || 0) > 0;
    return hasItem && hasOutput;
  });

  const opGroupMap = new Map<string, EnrichedAnalyticsRow[]>();
  for (const r of activeOpRows) {
    const itemKey = (r.itemId || r.itemName || "").trim().toLowerCase();
    const opKey = (r.operation || "").trim().toLowerCase();
    const key = `${itemKey}::${opKey}`;
    const list = opGroupMap.get(key) || [];
    list.push(r);
    opGroupMap.set(key, list);
  }

  const operationsPerformed: MachineOperationPerformed[] = [];
  for (const groupRows of opGroupMap.values()) {
    const s = groupRows[0];
    const rawItemId = (s.itemId || "").trim().toLowerCase();
    const it = itemMap.get(rawItemId);
    const itemCode = it?.itemCode || "";
    const itemName = it?.itemName || s.itemName || s.itemId || "Unknown Part";
    const operation = s.operation || "—";
    const runsCount = groupRows.length;

    const totalCt = groupRows.reduce((sum, r) => sum + (Number(r.cycleTime) || 0), 0);
    const avgCycleTime = Number((totalCt / (runsCount || 1)).toFixed(2));

    const stdOutput = groupRows.reduce((sum, r) => sum + (Number(r.stdOutput) || 0), 0);
    const actualOutput = groupRows.reduce((sum, r) => sum + (Number(r.actualOutput) || 0), 0);
    const rework = groupRows.reduce((sum, r) => sum + (Number(r.rework) || 0), 0);
    const goodOutput = groupRows.reduce((sum, r) => sum + (r.goodOutput || 0), 0);
    const downtimeMinutes = Number(
      groupRows.reduce((sum, r) => sum + (r.totalBreakdownMinutes || 0), 0).toFixed(2)
    );

    const groupMetrics = calculateOeeMetrics(groupRows);

    operationsPerformed.push({
      itemCode,
      itemName,
      operation,
      runsCount,
      avgCycleTime,
      stdOutput,
      actualOutput,
      rework,
      goodOutput,
      downtimeMinutes,
      availabilityPct: groupMetrics.availabilityPct,
      qualityPct: groupMetrics.qualityPct,
      oeePct: groupMetrics.oeePct,
    });
  }

  operationsPerformed.sort((a, b) => b.actualOutput - a.actualOutput);

  // 6. Operator Breakdown
  const opMap = new Map<string, EnrichedAnalyticsRow[]>();
  for (const r of machineRows) {
    const opName = (r.operatorName || "").trim() || "Unassigned";
    const list = opMap.get(opName) || [];
    list.push(r);
    opMap.set(opName, list);
  }

  const operatorBreakdown: MachineOperatorBreakdown[] = [];
  for (const [opName, opRows] of opMap.entries()) {
    const shiftsSet = new Set(opRows.map((r) => `${r.date || ""}__${r.shift || ""}`));
    const itemsSet = new Set(
      opRows.map((r) => r.itemName || r.itemId).filter(Boolean) as string[]
    );
    const opMetrics = calculateOeeMetrics(opRows);

    operatorBreakdown.push({
      operatorName: opName,
      shiftsCount: shiftsSet.size,
      runsCount: opRows.length,
      itemsRun: Array.from(itemsSet),
      stdOutput: opMetrics.totalStd,
      actualOutput: opMetrics.totalActual,
      rework: opMetrics.totalRework,
      goodOutput: opMetrics.goodOutput,
      downtimeMinutes: opMetrics.downtimeMinutes,
      planAchievementPct: opMetrics.planAchievementPct,
      oeePct: opMetrics.oeePct,
    });
  }

  operatorBreakdown.sort((a, b) => {
    if (b.shiftsCount !== a.shiftsCount) return b.shiftsCount - a.shiftsCount;
    return b.actualOutput - a.actualOutput;
  });

  // 7. Daily Summary - grouped by (date, item, operation)
  const dayGroupMap = new Map<string, EnrichedAnalyticsRow[]>();
  for (const r of machineRows) {
    const rawDate = r.date || "Unknown";
    const rawItem = (r.itemId || r.itemName || "").trim();
    const rawOp = (r.operation || "").trim();

    let itemKey = rawItem.toLowerCase();
    let opKey = rawOp.toLowerCase();

    if (!itemKey) {
      itemKey = "__NO_ITEM__";
      opKey = "";
    }

    const groupKey = `${rawDate}::${itemKey}::${opKey}`;
    const list = dayGroupMap.get(groupKey) || [];
    list.push(r);
    dayGroupMap.set(groupKey, list);
  }

  // Pre-index masterData items for fast lookup by id, code, or name
  const itemMasterMap = new Map<string, ItemMaster>();
  (params.masterData.items || []).forEach((it) => {
    if (it.id) itemMasterMap.set(it.id.trim().toLowerCase(), it);
    if (it.itemCode) itemMasterMap.set(it.itemCode.trim().toLowerCase(), it);
    if (it.itemName) itemMasterMap.set(it.itemName.trim().toLowerCase(), it);
  });

  const dailySummary: MachineDailySummary[] = [];
  for (const [groupKey, groupRows] of dayGroupMap.entries()) {
    const firstRow = groupRows[0];
    const date = firstRow.date || "Unknown";
    const rawItem = (firstRow.itemId || firstRow.itemName || "").trim();
    const isDowntimeOnly = !rawItem;

    let itemId = firstRow.itemId || "";
    let itemCode = "";
    let itemName = firstRow.itemName || firstRow.itemId || "";
    let operation = firstRow.operation || "—";

    if (isDowntimeOnly) {
      itemName = "No Item / Downtime Only";
      itemCode = "";
      itemId = "";
      operation = "—";
    } else {
      const lookupKey = (itemId || itemCode || itemName).trim().toLowerCase();
      const matched = itemMasterMap.get(lookupKey);
      if (matched) {
        if (!itemCode && matched.itemCode) itemCode = matched.itemCode;
        if ((!itemName || itemName === itemId) && matched.itemName) itemName = matched.itemName;
        if (!itemId && matched.id) itemId = matched.id;
      }
    }

    const shiftsRun = Array.from(
      new Set(groupRows.map((r) => r.shift).filter(Boolean) as string[])
    ).sort();

    const groupMetrics = calculateOeeMetrics(groupRows);

    const ctRows = groupRows.filter((r) => Number(r.cycleTime) > 0);
    const avgCycleTime =
      ctRows.length > 0
        ? Math.round(
            (ctRows.reduce((sum, r) => sum + Number(r.cycleTime), 0) / ctRows.length) * 10
          ) / 10
        : 0;

    const planAchievementPct =
      groupMetrics.totalStd > 0
        ? Math.round((groupMetrics.totalActual / groupMetrics.totalStd) * 1000) / 10
        : groupMetrics.totalActual > 0
        ? 100
        : 0;

    dailySummary.push({
      rowKey: groupKey,
      date,
      itemId,
      itemCode,
      itemName,
      operation,
      isDowntimeOnly,
      shiftsRun,
      runsCount: groupRows.length,
      avgCycleTime,
      stdOutput: groupMetrics.totalStd,
      actualOutput: groupMetrics.totalActual,
      rework: groupMetrics.totalRework,
      goodOutput: groupMetrics.goodOutput,
      downtimeMinutes: groupMetrics.downtimeMinutes,
      planAchievementPct,
      availabilityPct: groupMetrics.availabilityPct,
      qualityPct: groupMetrics.qualityPct,
      oeePct: groupMetrics.oeePct,
    });
  }

  // Sort dailySummary:
  // by date DESC, then isDowntimeOnly ASC (real production items first), then actualOutput DESC, then itemName ASC
  dailySummary.sort((a, b) => {
    const dCmp = b.date.localeCompare(a.date);
    if (dCmp !== 0) return dCmp;

    if (a.isDowntimeOnly !== b.isDowntimeOnly) {
      return a.isDowntimeOnly ? 1 : -1;
    }

    const outDiff = b.actualOutput - a.actualOutput;
    if (outDiff !== 0) return outDiff;

    return a.itemName.localeCompare(b.itemName);
  });

  // 8. Shift Log History
  const sortedRows = [...machineRows].sort((a, b) => {
    const dCmp = (b.date || "").localeCompare(a.date || "");
    if (dCmp !== 0) return dCmp;
    const sCmp = (a.shift || "").localeCompare(b.shift || "");
    if (sCmp !== 0) return sCmp;
    return (Number(a.runNo) || 1) - (Number(b.runNo) || 1);
  });

  const shiftLogHistory: MachineShiftLogHistoryItem[] = sortedRows.map((r) => {
    const rowMetrics = calculateOeeMetrics([r]);
    const bd = r.breakdown || {
      noDisc: 0,
      change: 0,
      power: 0,
      operator: 0,
      machineBreakdown: 0,
      fixProgSettings: 0,
      miscellaneous: 0,
    };

    return {
      id: r.id,
      date: r.date,
      shift: r.shift,
      line: r.line,
      runNo: Number(r.runNo) || 1,
      isSplitRun: Boolean(r.isSplitRun),
      operatorName: (r.operatorName || "").trim() || "Unassigned",
      itemName: r.itemName || r.itemId || "—",
      operation: r.operation || "—",
      cycleTime: Number(r.cycleTime) || 0,
      stdOutput: Number(r.stdOutput) || 0,
      actualOutput: Number(r.actualOutput) || 0,
      rework: Number(r.rework) || 0,
      totalBdMinutes: Number(r.totalBreakdownMinutes) || 0,
      breakdown: bd,
      oeePct: rowMetrics.oeePct,
      remarks: r.remarks || "",
    };
  });

  return {
    machineMeta,
    overallMetrics,
    configuredCapabilities,
    operationsPerformed,
    operatorBreakdown,
    dailySummary,
    shiftLogHistory,
  };
}
