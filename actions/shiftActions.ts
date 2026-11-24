"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createAdminClient } from "@/utils/supabase/server";
import { getIsUnitHead } from "@/actions/authActions";
import { evaluateShiftLock, isShiftRowEmpty, buildCanonicalItemKey } from "@/services/storageService";
import { getFallbackFactoryTimeContext } from "@/utils/factoryTime";
import {
  MachineShiftRow,
  MachineMaster,
  ItemMaster,
  MasterDataState,
  ShiftType,
  ProductionLineMaster,
  ShiftMaster,
  MachineItemCycleTime,
  FactoryTimeContext,
  ItemProductionRollup,
  ShiftItemProductionRow,
} from "@/types";

// ============================================================================
// DATABASE ROW INTERFACES (Matches your upgraded Supabase SQL Schema)
// ============================================================================

export interface DbShiftItemProductionRow {
  id: string;
  log_date: string;
  shift: string;
  line: string;
  item_key: string;
  item_id: string | null;
  item_code: string;
  item_name: string;
  total_production: number;
  remarks: string;
  updated_at: string;
}

export interface DbShiftLogRow {
  id: string;
  run_no?: number | null;
  log_date: string;
  shift: string;
  line: string;
  sr_no: number;
  machine_id: string | null;
  machine_name: string;
  operator_name: string | null;
  item_id: string | null;
  item_name: string | null;
  operation: string | null;
  cycle_time: number | null;
  total_working_minutes: number | null;
  std_output: number | null;
  actual_output: number | null;
  rework: number | null;
  bd_no_disc: number | null;
  bd_change: number | null;
  bd_power: number | null;
  bd_operator: number | null;
  bd_machine?: number | null;
  bd_fix_prog?: number | null;
  bd_misc?: number | null;
  is_temp_machine?: boolean | null;
  // Read-only PostgreSQL GENERATED ALWAYS columns (present on SELECT, excluded on UPSERT)
  total_bd_minutes?: number | null;
  bd_no_disc_pct?: number | null;
  bd_change_pct?: number | null;
  bd_power_pct?: number | null;
  bd_operator_pct?: number | null;
  bd_machine_pct?: number | null;
  bd_fix_prog_pct?: number | null;
  bd_misc_pct?: number | null;
  total_bd_pct?: number | null;
  remarks: string | null;
  updated_at?: string | null;
}

export interface DbMachineRow {
  id: string;
  name: string;
  code: string;
  line: string | null;
  type: string | null;
  status: "active" | "maintenance" | "idle" | "disabled" | string | null;
  created_at?: string | null;
  sort_order: number | null;
}

export interface DbItemRow {
  id: string;
  item_code: string;
  item_name: string;
  operation: string;
  std_output: number;
  created_at?: string | null;
}

export interface DbOperatorRow {
  id?: string;
  name: string;
  is_active?: boolean;
}

export interface DbProductionLineRow {
  id: string;
  name: string;
  description: string | null;
  daily_working_minutes: number;
  is_active: boolean;
  sort_order: number;
}

export interface DbShiftRow {
  id: string;
  shift_code: string;
  display_name: string;
  start_time: string;
  end_time: string;
  rest_break_minutes?: number;
  cleaning_break_minutes?: number;
  shift_working_minutes: number;
  total_working_minutes_ref: number;
  is_active: boolean;
  sort_order: number;
}

export interface DbCycleTimeRow {
  id: number;
  machine_id: string;
  item_id: string;
  operation: string;
  cycle_time: number;
  std_output: number;
  is_active: boolean;
}

// ============================================================================
// STEP 2A & 2B: INTERNAL DATA TRANSLATORS (SQL <-> UI MAPPERS)
// ============================================================================

function formatTime12(t?: string): string {
  if (!t) return "";
  const parts = t.trim().split(":");
  const h = parseInt(parts[0], 10);
  if (isNaN(h)) return t;
  const m = parseInt(parts[1] || "0", 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mStr = m > 0 ? `:${String(m).padStart(2, "0")}` : "";
  return `${h12}${mStr}${ampm}`;
}

function extractShiftCode(shiftStr: string): string {
  if (!shiftStr) return "Shift A";
  const clean = shiftStr.trim();
  const match = clean.match(/^(Shift\s+[A-Za-z0-9]+)/i);
  if (match) {
    const code = match[1].toLowerCase();
    if (code === "shift a") return "Shift A";
    if (code === "shift b") return "Shift B";
    if (code === "shift c") return "Shift C";
    return match[1];
  }

  const lower = clean.toLowerCase();
  // 1. Check full ranges first
  if (
    lower.includes("7am-3:30pm") ||
    lower.includes("6am-2pm") ||
    lower.includes("7:00 am") ||
    lower.includes("7:00am")
  ) {
    return "Shift A";
  }
  if (
    lower.includes("3:30pm-12am") ||
    lower.includes("2pm-10pm") ||
    lower.includes("3:30 pm") ||
    lower.includes("15:30")
  ) {
    return "Shift B";
  }
  if (
    lower.includes("12am-7am") ||
    lower.includes("10pm-6am") ||
    lower.includes("12:00 am") ||
    lower.includes("12:00am")
  ) {
    return "Shift C";
  }

  // 2. Fallback to start tokens
  if (lower.includes("shift c") || lower.includes("12am") || lower.includes("10pm")) {
    return "Shift C";
  }
  if (lower.includes("shift b") || lower.includes("2pm") || lower.includes("3:30pm")) {
    return "Shift B";
  }
  if (lower.includes("shift a") || lower.includes("6am") || lower.includes("7am")) {
    return "Shift A";
  }

  return clean;
}

function resolveCleanShiftDisplayName(
  code: string,
  rawDisplayName: string,
  startTime?: string,
  endTime?: string
): ShiftType {
  if (startTime && endTime) {
    const s = formatTime12(startTime);
    const e = formatTime12(endTime);
    if (
      rawDisplayName.includes("6AM-2PM") ||
      rawDisplayName.includes("2PM-10PM") ||
      rawDisplayName.includes("10PM-6AM") ||
      rawDisplayName === code
    ) {
      return `${code} (${s}-${e})` as ShiftType;
    }
    return rawDisplayName as ShiftType;
  }
  const lower = (rawDisplayName || "").toLowerCase();
  if (lower.includes("6am-2pm") || lower === "shift a" || (lower.startsWith("shift a") && !lower.includes("7am"))) {
    return "Shift A (7AM-3:30PM)";
  }
  if (lower.includes("2pm-10pm") || lower === "shift b" || (lower.startsWith("shift b") && !lower.includes("3:30pm"))) {
    return "Shift B (3:30PM-12AM)";
  }
  if (lower.includes("10pm-6am") || lower === "shift c" || (lower.startsWith("shift c") && !lower.includes("12am"))) {
    return "Shift C (12AM-7AM)";
  }
  return rawDisplayName as ShiftType;
}

function mapDbRowToUiRow(dbRow: DbShiftLogRow): MachineShiftRow {
  const totalWorking = Number(dbRow.total_working_minutes ?? 1305);
  const noDisc = Number(Number(dbRow.bd_no_disc ?? 0).toFixed(2));
  const change = Number(Number(dbRow.bd_change ?? 0).toFixed(2));
  const power = Number(Number(dbRow.bd_power ?? 0).toFixed(2));
  const operator = Number(Number(dbRow.bd_operator ?? 0).toFixed(2));
  const machineBreakdown = Number(Number(dbRow.bd_machine ?? 0).toFixed(2));
  const fixProgSettings = Number(Number(dbRow.bd_fix_prog ?? 0).toFixed(2));
  const miscellaneous = Number(Number(dbRow.bd_misc ?? 0).toFixed(2));
  const totalBd = Number(
    (
      Number(dbRow.total_bd_minutes) ||
      (noDisc + change + power + operator + machineBreakdown + fixProgSettings + miscellaneous)
    ).toFixed(2)
  );
  const rawShift = dbRow.shift ?? "Shift A";
  const shiftCode = extractShiftCode(rawShift);
  const cleanShift = resolveCleanShiftDisplayName(shiftCode, rawShift);

  return {
    id: dbRow.id,
    date: dbRow.log_date,
    shift: cleanShift,
    line: dbRow.line,
    srNo: Number(dbRow.sr_no ?? 0),
    runNo: Number(dbRow.run_no ?? 1),
    isTempMachine: Boolean(dbRow.is_temp_machine ?? dbRow.machine_id?.startsWith("temp_")),
    machineId: dbRow.machine_id ?? "",
    machineName: dbRow.machine_name ?? "",
    operatorName: dbRow.operator_name ?? "",
    itemId: dbRow.item_id ?? "",
    itemName: dbRow.item_name ?? "",
    operation: dbRow.operation ?? "",
    cycleTime: Number(Number(dbRow.cycle_time ?? 0).toFixed(2)),
    totalWorkingMinutes: totalWorking,
    stdOutput: Number(dbRow.std_output ?? 0),
    actualOutput: Number(dbRow.actual_output ?? 0),
    rework: Number(dbRow.rework ?? 0),
    breakdown: {
      noDisc,
      change,
      power,
      operator,
      machineBreakdown,
      fixProgSettings,
      miscellaneous,
    },
    breakdownPct: {
      noDiscPct: Number(dbRow.bd_no_disc_pct ?? 0),
      changePct: Number(dbRow.bd_change_pct ?? 0),
      powerPct: Number(dbRow.bd_power_pct ?? 0),
      operatorPct: Number(dbRow.bd_operator_pct ?? 0),
      machineBreakdownPct: Number(dbRow.bd_machine_pct ?? 0),
      fixProgSettingsPct: Number(dbRow.bd_fix_prog_pct ?? 0),
      miscellaneousPct: Number(dbRow.bd_misc_pct ?? 0),
      totalBdMinutes: totalBd,
      totalBdPct: Number(dbRow.total_bd_pct ?? 0),
    },
    remarks: dbRow.remarks ?? "",
    updatedAt: dbRow.updated_at ?? undefined,
  };
}

/**
 * CRITICAL: Never include total_bd_minutes or bd_*_pct in the write payload
 * because they are GENERATED ALWAYS AS ... STORED columns in PostgreSQL.
 */
function mapUiRowToDbRow(uiRow: MachineShiftRow, validItemIdSet?: Set<string>) {
  const rawShift = uiRow.shift ?? "Shift A";
  const shiftCode = extractShiftCode(rawShift);
  const cleanShift = resolveCleanShiftDisplayName(shiftCode, rawShift);
  const runNo = Number(uiRow.runNo) || 1;

  const deterministicId =
    runNo === 1
      ? `${uiRow.date}_${cleanShift}_${uiRow.line}_${uiRow.machineId}`
      : `${uiRow.date}_${cleanShift}_${uiRow.line}_${uiRow.machineId}_r${runNo}`;

  const rawItemId = (uiRow.itemId || "").trim();
  const rawItemName = (uiRow.itemName || "").trim();

  // Validate item_id against validItemIdSet if provided. If empty or invalid, null it out cleanly.
  const isItemValid = rawItemId.length > 0 && (!validItemIdSet || validItemIdSet.has(rawItemId));
  const finalItemId = isItemValid ? rawItemId : null;
  const finalItemName = isItemValid ? rawItemName : "";
  const finalOperation = isItemValid ? (uiRow.operation?.trim() ?? "") : "";
  const finalCycleTime = isItemValid ? Number(Math.max(0, Number(uiRow.cycleTime) || 0).toFixed(2)) : 0;
  const finalStdOutput = isItemValid ? Math.round(Number(uiRow.stdOutput) || 0) : 0;

  return {
    id: deterministicId,
    run_no: runNo,
    log_date: uiRow.date,
    shift: cleanShift,
    line: uiRow.line,
    sr_no: Math.round(Number(uiRow.srNo) || 0),
    is_temp_machine: Boolean(uiRow.isTempMachine || uiRow.machineId?.startsWith("temp_")),
    machine_id: uiRow.machineId,
    machine_name: uiRow.machineName,
    operator_name: uiRow.operatorName?.trim() ?? "",
    item_id: finalItemId,
    item_name: finalItemName,
    operation: finalOperation,
    cycle_time: finalCycleTime,
    total_working_minutes: Math.round(Number(uiRow.totalWorkingMinutes) || 1305),
    std_output: finalStdOutput,
    actual_output: Math.round(Number(uiRow.actualOutput) || 0),
    rework: Math.round(Number(uiRow.rework) || 0),
    bd_no_disc: Number(Math.max(0, Number(uiRow.breakdown?.noDisc) || 0).toFixed(2)),
    bd_change: Number(Math.max(0, Number(uiRow.breakdown?.change) || 0).toFixed(2)),
    bd_power: Number(Math.max(0, Number(uiRow.breakdown?.power) || 0).toFixed(2)),
    bd_operator: Number(Math.max(0, Number(uiRow.breakdown?.operator) || 0).toFixed(2)),
    bd_machine: Number(Math.max(0, Number(uiRow.breakdown?.machineBreakdown) || 0).toFixed(2)),
    bd_fix_prog: Number(Math.max(0, Number(uiRow.breakdown?.fixProgSettings) || 0).toFixed(2)),
    bd_misc: Number(Math.max(0, Number(uiRow.breakdown?.miscellaneous) || 0).toFixed(2)),
    remarks: uiRow.remarks?.trim() ?? "",
    updated_at: new Date().toISOString(),
  };
}

function mapDbMachineToUi(dbMachine: DbMachineRow): MachineMaster {
  return {
    id: dbMachine.id,
    name: dbMachine.name,
    code: dbMachine.code,
    line: dbMachine.line ?? "Line 1",
    type: dbMachine.type ?? undefined,
    status: dbMachine.status ?? "active",
    sortOrder: typeof dbMachine.sort_order === "number" ? dbMachine.sort_order : undefined,
  };
}

function mapDbItemToUi(dbItem: DbItemRow): ItemMaster {
  return {
    id: dbItem.id,
    itemCode: dbItem.item_code,
    itemName: dbItem.item_name,
    operation: dbItem.operation ?? "",
    stdOutput: Number(dbItem.std_output ?? 0),
  };
}

function mapDbLineToUi(dbLine: DbProductionLineRow): ProductionLineMaster {
  return {
    id: dbLine.id,
    name: dbLine.name,
    description: dbLine.description ?? "",
    dailyWorkingMinutes: Number(dbLine.daily_working_minutes ?? 1305),
    isActive: Boolean(dbLine.is_active),
    sortOrder: Number(dbLine.sort_order ?? 0),
  };
}

function mapDbShiftToUi(dbShift: DbShiftRow): ShiftMaster {
  const cleanDisplayName = resolveCleanShiftDisplayName(
    dbShift.shift_code,
    dbShift.display_name,
    dbShift.start_time,
    dbShift.end_time
  );

  return {
    id: dbShift.id,
    shiftCode: dbShift.shift_code,
    displayName: cleanDisplayName,
    startTime: dbShift.start_time,
    endTime: dbShift.end_time,
    restBreakMinutes: Number(dbShift.rest_break_minutes ?? 30),
    cleaningBreakMinutes: Number(dbShift.cleaning_break_minutes ?? 15),
    shiftWorkingMinutes: Number(dbShift.shift_working_minutes ?? 465),
    totalWorkingMinutesRef: Number(dbShift.total_working_minutes_ref ?? 1305),
    isActive: Boolean(dbShift.is_active),
    sortOrder: Number(dbShift.sort_order ?? 0),
  };
}

async function syncDefaultShiftTimings(
  supabase: ReturnType<typeof createAdminClient>,
  dbShifts: DbShiftRow[]
) {
  const needsUpdate = dbShifts.some(
    (s) =>
      (s.shift_code === "Shift A" && (s.start_time?.startsWith("06:") || s.display_name?.includes("6AM-2PM"))) ||
      (s.shift_code === "Shift B" && (s.start_time?.startsWith("14:") || s.display_name?.includes("2PM-10PM"))) ||
      (s.shift_code === "Shift C" && (s.start_time?.startsWith("22:") || s.display_name?.includes("10PM-6AM")))
  );

  if (!needsUpdate) return;

  const standardUpdates = [
    {
      shift_code: "Shift A",
      display_name: "Shift A (7AM-3:30PM)",
      start_time: "07:00:00",
      end_time: "15:30:00",
      shift_working_minutes: 465,
    },
    {
      shift_code: "Shift B",
      display_name: "Shift B (3:30PM-12AM)",
      start_time: "15:30:00",
      end_time: "00:00:00",
      shift_working_minutes: 465,
    },
    {
      shift_code: "Shift C",
      display_name: "Shift C (12AM-7AM)",
      start_time: "00:00:00",
      end_time: "07:00:00",
      shift_working_minutes: 375,
    },
  ];

  for (const std of standardUpdates) {
    try {
      await supabase
        .from("shifts")
        .update(std)
        .eq("shift_code", std.shift_code);

      const found = dbShifts.find((s) => s.shift_code === std.shift_code);
      if (found) {
        found.display_name = std.display_name;
        found.start_time = std.start_time;
        found.end_time = std.end_time;
        found.shift_working_minutes = std.shift_working_minutes;
      }
    } catch (e) {
      console.warn(`Could not update shift timing for ${std.shift_code}:`, e);
    }
  }
}

function mapDbCycleTimeToUi(dbCt: DbCycleTimeRow): MachineItemCycleTime {
  return {
    id: dbCt.id,
    machineId: dbCt.machine_id,
    itemId: dbCt.item_id,
    operation: dbCt.operation,
    cycleTime: Number(dbCt.cycle_time ?? 0),
    stdOutput: Number(dbCt.std_output ?? 0),
    isActive: Boolean(dbCt.is_active),
  };
}

function isPopulatedDbLogRow(log: DbShiftLogRow): boolean {
  const bdTotal =
    (Number(log.bd_no_disc) || 0) +
    (Number(log.bd_change) || 0) +
    (Number(log.bd_power) || 0) +
    (Number(log.bd_operator) || 0) +
    (Number(log.bd_machine) || 0) +
    (Number(log.bd_fix_prog) || 0) +
    (Number(log.bd_misc) || 0);

  return (
    (Number(log.actual_output) || 0) > 0 ||
    (Number(log.rework) || 0) > 0 ||
    bdTotal > 0 ||
    Boolean(log.remarks && log.remarks.trim())
  );
}

function hydrateShiftSheetRows(
  sortedLineMachines: DbMachineRow[],
  savedDbLogs: DbShiftLogRow[],
  date: string,
  shift: ShiftType,
  line: string,
  shiftWorkingMinutes: number // Fetched dynamically from public.shifts
): MachineShiftRow[] {
  const normalizeName = (s?: string | null) => (s || "").trim().toLowerCase();

  // 1. Build lookup of lineMachines by both id and normalizeName(machine.name)
  const machineById = new Map<string, DbMachineRow>();
  const machineByName = new Map<string, DbMachineRow>();
  for (const m of sortedLineMachines) {
    if (m.id) machineById.set(m.id.trim(), m);
    const norm = normalizeName(m.name);
    if (norm) machineByName.set(norm, m);
  }

  // 2. Group savedDbLogs by resolved canonical machine.id
  const groupedSavedLogs = new Map<string, DbShiftLogRow[]>();
  const tempLogsByMachine = new Map<string, DbShiftLogRow[]>();

  for (const log of savedDbLogs) {
    if (!log.machine_id && !log.machine_name) continue;

    // Check if explicitly marked temporary machine
    const isTemp =
      Boolean(log.is_temp_machine) === true &&
      String(log.machine_id || "").startsWith("temp_");

    if (isTemp) {
      const tempId = String(log.machine_id);
      if (!tempLogsByMachine.has(tempId)) {
        tempLogsByMachine.set(tempId, []);
      }
      tempLogsByMachine.get(tempId)!.push(log);
      continue;
    }

    // Match permanent machine: try log.machine_id first, then fallback to normalizeName(log.machine_name)
    const rawId = (log.machine_id || "").trim();
    const rawName = normalizeName(log.machine_name);
    const matchedPermMachine =
      (rawId ? machineById.get(rawId) : null) ||
      (rawName ? machineByName.get(rawName) : null);

    if (matchedPermMachine) {
      if (!groupedSavedLogs.has(matchedPermMachine.id)) {
        groupedSavedLogs.set(matchedPermMachine.id, []);
      }
      groupedSavedLogs.get(matchedPermMachine.id)!.push(log);
    } else {
      // Unmatched non-temp row: stale/deleted machine or different line, skip completely
      continue;
    }
  }

  // Deduplicate runs per permanent machine: if duplicate run_no exists, keep populated over empty
  for (const [mId, logs] of groupedSavedLogs.entries()) {
    const byRunNo = new Map<number, DbShiftLogRow>();
    for (const log of logs) {
      const runNo = Number(log.run_no) || 1;
      const existing = byRunNo.get(runNo);
      if (!existing) {
        byRunNo.set(runNo, log);
      } else {
        if (!isPopulatedDbLogRow(existing) && isPopulatedDbLogRow(log)) {
          byRunNo.set(runNo, log);
        }
      }
    }
    const deduplicated = Array.from(byRunNo.values()).sort(
      (a, b) => (Number(a.run_no) || 1) - (Number(b.run_no) || 1)
    );
    groupedSavedLogs.set(mId, deduplicated);
  }

  const result: MachineShiftRow[] = [];

  // Step A: For each machine in lineMachines
  sortedLineMachines.forEach((machine, index) => {
    const machineLogs = groupedSavedLogs.get(machine.id);
    if (machineLogs && machineLogs.length > 0) {
      // Emit ONLY the saved rows for that machine (sorted by run_no ASC, normalizing machineId: machine.id and machineName: machine.name)
      machineLogs.forEach((log, runIdx) => {
        const uiRow = mapDbRowToUiRow(log);
        result.push({
          ...uiRow,
          srNo: index + 1,
          runNo: Number(log.run_no) || runIdx + 1,
          isTempMachine: false,
          machineId: machine.id,
          machineName: machine.name,
          machineCode: machine.code || undefined,
          totalWorkingMinutes: shiftWorkingMinutes || uiRow.totalWorkingMinutes || 1305,
          shiftWorkingMinutes: shiftWorkingMinutes || 1305,
        });
      });
      // CRITICAL: DO NOT emit an empty row for that machine!
    } else {
      // If !groupedSavedLogs.has(machine.id): emit 1 blank default row (runNo: 1)
      result.push({
        id: `${date}_${shift}_${line}_${machine.id}`,
        date,
        shift,
        line,
        srNo: index + 1,
        runNo: 1,
        isTempMachine: false,
        machineId: machine.id,
        machineName: machine.name,
        machineCode: machine.code || undefined,
        operatorName: "",
        itemId: "",
        itemName: "",
        operation: "",
        cycleTime: 0,
        totalWorkingMinutes: shiftWorkingMinutes || 1305,
        shiftWorkingMinutes: shiftWorkingMinutes || 1305,
        stdOutput: 0,
        actualOutput: 0,
        rework: 0,
        breakdown: {
          noDisc: 0,
          change: 0,
          power: 0,
          operator: 0,
          machineBreakdown: 0,
          fixProgSettings: 0,
          miscellaneous: 0,
        },
        breakdownPct: {
          noDiscPct: 0,
          changePct: 0,
          powerPct: 0,
          operatorPct: 0,
          machineBreakdownPct: 0,
          fixProgSettingsPct: 0,
          miscellaneousPct: 0,
          totalBdMinutes: 0,
          totalBdPct: 0,
        },
        remarks: "",
      });
    }
  });

  // Step B: After processing all lineMachines, append ONLY saved rows explicitly marked is_temp_machine === true AND machine_id?.startsWith("temp_")
  const tempMachineEntries = Array.from(tempLogsByMachine.entries()).sort(
    ([, logsA], [, logsB]) => {
      const minSrA = Math.min(...logsA.map((l) => Number(l.sr_no) || 9999));
      const minSrB = Math.min(...logsB.map((l) => Number(l.sr_no) || 9999));
      return minSrA - minSrB;
    }
  );

  let nextSrNo = sortedLineMachines.length + 1;
  for (const [, logs] of tempMachineEntries) {
    const byRunNo = new Map<number, DbShiftLogRow>();
    for (const log of logs) {
      const runNo = Number(log.run_no) || 1;
      const existing = byRunNo.get(runNo);
      if (!existing) {
        byRunNo.set(runNo, log);
      } else if (!isPopulatedDbLogRow(existing) && isPopulatedDbLogRow(log)) {
        byRunNo.set(runNo, log);
      }
    }
    const deduplicated = Array.from(byRunNo.values()).sort(
      (a, b) => (Number(a.run_no) || 1) - (Number(b.run_no) || 1)
    );

    deduplicated.forEach((log, runIdx) => {
      const uiRow = mapDbRowToUiRow(log);
      result.push({
        ...uiRow,
        srNo: nextSrNo,
        runNo: Number(log.run_no) || runIdx + 1,
        isTempMachine: true,
        totalWorkingMinutes: shiftWorkingMinutes || uiRow.totalWorkingMinutes || 1305,
        shiftWorkingMinutes: shiftWorkingMinutes || 1305,
      });
    });
    nextSrNo++;
  }

  return result;
}

// ============================================================================
// STEP 2B: CORE SERVER ACTIONS (Updated for Lines, Shifts & Cycle Times)
// ============================================================================

/**
 * Resolves factory-grounded time context strictly on the server in Asia/Kolkata timezone.
 * First queries Supabase RPC 'get_factory_time_context'.
 * Falls back to computing via Node server Intl.DateTimeFormat with public.shifts.
 */
export async function getFactoryTimeContext(): Promise<FactoryTimeContext> {
  const supabase = createAdminClient();

  try {
    const { data, error } = await supabase.rpc("get_factory_time_context");
    if (!error && data) {
      const rpcRow = (Array.isArray(data) ? data[0] : data) as Record<
        string,
        unknown
      > | null;
      const serverNow = rpcRow?.server_now_ist ?? rpcRow?.serverNowIst;
      const actDate = rpcRow?.active_date ?? rpcRow?.activeDate;
      const selShift = rpcRow?.auto_selected_shift ?? rpcRow?.autoSelectedShift;
      if (serverNow && actDate && selShift) {
        return {
          serverNowIst: String(serverNow),
          activeDate: String(actDate),
          autoSelectedShift: resolveCleanShiftDisplayName(
            extractShiftCode(String(selShift)),
            String(selShift)
          ) as ShiftType,
        };
      }
    }
  } catch {
    // RPC not available yet, fall back to Node server computation below
  }

  // Fetch active shifts to determine schedule if available
  let shifts: ShiftMaster[] = [];
  try {
    const { data: dbShifts } = await supabase
      .from("shifts")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (dbShifts && dbShifts.length > 0) {
      shifts = dbShifts.map(mapDbShiftToUi);
    }
  } catch {
    // ignore
  }

  // Pure fallback resolver mirroring PostgreSQL get_factory_time_context()
  return getFallbackFactoryTimeContext(shifts);
}

// Verifies Unit Head cookie/session (adjust cookie name if yours differs)
async function isUnitHeadSession(): Promise<boolean> {
  const cookieStore = await cookies();
  if (cookieStore.get("unit_head_auth")?.value === "true") {
    return true;
  }
  return await getIsUnitHead();
}

async function assertUnitHead(actionLabel: string = "modify Master Data") {
  const isAdmin = await isUnitHeadSession();
  if (!isAdmin) {
    throw new Error(`Unauthorized: Unit Head privileges required to ${actionLabel}.`);
  }
}

async function runLocalShiftLockCheck(
  logDate: string,
  shift: string,
  bufferMinutes: number = 30
): Promise<{ is_editable: boolean; reason?: string | null }> {
  const supabase = createAdminClient();
  const timeContext = await getFactoryTimeContext();
  let shiftsMaster: ShiftMaster[] = [];
  try {
    const { data: dbShifts } = await supabase
      .from("shifts")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (dbShifts) shiftsMaster = dbShifts.map(mapDbShiftToUi);
  } catch {
    // ignore
  }

  const lockInfo = evaluateShiftLock(
    logDate,
    shift,
    shiftsMaster,
    timeContext.serverNowIst,
    false,
    bufferMinutes
  );

  return {
    is_editable: lockInfo.isEditable,
    reason: lockInfo.reason ?? null,
  };
}

async function assertShiftEditable(logDate: string, shift: string) {
  const isAdmin = await isUnitHeadSession();
  if (isAdmin) return; // Unit Head can override past/future shift locks

  const shiftCode = extractShiftCode(shift);
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("check_shift_edit_window", {
    p_log_date: logDate,
    p_shift: shiftCode,
    p_buffer_minutes: 30,
  });

  if (error) {
    const localCheck = await runLocalShiftLockCheck(logDate, shiftCode, 30);
    if (!localCheck.is_editable) {
      throw new Error(localCheck.reason || "This shift is locked for editing.");
    }
    return;
  }

  const windowCheck = (Array.isArray(data) ? data[0] : data) as
    | { is_editable?: boolean; reason?: string }
    | undefined;

  if (!windowCheck?.is_editable) {
    // If reason mentions "not found" (e.g. legacy shift identifier), fall back to local shift lock evaluator
    if (windowCheck?.reason && windowCheck.reason.toLowerCase().includes("not found")) {
      const localCheck = await runLocalShiftLockCheck(logDate, shiftCode, 30);
      if (!localCheck.is_editable) {
        throw new Error(localCheck.reason || "This shift is locked for editing.");
      }
      return;
    }
    throw new Error(windowCheck?.reason || "This shift is locked for editing.");
  }
}

/**
 * Server action wrapper checking whether a shift is currently editable.
 * Bypassed if caller has Unit Head session.
 */
export async function checkShiftEditWindow(
  logDate: string,
  shift: string,
  bufferMinutes: number = 30
): Promise<{ is_editable: boolean; reason?: string | null }> {
  const isAdmin = await isUnitHeadSession();
  if (isAdmin) {
    return { is_editable: true };
  }

  const shiftCode = extractShiftCode(shift);
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("check_shift_edit_window", {
    p_log_date: logDate,
    p_shift: shiftCode,
    p_buffer_minutes: bufferMinutes,
  });

  if (error) {
    return await runLocalShiftLockCheck(logDate, shiftCode, bufferMinutes);
  }

  const windowCheck = (Array.isArray(data) ? data[0] : data) as
    | { is_editable?: boolean; reason?: string | null }
    | undefined;

  if (windowCheck?.reason && windowCheck.reason.toLowerCase().includes("not found")) {
    return await runLocalShiftLockCheck(logDate, shiftCode, bufferMinutes);
  }

  return {
    is_editable: Boolean(windowCheck?.is_editable),
    reason: windowCheck?.reason ?? null,
  };
}

/**
 * ACTION 1: Fetch All Master Data in Parallel
 * Fetches machines, operators, items, production_lines, shifts, and cycle_times.
 */
export async function getMasterData(): Promise<MasterDataState> {
  const supabase = createAdminClient();

  const [
    machinesRes,
    operatorsRes,
    itemsRes,
    linesRes,
    shiftsRes,
    cycleTimesRes,
  ] = await Promise.all([
    supabase
      .from("machines")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("operators")
      .select("*")
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase.from("items").select("*").order("item_code", { ascending: true }),
    supabase
      .from("production_lines")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("shifts")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("machine_item_cycle_times")
      .select("*")
      .eq("is_active", true),
  ]);

  if (machinesRes.error) throw new Error(machinesRes.error.message);
  if (operatorsRes.error) throw new Error(operatorsRes.error.message);
  if (itemsRes.error) throw new Error(itemsRes.error.message);
  if (linesRes.error) throw new Error(linesRes.error.message);
  if (shiftsRes.error) throw new Error(shiftsRes.error.message);
  if (cycleTimesRes.error) throw new Error(cycleTimesRes.error.message);

  const rawShifts = (shiftsRes.data as DbShiftRow[]) ?? [];
  if (rawShifts.length > 0) {
    try {
      await syncDefaultShiftTimings(supabase, rawShifts);
    } catch {
      // ignore
    }
  }

  return {
    machines: (machinesRes.data as DbMachineRow[]).map(mapDbMachineToUi),
    operators: (operatorsRes.data as DbOperatorRow[]).map((op) => op.name),
    items: (itemsRes.data as DbItemRow[]).map(mapDbItemToUi),
    lines: linesRes.data
      ? (linesRes.data as DbProductionLineRow[]).map(mapDbLineToUi)
      : [],
    shifts: rawShifts.map(mapDbShiftToUi),
    cycleTimes: cycleTimesRes.data
      ? (cycleTimesRes.data as DbCycleTimeRow[]).map(mapDbCycleTimeToUi)
      : [],
  };
}

/**
 * ACTION 2: Fetch Active Shift Rows
 * Queries public.shifts for the selected shift's exact shift_working_minutes.
 */
export async function getShiftSheetRows(
  date: string,
  shift: ShiftType,
  line: string
): Promise<MachineShiftRow[]> {
  const supabase = createAdminClient();
  const shiftCode = shift.startsWith("Shift")
    ? shift.split(" ")[0] + " " + shift.split(" ")[1]
    : shift;

  const [machinesRes, logsRes, shiftConfigRes] = await Promise.all([
    supabase
      .from("machines")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("shift_logs")
      .select("*")
      .eq("log_date", date)
      .order("sr_no", { ascending: true })
      .order("run_no", { ascending: true }),
    supabase
      .from("shifts")
      .select("shift_working_minutes")
      .or(`display_name.eq."${shift}",shift_code.eq."${shift}",shift_code.eq."${shiftCode}"`)
      .maybeSingle(),
  ]);

  if (machinesRes.error) throw new Error(machinesRes.error.message);
  if (logsRes.error) throw new Error(logsRes.error.message);
  if (shiftConfigRes.error) throw new Error(shiftConfigRes.error.message);

  const targetLine = (line || "Line 1").trim().toLowerCase();
  const allDbMachines = (machinesRes.data as DbMachineRow[]) ?? [];

  // Filter machines for line: case-insensitive trimmed match, and exclude ONLY if status is disabled
  const lineMachines = allDbMachines.filter((m) => {
    const mLine = (m.line || "Line 1").trim().toLowerCase();
    if (mLine !== targetLine) return false;
    const status = (m.status || "").trim().toLowerCase();
    return status !== "disabled";
  });

  const targetShift = (shift || "").trim().toLowerCase();
  const targetShiftCode = extractShiftCode(shift).trim().toLowerCase();

  // Filter logs for this line & shift
  const allDbLogs = (logsRes.data as DbShiftLogRow[]) ?? [];
  const lineLogs = allDbLogs.filter((log) => {
    const logLine = (log.line || "Line 1").trim().toLowerCase();
    if (logLine !== targetLine) return false;
    const logShift = (log.shift || "").trim().toLowerCase();
    const logShiftCode = extractShiftCode(log.shift || "").trim().toLowerCase();
    return (
      logShift === targetShift ||
      (Boolean(logShiftCode && targetShiftCode) && logShiftCode === targetShiftCode) ||
      (Boolean(targetShiftCode) && logShift.startsWith(targetShiftCode)) ||
      (Boolean(logShiftCode) && targetShift.startsWith(logShiftCode))
    );
  });

  const dbShiftMinutes = Number(shiftConfigRes.data?.shift_working_minutes ?? 1305);

  return hydrateShiftSheetRows(
    lineMachines,
    lineLogs,
    date,
    shift,
    line,
    dbShiftMinutes
  );
}

// ============================================================================
// HELPER: Auto-upsert Machine × Item × Operation cycle time mappings
// ============================================================================

async function syncMachineItemCycleTimes(
  supabase: ReturnType<typeof createAdminClient>,
  rows: MachineShiftRow[]
) {
  // Count how many times each (machineId, itemId, operation) appears in rows
  const comboCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.isTempMachine || row.machineId?.startsWith("temp_")) continue;
    if (isShiftRowEmpty(row)) continue;
    const ct = Number(row.cycleTime);
    const op = row.operation?.trim();
    const itemId = row.itemId?.trim();
    if (row.machineId && itemId && op && ct > 0) {
      const key = `${row.machineId}::${itemId}::${op}`;
      comboCounts.set(key, (comboCounts.get(key) || 0) + 1);
    }
  }

  const validPairs = new Map<
    string,
    {
      id?: string;
      machine_id: string;
      item_id: string;
      operation: string;
      cycle_time: number;
      is_active?: boolean;
      updated_at: string;
    }
  >();

  for (const row of rows) {
    if (row.isTempMachine || row.machineId?.startsWith("temp_")) continue;
    if (isShiftRowEmpty(row)) continue;
    const ct = Number(row.cycleTime);
    const op = row.operation?.trim();
    const itemId = row.itemId?.trim();
    if (row.machineId && itemId && op && ct > 0) {
      const key = `${row.machineId}::${itemId}::${op}`;
      const count = comboCounts.get(key) || 0;
      // Only auto-upsert if combination appears once across that machine, or if runNo === 1
      if (count === 1 || (row.runNo || 1) === 1) {
        if (!validPairs.has(key)) {
          validPairs.set(key, {
            id: `ct_${row.machineId}_${itemId}_${op.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
            machine_id: row.machineId,
            item_id: itemId,
            operation: op,
            cycle_time: ct,
            is_active: true,
            updated_at: new Date().toISOString(),
          });
        }
      }
    }
  }

  if (validPairs.size === 0) return;

  const candidateList = Array.from(validPairs.values());
  const distinctMachineIds = Array.from(new Set(candidateList.map((p) => p.machine_id)));
  const distinctItemIds = Array.from(new Set(candidateList.map((p) => p.item_id)));

  // Strict Foreign-Key Guard: Query DB to verify all machine_ids and item_ids exist before upserting
  const [{ data: dbMachines }, { data: dbItems }] = await Promise.all([
    supabase.from("machines").select("id").in("id", distinctMachineIds),
    supabase.from("items").select("id").in("id", distinctItemIds),
  ]);

  const validMachineIdSet = new Set(dbMachines?.map((m) => m.id) ?? []);
  const validItemIdSet = new Set(dbItems?.map((i) => i.id) ?? []);

  const safePairs = candidateList.filter(
    (p) => validMachineIdSet.has(p.machine_id) && validItemIdSet.has(p.item_id)
  );

  if (safePairs.length === 0) return;

  const { error } = await supabase
    .from("machine_item_cycle_times")
    .upsert(safePairs, {
      onConflict: "machine_id,item_id,operation",
    });

  if (error) {
    // If the database id column has an integer/serial constraint, retry omitting the string id
    const withoutId = safePairs.map((p) => ({
      machine_id: p.machine_id,
      item_id: p.item_id,
      operation: p.operation,
      cycle_time: p.cycle_time,
      is_active: p.is_active,
      updated_at: p.updated_at,
    }));
    const retry = await supabase
      .from("machine_item_cycle_times")
      .upsert(withoutId, {
        onConflict: "machine_id,item_id,operation",
      });
    if (retry.error) {
      console.warn("Failed to auto-sync machine_item_cycle_times:", retry.error.message);
    }
  }
}

/**
 * ACTION 3: Batch Save Shift Sheet (DailyShiftSheet.tsx)
 */
export async function saveShiftSheetRows(rows: MachineShiftRow[]) {
  if (!rows || rows.length === 0) return { success: true, count: 0, rows: [] };

  // Enforce edit-window check for every unique (date, shift) pair in payload
  const seenKeys = new Set<string>();
  for (const row of rows) {
    const key = `${row.date}__${row.shift}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      await assertShiftEditable(row.date, row.shift);
    }
  }

  const supabase = createAdminClient();

  // Distinct (date, shift, line) scopes represented in the incoming payload
  const scopes = new Map<string, { date: string; shift: string; line: string }>();
  for (const row of rows) {
    const rawShift = row.shift ?? "Shift A";
    const shiftCode = extractShiftCode(rawShift);
    const cleanShift = resolveCleanShiftDisplayName(shiftCode, rawShift);
    const scopeKey = `${row.date}__${cleanShift}__${row.line}`;
    if (!scopes.has(scopeKey)) {
      scopes.set(scopeKey, { date: row.date, shift: cleanShift, line: row.line });
    }
  }

  // 1. Strict Server-Side Filter: Only non-empty rows are saved to public.shift_logs
  const activeRows = rows.filter((r) => !isShiftRowEmpty(r));

  // If ALL rows in the shift are empty, clean up all logs for these scopes and return
  if (activeRows.length === 0) {
    for (const scope of scopes.values()) {
      const { error: delError } = await supabase
        .from("shift_logs")
        .delete()
        .eq("log_date", scope.date)
        .eq("shift", scope.shift)
        .eq("line", scope.line);
      if (delError) {
        console.warn("Failed to prune cleared shift sheet from shift_logs:", delError.message);
      }
    }
    revalidatePath("/");
    return { success: true, count: 0, rows: [] };
  }

  // 2. Fetch valid item IDs from public.items to sanitize item_id foreign references
  const { data: dbItems } = await supabase.from("items").select("id");
  const validItemIdSet = new Set((dbItems || []).map((i) => i.id.trim()));

  // 3. Normalize runNo sequentially (1, 2, 3...) per machineId and generate deterministic id
  const machineRunCounters = new Map<string, number>();
  const normalizedRows: MachineShiftRow[] = activeRows.map((r) => {
    const rawShift = r.shift ?? "Shift A";
    const shiftCode = extractShiftCode(rawShift);
    const cleanShift = resolveCleanShiftDisplayName(shiftCode, rawShift);

    const mKey = `${r.date}__${cleanShift}__${r.line}__${r.machineId}`;
    const nextRun = (machineRunCounters.get(mKey) || 0) + 1;
    machineRunCounters.set(mKey, nextRun);

    const deterministicId =
      nextRun === 1
        ? `${r.date}_${cleanShift}_${r.line}_${r.machineId}`
        : `${r.date}_${cleanShift}_${r.line}_${r.machineId}_r${nextRun}`;

    return {
      ...r,
      shift: cleanShift,
      runNo: nextRun,
      id: deterministicId,
    };
  });

  const dbPayloads = normalizedRows.map((r) => mapUiRowToDbRow(r, validItemIdSet));

  // 4. Deduplicate dbPayloads in memory before touching Supabase
  type DbPayload = ReturnType<typeof mapUiRowToDbRow>;
  const dedupedMap = new Map<string, DbPayload>();
  const seenCompositeKeys = new Set<string>();

  for (const payload of dbPayloads) {
    const compositeKey = `${payload.log_date}|${payload.shift}|${payload.line}|${payload.machine_id}|${payload.run_no}`;
    if (dedupedMap.has(payload.id) || seenCompositeKeys.has(compositeKey)) {
      const existing = dedupedMap.get(payload.id);
      if (
        existing &&
        !isPopulatedDbLogRow(existing as unknown as DbShiftLogRow) &&
        isPopulatedDbLogRow(payload as unknown as DbShiftLogRow)
      ) {
        dedupedMap.set(payload.id, payload);
      }
      continue;
    }
    dedupedMap.set(payload.id, payload);
    seenCompositeKeys.add(compositeKey);
  }

  const dedupedPayloads = Array.from(dedupedMap.values());
  const activeIds = dedupedPayloads.map((p) => p.id).filter(Boolean);

  // 5. Delete Stale / Removed / Blanked Rows for (log_date, shift, line) BEFORE Calling .upsert()
  for (const scope of scopes.values()) {
    let delQuery = supabase
      .from("shift_logs")
      .delete()
      .eq("log_date", scope.date)
      .eq("shift", scope.shift)
      .eq("line", scope.line);

    if (activeIds.length > 0) {
      const inClause = `(${activeIds.map((id) => `"${id.replace(/"/g, "")}"`).join(",")})`;
      delQuery = delQuery.not("id", "in", inClause);
    }

    const { error: delError } = await delQuery;
    if (delError) {
      console.warn("Failed to prune removed/blank rows from shift_logs before upsert:", delError.message);
    }
  }

  // 6. Upsert Explicitly on Primary Key { onConflict: "id" }
  const { data, error } = await supabase
    .from("shift_logs")
    .upsert(dedupedPayloads, {
      onConflict: "id",
    })
    .select();

  if (error) throw new Error(error.message);

  // Auto-sync valid Machine × Item × Operation cycle times in background (only for valid active rows)
  await syncMachineItemCycleTimes(supabase, normalizedRows);

  revalidatePath("/");
  return {
    success: true,
    count: data?.length ?? dedupedPayloads.length,
    rows: (data as DbShiftLogRow[]).map(mapDbRowToUiRow),
  };
}

/**
 * ACTION 4: Single Machine Kiosk Save (OperatorKiosk.tsx)
 */
export async function updateSingleMachineLog(row: MachineShiftRow) {
  await assertShiftEditable(row.date, row.shift);

  const supabase = createAdminClient();
  const rawShift = row.shift ?? "Shift A";
  const shiftCode = extractShiftCode(rawShift);
  const cleanShift = resolveCleanShiftDisplayName(shiftCode, rawShift);
  const runNo = Number(row.runNo) || 1;
  const deterministicId =
    runNo === 1
      ? `${row.date}_${cleanShift}_${row.line}_${row.machineId}`
      : `${row.date}_${cleanShift}_${row.line}_${row.machineId}_r${runNo}`;

  // If the single machine row is empty, clean it up from shift_logs
  if (isShiftRowEmpty(row)) {
    const { error: delError } = await supabase
      .from("shift_logs")
      .delete()
      .eq("id", deterministicId);
    if (delError) {
      console.warn("Failed to delete cleared machine row from shift_logs:", delError.message);
    }
    revalidatePath("/");
    return {
      success: true,
      row: {
        ...row,
        shift: cleanShift,
        runNo,
        id: deterministicId,
      },
    };
  }

  // Fetch valid item IDs from public.items to sanitize item_id foreign references
  const { data: dbItems } = await supabase.from("items").select("id");
  const validItemIdSet = new Set((dbItems || []).map((i) => i.id.trim()));

  const normalizedRow: MachineShiftRow = {
    ...row,
    shift: cleanShift,
    runNo,
    id: deterministicId,
  };

  const dbPayload = mapUiRowToDbRow(normalizedRow, validItemIdSet);

  const { data, error } = await supabase
    .from("shift_logs")
    .upsert(dbPayload, {
      onConflict: "id",
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  // Auto-sync valid Machine × Item × Operation cycle times in background
  await syncMachineItemCycleTimes(supabase, [normalizedRow]);

  revalidatePath("/");
  return {
    success: true,
    row: mapDbRowToUiRow(data as DbShiftLogRow),
  };
}

/**
 * ACTION 4B: Save All Split Runs for a Single Machine (OperatorKiosk.tsx)
 * Upserts all runs for a machine, ensures sequential runNo, and prunes any removed runs for that machine.
 */
export async function saveMachineRuns(runs: MachineShiftRow[]) {
  if (!runs || runs.length === 0) return { success: true, count: 0, rows: [] };

  const first = runs[0];
  await assertShiftEditable(first.date, first.shift);

  const supabase = createAdminClient();

  const rawShift = first.shift ?? "Shift A";
  const shiftCode = extractShiftCode(rawShift);
  const cleanShift = resolveCleanShiftDisplayName(shiftCode, rawShift);

  // 1. Filter out empty runs
  const activeRuns = runs.filter((r) => !isShiftRowEmpty(r));

  // If ALL runs for this machine are empty, delete any existing saved rows for this machine
  if (activeRuns.length === 0) {
    const { error: delError } = await supabase
      .from("shift_logs")
      .delete()
      .eq("log_date", first.date)
      .eq("shift", cleanShift)
      .eq("line", first.line)
      .eq("machine_id", first.machineId);

    if (delError) {
      console.warn("Failed to prune cleared machine runs from shift_logs:", delError.message);
    }
    revalidatePath("/");
    return { success: true, count: 0, rows: [] };
  }

  // 2. Fetch valid item IDs from public.items to sanitize item_id foreign references
  const { data: dbItems } = await supabase.from("items").select("id");
  const validItemIdSet = new Set((dbItems || []).map((i) => i.id.trim()));

  // 3. Normalize runNo sequentially 1, 2, 3... and deterministic id
  const normalizedRuns: MachineShiftRow[] = activeRuns.map((r, idx) => {
    const runNo = idx + 1;
    const deterministicId =
      runNo === 1
        ? `${r.date}_${cleanShift}_${r.line}_${r.machineId}`
        : `${r.date}_${cleanShift}_${r.line}_${r.machineId}_r${runNo}`;
    return {
      ...r,
      shift: cleanShift,
      runNo,
      id: deterministicId,
    };
  });

  const dbPayloads = normalizedRuns.map((r) => mapUiRowToDbRow(r, validItemIdSet));

  // 4. Deduplicate dbPayloads in memory before touching Supabase
  type DbPayload = ReturnType<typeof mapUiRowToDbRow>;
  const dedupedMap = new Map<string, DbPayload>();
  const seenCompositeKeys = new Set<string>();

  for (const payload of dbPayloads) {
    const compositeKey = `${payload.log_date}|${payload.shift}|${payload.line}|${payload.machine_id}|${payload.run_no}`;
    if (dedupedMap.has(payload.id) || seenCompositeKeys.has(compositeKey)) {
      const existing = dedupedMap.get(payload.id);
      if (
        existing &&
        !isPopulatedDbLogRow(existing as unknown as DbShiftLogRow) &&
        isPopulatedDbLogRow(payload as unknown as DbShiftLogRow)
      ) {
        dedupedMap.set(payload.id, payload);
      }
      continue;
    }
    dedupedMap.set(payload.id, payload);
    seenCompositeKeys.add(compositeKey);
  }

  const dedupedPayloads = Array.from(dedupedMap.values());
  const activeIds = dedupedPayloads.map((p) => p.id).filter(Boolean);

  // 5. Clean up any removed / blanked split runs for this machine on this date/shift/line BEFORE .upsert()
  let delQuery = supabase
    .from("shift_logs")
    .delete()
    .eq("log_date", first.date)
    .eq("shift", cleanShift)
    .eq("line", first.line)
    .eq("machine_id", first.machineId);

  if (activeIds.length > 0) {
    const inClause = `(${activeIds.map((id) => `"${id.replace(/"/g, "")}"`).join(",")})`;
    delQuery = delQuery.not("id", "in", inClause);
  }

  const { error: delError } = await delQuery;
  if (delError) {
    console.warn("Failed to prune removed runs for machine before upsert:", delError.message);
  }

  // 6. Upsert Explicitly on Primary Key { onConflict: "id" }
  const { data, error } = await supabase
    .from("shift_logs")
    .upsert(dedupedPayloads, {
      onConflict: "id",
    })
    .select();

  if (error) throw new Error(error.message);

  // Auto-sync valid cycle times
  await syncMachineItemCycleTimes(supabase, normalizedRuns);

  revalidatePath("/");
  return {
    success: true,
    count: data?.length ?? dedupedPayloads.length,
    rows: (data as DbShiftLogRow[]).map(mapDbRowToUiRow),
  };
}

// ============================================================================
// STEP 2C: MASTER DATA CRUD & ANALYTICS ACTIONS
// ============================================================================

export async function upsertMachineMaster(
  machine: Partial<MachineMaster> & {
    name: string;
    code: string;
    machineType?: string;
    productionLine?: string;
    sortOrder?: number;
  },
  sortOrder?: number
) {
  const supabase = createAdminClient();
  const machineId =
    machine.id ||
    `m_${machine.code.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${Date.now()}`;
  const fallbackSortOrder = parseInt(machineId.replace(/\D/g, ""), 10) || 999;
  const line = machine.line ?? machine.productionLine ?? "Line 1";
  const type = machine.type ?? machine.machineType ?? null;

  const payload: Partial<DbMachineRow> = {
    id: machineId,
    name: machine.name.trim(),
    code: machine.code.trim(),
    line,
    type,
    status: machine.status ?? "active",
    sort_order:
      typeof sortOrder === "number"
        ? sortOrder
        : (machine.sortOrder ?? fallbackSortOrder),
  };

  const { data, error } = await supabase
    .from("machines")
    .upsert(payload, { onConflict: "id" })
    .select()
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/");
  const machineUi = mapDbMachineToUi(data as DbMachineRow);
  return {
    success: true,
    machine: {
      ...machineUi,
      machineType: machineUi.type,
      productionLine: machineUi.line,
    },
    ...machineUi,
  };
}

export async function disableMachineMaster(machineId: string) {
  await assertUnitHead("remove machines");
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("machines")
    .update({ status: "idle" })
    .eq("id", machineId);

  if (error) throw new Error(error.message);
  revalidatePath("/");
  return { success: true };
}

export async function upsertItemMaster(
  item: Partial<ItemMaster> & {
    itemCode: string;
    itemName: string;
    operation: string;
  }
) {
  const supabase = createAdminClient();
  const itemId =
    item.id ||
    `item_${item.itemCode.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${Date.now()}`;

  const { data, error } = await supabase
    .from("items")
    .upsert(
      {
        id: itemId,
        item_code: item.itemCode.trim(),
        item_name: item.itemName.trim(),
        operation: item.operation.trim(),
      },
      { onConflict: "id" }
    )
    .select()
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/");
  const itemUi = mapDbItemToUi(data as DbItemRow);
  return {
    success: true,
    item: itemUi,
    ...itemUi,
  };
}

export async function deleteItemMaster(itemId: string) {
  await assertUnitHead("delete items");
  const supabase = createAdminClient();
  const { error } = await supabase.from("items").delete().eq("id", itemId);

  if (error) throw new Error(error.message);
  revalidatePath("/");
  return { success: true };
}

export async function addOperatorMaster(operatorName: string) {
  const supabase = createAdminClient();
  const cleanName = operatorName.trim();

  const { data, error } = await supabase
    .from("operators")
    .upsert({ name: cleanName, is_active: true }, { onConflict: "name" })
    .select()
    .maybeSingle();

  if (error) throw new Error(error.message);
  revalidatePath("/");
  return {
    success: true,
    name: cleanName,
    operator: {
      id: data?.id ?? `op_${Date.now()}`,
      name: cleanName,
    },
  };
}

export async function removeOperatorMaster(operatorName: string) {
  await assertUnitHead("remove operators");
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("operators")
    .update({ is_active: false })
    .eq("name", operatorName.trim());

  if (error) throw new Error(error.message);
  revalidatePath("/");
  return { success: true };
}

export async function updateOperatorMaster(input: {
  id?: string;
  oldName: string;
  newName: string;
  code?: string;
}) {
  const isAdmin = await isUnitHeadSession();
  if (!isAdmin) {
    throw new Error("Unauthorized: Unit Head login required to edit operators.");
  }

  const supabase = createAdminClient();
  const trimmedNewName = (input.newName || "").trim();
  const trimmedOldName = (input.oldName || "").trim();

  if (!trimmedNewName) {
    throw new Error("Operator name cannot be empty.");
  }

  // Check for duplicate name
  const { data: existingOps, error: checkErr } = await supabase
    .from("operators")
    .select("*")
    .ilike("name", trimmedNewName);

  if (checkErr) throw new Error(checkErr.message);

  if (existingOps && existingOps.length > 0) {
    const isDuplicate = existingOps.some((op) => {
      if (input.id && op.id) return op.id !== input.id;
      return op.name.toLowerCase() !== trimmedOldName.toLowerCase();
    });
    if (isDuplicate) {
      throw new Error("An operator with this name already exists.");
    }
  }

  let updateQuery = supabase
    .from("operators")
    .update({ name: trimmedNewName });

  if (input.id) {
    updateQuery = updateQuery.eq("id", input.id);
  } else {
    updateQuery = updateQuery.eq("name", trimmedOldName);
  }

  const { data: updatedOp, error: updateErr } = await updateQuery
    .select()
    .maybeSingle();

  if (updateErr) throw new Error(updateErr.message);

  // Cascade to public.shift_logs: if oldName differs from newName, update shift_logs
  if (trimmedOldName && trimmedOldName !== trimmedNewName) {
    const { error: cascadeErr } = await supabase
      .from("shift_logs")
      .update({ operator_name: trimmedNewName })
      .eq("operator_name", trimmedOldName);

    if (cascadeErr) {
      console.error("Failed to cascade operator name to shift_logs:", cascadeErr);
    }
  }

  revalidatePath("/");
  return {
    success: true,
    operator: {
      id: updatedOp?.id ?? input.id ?? `op_${Date.now()}`,
      name: trimmedNewName,
    },
  };
}

export async function updateItemMaster(input: {
  id: string;
  oldName: string;
  oldCode?: string;
  oldOperation?: string;
  newName: string;
  newCode: string;
  newOperation?: string;
  operationRenames?: Array<{ oldOp: string; newOp: string }>;
}) {
  const isAdmin = await isUnitHeadSession();
  if (!isAdmin) {
    throw new Error("Unauthorized: Unit Head login required to edit items.");
  }

  const supabase = createAdminClient();
  const trimmedNewName = (input.newName || "").trim();
  const trimmedNewCode = (input.newCode || "").trim().toUpperCase();
  const trimmedOldName = (input.oldName || "").trim();
  const trimmedOldCode = (input.oldCode || "").trim().toUpperCase();
  const rawOldOp = (input.oldOperation || "").trim();
  const rawNewOp = (input.newOperation ?? input.oldOperation ?? "").trim();

  if (!trimmedNewName) {
    throw new Error("Item name cannot be empty.");
  }
  if (!trimmedNewCode) {
    throw new Error("Item code cannot be empty.");
  }

  // 1. Parse and validate operations
  const opTokens = rawNewOp
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  const seenOps = new Set<string>();
  const normalizedOps: string[] = [];
  for (const op of opTokens) {
    const lower = op.toLowerCase();
    if (!seenOps.has(lower)) {
      seenOps.add(lower);
      normalizedOps.push(op);
    }
  }

  if (normalizedOps.length === 0) {
    throw new Error("At least one operation is required.");
  }

  const normalizedNewOpString = normalizedOps.join(", ");

  // 2. Fetch all items to identify siblings (multi-operation items) and duplicate code check
  const { data: allItems, error: itemsErr } = await supabase
    .from("items")
    .select("*");

  if (itemsErr) throw new Error(itemsErr.message);

  const siblingIds = new Set<string>();
  siblingIds.add(input.id);

  if (allItems) {
    for (const it of allItems) {
      const matchName =
        trimmedOldName &&
        it.item_name &&
        it.item_name.trim().toLowerCase() === trimmedOldName.toLowerCase();
      const matchCode =
        trimmedOldCode &&
        it.item_code &&
        it.item_code.trim().toLowerCase() === trimmedOldCode.toLowerCase();
      if (matchName || matchCode) {
        siblingIds.add(it.id);
      }
    }

    // Check if another unrelated item (not in siblingIds) already has the newCode
    for (const it of allItems) {
      if (!siblingIds.has(it.id)) {
        if (
          it.item_code &&
          it.item_code.trim().toUpperCase() === trimmedNewCode
        ) {
          throw new Error(`An item with code "${trimmedNewCode}" already exists.`);
        }
      }
    }
  }

  const idsToUpdate = Array.from(siblingIds);

  // 3. Update public.items:
  // Update the edited row with item_name, item_code, and operation
  const { error: updateMainErr } = await supabase
    .from("items")
    .update({
      item_name: trimmedNewName,
      item_code: trimmedNewCode,
      operation: normalizedNewOpString,
    })
    .eq("id", input.id);

  if (updateMainErr) throw new Error(updateMainErr.message);

  // If there are other sibling rows sharing item_name/code, update their item_name & code too
  const otherSiblingIds = idsToUpdate.filter((id) => id !== input.id);
  if (otherSiblingIds.length > 0) {
    const { error: updateSiblingsErr } = await supabase
      .from("items")
      .update({
        item_name: trimmedNewName,
        item_code: trimmedNewCode,
      })
      .in("id", otherSiblingIds);

    if (updateSiblingsErr) {
      console.warn("Failed to update sibling items name/code:", updateSiblingsErr.message);
    }
  }

  // 4. Determine Operation Renames (renames array)
  const renames: Array<{ oldOp: string; newOp: string }> = [];
  if (input.operationRenames && input.operationRenames.length > 0) {
    for (const r of input.operationRenames) {
      const oldOpTrim = (r.oldOp || "").trim();
      const newOpTrim = (r.newOp || "").trim();
      if (oldOpTrim && newOpTrim && oldOpTrim.toLowerCase() !== newOpTrim.toLowerCase()) {
        renames.push({ oldOp: oldOpTrim, newOp: newOpTrim });
      }
    }
  } else if (
    rawOldOp &&
    !rawOldOp.includes(",") &&
    !normalizedNewOpString.includes(",") &&
    rawOldOp.toLowerCase() !== normalizedNewOpString.toLowerCase()
  ) {
    renames.push({ oldOp: rawOldOp, newOp: normalizedNewOpString });
  }

  // 5. Cascade to public.shift_logs
  // Update item_name by item_id
  const { error: cascadeIdErr } = await supabase
    .from("shift_logs")
    .update({ item_name: trimmedNewName })
    .in("item_id", idsToUpdate);

  if (cascadeIdErr) {
    console.error("Failed to cascade item name to shift_logs by item_id:", cascadeIdErr);
  }

  if (trimmedOldName && trimmedOldName !== trimmedNewName) {
    const { error: cascadeNameErr } = await supabase
      .from("shift_logs")
      .update({ item_name: trimmedNewName })
      .eq("item_name", trimmedOldName);

    if (cascadeNameErr) {
      console.error("Failed to cascade item name to shift_logs by item_name:", cascadeNameErr);
    }
  }

  // Cascade renamed operations to public.shift_logs
  for (const { oldOp, newOp } of renames) {
    const { error: opCascadeErr } = await supabase
      .from("shift_logs")
      .update({ operation: newOp })
      .in("item_id", idsToUpdate)
      .eq("operation", oldOp);

    if (opCascadeErr) {
      console.error(`Failed to cascade operation "${oldOp}" -> "${newOp}" in shift_logs:`, opCascadeErr);
    }
  }

  // 6. Cascade Renamed Operations to public.machine_item_cycle_times (Collision-Safe)
  for (const { oldOp, newOp } of renames) {
    const { data: matchedCycleTimes, error: fetchCtErr } = await supabase
      .from("machine_item_cycle_times")
      .select("*")
      .in("item_id", idsToUpdate)
      .eq("operation", oldOp);

    if (fetchCtErr) {
      console.error(`Failed to fetch cycle times for operation "${oldOp}":`, fetchCtErr);
      continue;
    }

    if (matchedCycleTimes && matchedCycleTimes.length > 0) {
      for (const ct of matchedCycleTimes) {
        // Check if a row already exists for (machine_id, item_id, newOp)
        const { data: existingConflict } = await supabase
          .from("machine_item_cycle_times")
          .select("id")
          .eq("machine_id", ct.machine_id)
          .eq("item_id", ct.item_id)
          .eq("operation", newOp)
          .maybeSingle();

        if (existingConflict) {
          // Conflict found: delete the duplicate old row
          if (ct.id) {
            await supabase.from("machine_item_cycle_times").delete().eq("id", ct.id);
          } else {
            await supabase
              .from("machine_item_cycle_times")
              .delete()
              .eq("machine_id", ct.machine_id)
              .eq("item_id", ct.item_id)
              .eq("operation", oldOp);
          }
        } else {
          // No conflict: safe to update operation
          if (ct.id) {
            await supabase
              .from("machine_item_cycle_times")
              .update({
                operation: newOp,
                updated_at: new Date().toISOString(),
              })
              .eq("id", ct.id);
          } else {
            await supabase
              .from("machine_item_cycle_times")
              .update({
                operation: newOp,
                updated_at: new Date().toISOString(),
              })
              .eq("machine_id", ct.machine_id)
              .eq("item_id", ct.item_id)
              .eq("operation", oldOp);
          }
        }
      }
    }
  }

  // 7. Cascade to public.shift_item_production
  const oldItemKey = buildCanonicalItemKey(trimmedOldCode, trimmedOldName);
  const newItemKey = buildCanonicalItemKey(trimmedNewCode, trimmedNewName);

  if (trimmedOldName !== trimmedNewName || trimmedOldCode !== trimmedNewCode || oldItemKey !== newItemKey) {
    try {
      const { data: prodRows } = await supabase
        .from("shift_item_production")
        .select("*")
        .or(`item_key.eq.${oldItemKey},item_id.in.(${idsToUpdate.join(",")}),item_name.eq.${trimmedOldName}`);

      if (prodRows && prodRows.length > 0) {
        for (const row of prodRows) {
          // Check if a row with newItemKey already exists for the same (log_date, shift, line)
          const { data: collision } = await supabase
            .from("shift_item_production")
            .select("id, total_production, remarks")
            .eq("log_date", row.log_date)
            .eq("shift", row.shift)
            .eq("line", row.line)
            .eq("item_key", newItemKey)
            .neq("id", row.id)
            .maybeSingle();

          if (collision) {
            // Merge into existing collision row: sum total_production, combine remarks, delete old row
            const combinedTotal = (Number(collision.total_production) || 0) + (Number(row.total_production) || 0);
            const combinedRemarks = [collision.remarks, row.remarks].filter(Boolean).join(" | ");
            await supabase
              .from("shift_item_production")
              .update({
                total_production: combinedTotal,
                remarks: combinedRemarks,
                item_name: trimmedNewName,
                item_code: trimmedNewCode,
                updated_at: new Date().toISOString(),
              })
              .eq("id", collision.id);

            await supabase
              .from("shift_item_production")
              .delete()
              .eq("id", row.id);
          } else {
            // Update row cleanly
            await supabase
              .from("shift_item_production")
              .update({
                item_key: newItemKey,
                item_name: trimmedNewName,
                item_code: trimmedNewCode,
                item_id: input.id,
                updated_at: new Date().toISOString(),
              })
              .eq("id", row.id);
          }
        }
      }
    } catch (sipErr) {
      console.error("Failed to cascade rename to shift_item_production:", sipErr);
    }
  }

  revalidatePath("/");
  return { success: true, renames };
}

export async function upsertMachineItemCycleTime(entry: MachineItemCycleTime) {
  if (
    !entry.machineId ||
    entry.machineId.startsWith("temp_") ||
    !entry.itemId ||
    !entry.operation?.trim()
  ) {
    return { success: true, skipped: true };
  }

  const supabase = createAdminClient();

  // Strict Foreign-Key Guard: verify machine_id exists in public.machines
  const { data: macData, error: macErr } = await supabase
    .from("machines")
    .select("id")
    .eq("id", entry.machineId)
    .maybeSingle();

  if (macErr || !macData) {
    console.warn(
      `[upsertMachineItemCycleTime] Machine ID "${entry.machineId}" does not exist in public.machines. Skipping to prevent FK violation.`
    );
    return { success: true, skipped: true, reason: "machine_not_found" };
  }

  // Also verify item_id exists in public.items
  const { data: itmData, error: itmErr } = await supabase
    .from("items")
    .select("id")
    .eq("id", entry.itemId)
    .maybeSingle();

  if (itmErr || !itmData) {
    console.warn(
      `[upsertMachineItemCycleTime] Item ID "${entry.itemId}" does not exist in public.items. Skipping to prevent FK violation.`
    );
    return { success: true, skipped: true, reason: "item_not_found" };
  }

  const { error } = await supabase.from("machine_item_cycle_times").upsert(
    {
      machine_id: entry.machineId,
      item_id: entry.itemId,
      operation: entry.operation.trim(),
      cycle_time: Number(entry.cycleTime) || 0,
      is_active: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "machine_id,item_id,operation" }
  );

  if (error) {
    console.warn("Failed to upsert machine_item_cycle_times:", error.message);
    return { success: false, error: error.message };
  }
  revalidatePath("/");
  return { success: true };
}

export async function deleteMachineItemCycleTime(id: number) {
  await assertUnitHead("delete cycle times");
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("machine_item_cycle_times")
    .delete()
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/");
  return { success: true };
}

export async function upsertProductionLine(line: ProductionLineMaster) {
  await assertUnitHead("modify production line");
  const supabase = createAdminClient();
  const { error } = await supabase.from("production_lines").upsert(
    {
      id: line.id,
      name: line.name.trim(),
      description: line.description ?? "",
      daily_working_minutes: Number(line.dailyWorkingMinutes) || 1305,
      is_active: line.isActive ?? true,
      sort_order: line.sortOrder ?? 99,
    },
    { onConflict: "id" }
  );

  if (error) throw new Error(error.message);
  revalidatePath("/");
  return { success: true };
}

export async function upsertShiftMaster(shift: ShiftMaster) {
  await assertUnitHead("modify shift timings or break minutes");
  const supabase = createAdminClient();
  const { error } = await supabase.from("shifts").upsert(
    {
      id: shift.id,
      shift_code: shift.shiftCode.trim(),
      display_name: shift.displayName.trim(),
      start_time: shift.startTime,
      end_time: shift.endTime,
      rest_break_minutes: Number(shift.restBreakMinutes) || 30,
      cleaning_break_minutes: Number(shift.cleaningBreakMinutes) || 15,
      shift_working_minutes: Number(shift.shiftWorkingMinutes) || 465,
      total_working_minutes_ref: Number(shift.totalWorkingMinutesRef) || 1305,
      is_active: shift.isActive ?? true,
      sort_order: shift.sortOrder ?? 99,
    },
    { onConflict: "id" }
  );

  if (error) throw new Error(error.message);
  revalidatePath("/");
  return { success: true };
}

export async function deleteProductionLine(lineId: string) {
  await assertUnitHead("delete production line");
  const supabase = createAdminClient();
  // Soft-delete so historical shift_logs on this line stay intact
  const { error } = await supabase
    .from("production_lines")
    .update({ is_active: false })
    .eq("id", lineId);

  if (error) throw new Error(error.message);
  revalidatePath("/");
  return { success: true };
}

export async function deleteShiftMaster(shiftId: string) {
  await assertUnitHead("delete shift");
  const supabase = createAdminClient();
  // Soft-delete so historical shift_logs on this shift stay intact
  const { error } = await supabase
    .from("shifts")
    .update({ is_active: false })
    .eq("id", shiftId);

  if (error) throw new Error(error.message);
  revalidatePath("/");
  return { success: true };
}

export async function getAnalyticsLogs(
  daysBackOrFilter: number | { startDate?: string; endDate?: string } | string = 30,
  maybeToDate?: string
): Promise<MachineShiftRow[]> {
  const supabase = createAdminClient();

  let startDate: string | undefined;
  let endDate: string | undefined;

  if (typeof daysBackOrFilter === "string") {
    startDate = daysBackOrFilter;
    endDate = maybeToDate;
  } else if (typeof daysBackOrFilter === "object" && daysBackOrFilter !== null) {
    startDate = daysBackOrFilter.startDate;
    endDate = daysBackOrFilter.endDate;
  } else {
    const daysBack = typeof daysBackOrFilter === "number" ? daysBackOrFilter : 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
    startDate = cutoffDate.toISOString().split("T")[0];
  }

  const PAGE_SIZE = 1000;
  const MAX_PAGES = 50;
  let offset = 0;
  let pageCount = 0;
  const allRows: DbShiftLogRow[] = [];

  while (pageCount < MAX_PAGES) {
    pageCount++;
    let query = supabase
      .from("shift_logs")
      .select("*")
      .order("log_date", { ascending: false })
      .order("sr_no", { ascending: true })
      .order("run_no", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (startDate) {
      query = query.gte("log_date", startDate);
    }
    if (endDate) {
      query = query.lte("log_date", endDate);
    }

    const { data, error } = await query;
    if (error) {
      console.error("getAnalyticsLogs query error:", error);
      break;
    }

    const chunk = (data as DbShiftLogRow[]) || [];
    allRows.push(...chunk);

    if (chunk.length < PAGE_SIZE) {
      break;
    }
    offset += PAGE_SIZE;
  }

  return allRows.map(mapDbRowToUiRow);
}

/**
 * ============================================================================
 * SHIFT FINISHED GOODS PRODUCTION (public.shift_item_production)
 * ============================================================================
 */

export async function getShiftItemProduction(
  date: string,
  shift: string,
  line: string
): Promise<ShiftItemProductionRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("shift_item_production")
    .select("*")
    .eq("log_date", date)
    .eq("shift", shift)
    .eq("line", line)
    .order("item_code", { ascending: true });

  if (error) {
    console.error("Failed to fetch shift_item_production:", error);
    return [];
  }

  return (data || []).map((row: DbShiftItemProductionRow) => ({
    id: row.id,
    date: row.log_date,
    shift: row.shift as ShiftType,
    line: row.line,
    itemKey: row.item_key,
    itemId: row.item_id,
    itemCode: row.item_code || "",
    itemName: row.item_name || "",
    totalProduction: Number(row.total_production) || 0,
    remarks: row.remarks || "",
  }));
}

export async function saveShiftItemProduction(
  date: string,
  shift: string,
  line: string,
  rows: ShiftItemProductionRow[]
): Promise<{ success: boolean; savedCount: number }> {
  const supabase = createAdminClient();

  // 1. Delete existing rows for this date, shift, and line first (so clearing to 0 cleans DB)
  const { error: delErr } = await supabase
    .from("shift_item_production")
    .delete()
    .eq("log_date", date)
    .eq("shift", shift)
    .eq("line", line);

  if (delErr) {
    console.error("Failed to delete existing shift_item_production:", delErr);
    throw new Error(`Failed to clear existing finished production: ${delErr.message}`);
  }

  // 2. Filter out empty rows ((Number(r.totalProduction) || 0) <= 0 && !(r.remarks || "").trim())
  const nonEmptyRows = (rows || []).filter((r) => {
    const qty = Number(r.totalProduction) || 0;
    const rem = (r.remarks || "").trim();
    return qty > 0 || rem.length > 0;
  });

  if (nonEmptyRows.length === 0) {
    revalidatePath("/");
    return { success: true, savedCount: 0 };
  }

  // 3. Deduplicate by itemKey (if duplicates exist, keep the last non-empty entry)
  const dedupMap = new Map<string, ShiftItemProductionRow>();
  for (const r of nonEmptyRows) {
    const key = r.itemKey || buildCanonicalItemKey(r.itemCode, r.itemName);
    if (!key) continue;
    dedupMap.set(key, { ...r, itemKey: key });
  }

  const payloads = Array.from(dedupMap.values()).map((r) => ({
    log_date: date,
    shift: shift,
    line: line,
    item_key: r.itemKey,
    item_id: r.itemId || null,
    item_code: (r.itemCode || "").trim(),
    item_name: (r.itemName || "").trim(),
    total_production: Math.max(0, Math.round(Number(r.totalProduction) || 0)),
    remarks: (r.remarks || "").trim(),
    updated_at: new Date().toISOString(),
  }));

  if (payloads.length === 0) {
    revalidatePath("/");
    return { success: true, savedCount: 0 };
  }

  const { error: insertErr } = await supabase
    .from("shift_item_production")
    .insert(payloads);

  if (insertErr) {
    console.error("Failed to insert shift_item_production:", insertErr);
    throw new Error(`Failed to save finished production: ${insertErr.message}`);
  }

  revalidatePath("/");
  return { success: true, savedCount: payloads.length };
}

export async function getAnalyticsItemProduction(
  fromDate: string,
  toDate: string
): Promise<ShiftItemProductionRow[]> {
  const supabase = createAdminClient();

  const PAGE_SIZE = 1000;
  const MAX_PAGES = 50;
  let offset = 0;
  let pageCount = 0;
  const allRows: DbShiftItemProductionRow[] = [];

  while (pageCount < MAX_PAGES) {
    pageCount++;
    const query = supabase
      .from("shift_item_production")
      .select("*")
      .gte("log_date", fromDate)
      .lte("log_date", toDate)
      .order("log_date", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    const { data, error } = await query;
    if (error) {
      console.error("getAnalyticsItemProduction query error:", error);
      break;
    }

    const chunk = (data as DbShiftItemProductionRow[]) || [];
    allRows.push(...chunk);

    if (chunk.length < PAGE_SIZE) {
      break;
    }
    offset += PAGE_SIZE;
  }

  return allRows.map((row: DbShiftItemProductionRow) => ({
    id: row.id,
    date: row.log_date,
    shift: row.shift as ShiftType,
    line: row.line,
    itemKey: row.item_key,
    itemId: row.item_id,
    itemCode: row.item_code || "",
    itemName: row.item_name || "",
    totalProduction: Number(row.total_production) || 0,
    remarks: row.remarks || "",
  }));
}

/**
 * STEP 1: Item Production Rollups
 * Aggregates production totals per item across:
 * - todayOutput: sum of actual_output where log_date === todayDateIst
 * - mtdOutput: sum of actual_output where log_date >= YYYY-MM-01 and <= todayDateIst
 * - tillNowOutput: cumulative sum of actual_output across all dates in shift_logs
 * - tillNowStd: cumulative sum of std_output across all dates
 * - tillNowRework: cumulative sum of rework across all dates
 * - todayFinished / mtdFinished / tillNowFinished: from public.shift_item_production
 */
export async function getItemProductionRollups(
  todayDateIst?: string
): Promise<ItemProductionRollup[]> {
  const supabase = createAdminClient();

  const refDate =
    (todayDateIst && todayDateIst.trim()) ||
    new Date().toISOString().slice(0, 10);
  const parts = refDate.split("-");
  const mtdStart =
    parts.length >= 2
      ? `${parts[0]}-${parts[1].padStart(2, "0")}-01`
      : refDate;

  // 1. Build Item Master map for item code & canonical names
  const itemCodeMap = new Map<string, { id?: string; itemCode: string; itemName: string }>();
  try {
    const { data: dbItems } = await supabase
      .from("items")
      .select("id, item_code, item_name");
    if (dbItems) {
      for (const it of dbItems) {
        const info = {
          id: it.id || "",
          itemCode: it.item_code || "",
          itemName: it.item_name || "",
        };
        const idKey = (it.id || "").trim().toLowerCase();
        const codeKey = (it.item_code || "").trim().toLowerCase();
        const nameKey = (it.item_name || "").trim().toLowerCase();
        if (idKey.length > 0) itemCodeMap.set(idKey, info);
        if (codeKey.length > 0) itemCodeMap.set(codeKey, info);
        if (nameKey.length > 0) itemCodeMap.set(nameKey, info);
      }
    }
  } catch {
    // Ignore master items query failure
  }

  // 2. Query shift logs with non-zero production or target
  const { data, error } = await supabase
    .from("shift_logs")
    .select("item_id, item_name, log_date, actual_output, std_output, rework")
    .or("actual_output.gt.0,std_output.gt.0")
    .limit(25000);

  if (error) {
    console.error("Failed to fetch item rollups from shift_logs:", error);
    return [];
  }

  const rollupsMap = new Map<string, ItemProductionRollup>();

  for (const row of (data || [])) {
    const rawId = (row.item_id || "").trim();
    const rawName = (row.item_name || "").trim();
    if (!rawId && !rawName) continue;

    const idKey = rawId.toLowerCase();
    const nameKey = rawName.toLowerCase();

    // Resolve item metadata
    const masterInfo =
      (idKey.length > 0 ? itemCodeMap.get(idKey) : null) ||
      (nameKey.length > 0 ? itemCodeMap.get(nameKey) : null);

    const itemCode = masterInfo?.itemCode || (rawId.startsWith("item_") || rawId.startsWith("it_") ? "" : rawId);
    const itemName = masterInfo?.itemName || rawName || itemCode || "Unknown Part";
    const itemId = masterInfo?.id || rawId || "";
    const groupKey = (itemCode || itemId || rawName).toLowerCase();

    if (!rollupsMap.has(groupKey)) {
      rollupsMap.set(groupKey, {
        itemId: itemId || groupKey,
        itemCode,
        itemName,
        todayOutput: 0,
        mtdOutput: 0,
        tillNowOutput: 0,
        tillNowStd: 0,
        tillNowRework: 0,
        todayFinished: 0,
        mtdFinished: 0,
        tillNowFinished: 0,
      });
    }

    const entry = rollupsMap.get(groupKey)!;
    const act = Number(row.actual_output) || 0;
    const std = Number(row.std_output) || 0;
    const rew = Number(row.rework) || 0;
    const logDate = row.log_date || "";

    entry.tillNowOutput += act;
    entry.tillNowStd += std;
    entry.tillNowRework += rew;

    if (logDate === refDate) {
      entry.todayOutput += act;
    }
    if (logDate >= mtdStart && logDate <= refDate) {
      entry.mtdOutput += act;
    }
  }

  // 3. Query public.shift_item_production for finished goods rollups
  try {
    const { data: finishedRows, error: finishedErr } = await supabase
      .from("shift_item_production")
      .select("item_key, item_code, item_name, item_id, log_date, total_production")
      .gt("total_production", 0)
      .limit(25000);

    if (finishedErr) {
      console.error("Failed to fetch shift_item_production rollups:", finishedErr);
    } else if (finishedRows) {
      for (const row of finishedRows) {
        const qty = Number(row.total_production) || 0;
        if (qty <= 0) continue;

        const rawCode = (row.item_code || "").trim();
        const rawName = (row.item_name || "").trim();
        const rawKey = (row.item_key || "").trim();
        const rawId = (row.item_id || "").trim();

        const idKey = rawId.toLowerCase();
        const codeKey = rawCode.toLowerCase();
        const nameKey = rawName.toLowerCase();

        const masterInfo =
          (idKey.length > 0 ? itemCodeMap.get(idKey) : null) ||
          (codeKey.length > 0 ? itemCodeMap.get(codeKey) : null) ||
          (nameKey.length > 0 ? itemCodeMap.get(nameKey) : null);

        const itemCode = masterInfo?.itemCode || rawCode;
        const itemName = masterInfo?.itemName || rawName || itemCode || "Unknown Part";
        const itemId = masterInfo?.id || rawId || "";
        const groupKey = (itemCode || itemId || rawName || rawKey).toLowerCase();

        if (!rollupsMap.has(groupKey)) {
          rollupsMap.set(groupKey, {
            itemId: itemId || groupKey,
            itemCode,
            itemName,
            todayOutput: 0,
            mtdOutput: 0,
            tillNowOutput: 0,
            tillNowStd: 0,
            tillNowRework: 0,
            todayFinished: 0,
            mtdFinished: 0,
            tillNowFinished: 0,
          });
        }

        const entry = rollupsMap.get(groupKey)!;
        entry.tillNowFinished = (entry.tillNowFinished || 0) + qty;

        const logDate = row.log_date || "";
        if (logDate === refDate) {
          entry.todayFinished = (entry.todayFinished || 0) + qty;
        }
        if (logDate >= mtdStart && logDate <= refDate) {
          entry.mtdFinished = (entry.mtdFinished || 0) + qty;
        }
      }
    }
  } catch (err) {
    console.error("Error computing finished rollups:", err);
  }

  return Array.from(rollupsMap.values()).sort(
    (a, b) => b.tillNowOutput - a.tillNowOutput
  );
}

/**
 * Alias for getItemProductionRollups matching user specifications.
 */
export async function getItemProductionSummary(
  todayDateIst?: string
): Promise<ItemProductionRollup[]> {
  return getItemProductionRollups(todayDateIst);
}
