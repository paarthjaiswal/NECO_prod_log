"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createAdminClient } from "@/utils/supabase/server";
import { getIsUnitHead } from "@/actions/authActions";
import { evaluateShiftLock } from "@/services/storageService";
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
} from "@/types";

// ============================================================================
// DATABASE ROW INTERFACES (Matches your upgraded Supabase SQL Schema)
// ============================================================================

export interface DbShiftLogRow {
  id: string;
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
  // Read-only PostgreSQL GENERATED ALWAYS columns (present on SELECT, excluded on UPSERT)
  total_bd_minutes?: number | null;
  bd_no_disc_pct?: number | null;
  bd_change_pct?: number | null;
  bd_power_pct?: number | null;
  bd_operator_pct?: number | null;
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
  status: "active" | "maintenance" | "idle" | null;
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
  const lower = shiftStr.toLowerCase();
  if (lower.includes("shift a") || lower.includes("6am") || lower.includes("7am")) return "Shift A";
  if (lower.includes("shift b") || lower.includes("2pm") || lower.includes("3:30pm") || lower.includes("15:30")) return "Shift B";
  if (lower.includes("shift c") || lower.includes("10pm") || lower.includes("12am")) return "Shift C";
  const match = shiftStr.match(/^(Shift\s+[A-Za-z0-9]+)/i);
  return match ? match[1] : shiftStr.trim();
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
  const noDisc = Number(dbRow.bd_no_disc ?? 0);
  const change = Number(dbRow.bd_change ?? 0);
  const power = Number(dbRow.bd_power ?? 0);
  const operator = Number(dbRow.bd_operator ?? 0);
  const totalBd = Number(
    dbRow.total_bd_minutes ?? noDisc + change + power + operator
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
    machineId: dbRow.machine_id ?? "",
    machineName: dbRow.machine_name ?? "",
    operatorName: dbRow.operator_name ?? "",
    itemId: dbRow.item_id ?? "",
    itemName: dbRow.item_name ?? "",
    operation: dbRow.operation ?? "",
    cycleTime: Number(dbRow.cycle_time ?? 0),
    totalWorkingMinutes: totalWorking,
    stdOutput: Number(dbRow.std_output ?? 0),
    actualOutput: Number(dbRow.actual_output ?? 0),
    rework: Number(dbRow.rework ?? 0),
    breakdown: {
      noDisc,
      change,
      power,
      operator,
    },
    breakdownPct: {
      noDiscPct: Number(dbRow.bd_no_disc_pct ?? 0),
      changePct: Number(dbRow.bd_change_pct ?? 0),
      powerPct: Number(dbRow.bd_power_pct ?? 0),
      operatorPct: Number(dbRow.bd_operator_pct ?? 0),
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
function mapUiRowToDbRow(uiRow: MachineShiftRow) {
  const rawShift = uiRow.shift ?? "Shift A";
  const shiftCode = extractShiftCode(rawShift);
  const cleanShift = resolveCleanShiftDisplayName(shiftCode, rawShift);

  return {
    id:
      uiRow.id ||
      `${uiRow.date}_${cleanShift}_${uiRow.line}_${uiRow.machineId}`,
    log_date: uiRow.date,
    shift: cleanShift,
    line: uiRow.line,
    sr_no: Number(uiRow.srNo) || 0,
    machine_id: uiRow.machineId,
    machine_name: uiRow.machineName,
    operator_name: uiRow.operatorName?.trim() ?? "",
    item_id: uiRow.itemId?.trim() ?? "",
    item_name: uiRow.itemName?.trim() ?? "",
    operation: uiRow.operation?.trim() ?? "",
    cycle_time: Number(uiRow.cycleTime) || 0,
    total_working_minutes: Number(uiRow.totalWorkingMinutes) || 1305,
    std_output: Number(uiRow.stdOutput) || 0,
    actual_output: Number(uiRow.actualOutput) || 0,
    rework: Number(uiRow.rework) || 0,
    bd_no_disc: Number(uiRow.breakdown?.noDisc) || 0,
    bd_change: Number(uiRow.breakdown?.change) || 0,
    bd_power: Number(uiRow.breakdown?.power) || 0,
    bd_operator: Number(uiRow.breakdown?.operator) || 0,
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

function hydrateShiftSheetRows(
  sortedLineMachines: DbMachineRow[],
  savedDbLogs: DbShiftLogRow[],
  date: string,
  shift: ShiftType,
  line: string,
  shiftWorkingMinutes: number // Fetched dynamically from public.shifts
): MachineShiftRow[] {
  const savedLogMap = new Map<string, DbShiftLogRow>(
    savedDbLogs
      .filter((row) => row.machine_id !== null)
      .map((row) => [row.machine_id as string, row])
  );

  return sortedLineMachines.map((machine, index) => {
    const existingLog = savedLogMap.get(machine.id);
    if (existingLog) {
      const uiRow = mapDbRowToUiRow(existingLog);
      return {
        ...uiRow,
        srNo: index + 1,
        // Ensure totalWorkingMinutes always reflects the single shift's DB duration
        totalWorkingMinutes: shiftWorkingMinutes || uiRow.totalWorkingMinutes || 1305,
      };
    }

    return {
      id: `${date}_${shift}_${line}_${machine.id}`,
      date,
      shift,
      line,
      srNo: index + 1,
      machineId: machine.id,
      machineName: machine.name,
      operatorName: "",
      itemId: "",
      itemName: "",
      operation: "",
      cycleTime: 0,
      totalWorkingMinutes: shiftWorkingMinutes || 1305,
      stdOutput: 0,
      actualOutput: 0,
      rework: 0,
      breakdown: {
        noDisc: 0,
        change: 0,
        power: 0,
        operator: 0,
      },
      breakdownPct: {
        noDiscPct: 0,
        changePct: 0,
        powerPct: 0,
        operatorPct: 0,
        totalBdMinutes: 0,
        totalBdPct: 0,
      },
      remarks: "",
    };
  });
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
      .order("sort_order", { ascending: true }),
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
      .eq("line", line)
      .neq("status", "idle")
      .order("sort_order", { ascending: true }),
    supabase
      .from("shift_logs")
      .select("*")
      .eq("log_date", date)
      .eq("shift", shift)
      .eq("line", line)
      .order("sr_no", { ascending: true }),
    supabase
      .from("shifts")
      .select("shift_working_minutes")
      .or(`display_name.eq."${shift}",shift_code.eq."${shift}",shift_code.eq."${shiftCode}"`)
      .maybeSingle(),
  ]);

  if (machinesRes.error) throw new Error(machinesRes.error.message);
  if (logsRes.error) throw new Error(logsRes.error.message);
  if (shiftConfigRes.error) throw new Error(shiftConfigRes.error.message);

  const dbShiftMinutes = Number(shiftConfigRes.data?.shift_working_minutes ?? 1305);

  return hydrateShiftSheetRows(
    machinesRes.data as DbMachineRow[],
    logsRes.data as DbShiftLogRow[],
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
    const ct = Number(row.cycleTime);
    const op = row.operation?.trim();
    if (row.machineId && row.itemId && op && ct > 0) {
      const key = `${row.machineId}::${row.itemId}::${op}`;
      validPairs.set(key, {
        id: `ct_${row.machineId}_${row.itemId}_${op.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
        machine_id: row.machineId,
        item_id: row.itemId,
        operation: op,
        cycle_time: ct,
        is_active: true,
        updated_at: new Date().toISOString(),
      });
    }
  }

  if (validPairs.size === 0) return;

  const { error } = await supabase
    .from("machine_item_cycle_times")
    .upsert(Array.from(validPairs.values()), {
      onConflict: "machine_id,item_id,operation",
    });

  if (error) {
    // If the database id column has an integer/serial constraint, retry omitting the string id
    const withoutId = Array.from(validPairs.values()).map((p) => ({
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
      console.error("Failed to auto-sync machine_item_cycle_times:", retry.error.message);
    }
  }
}

/**
 * ACTION 3: Batch Save Shift Sheet (DailyShiftSheet.tsx)
 */
export async function saveShiftSheetRows(rows: MachineShiftRow[]) {
  if (!rows || rows.length === 0) return { success: true, count: 0, rows: [] };

  const isAdmin = await isUnitHeadSession();

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
  const dbPayloads = rows.map((r) => {
    const payload = mapUiRowToDbRow(r);
    if (!isAdmin) {
      const ct = Number(payload.cycle_time) || 0;
      const totalWorking = Number(payload.total_working_minutes) || 0;
      payload.std_output = ct > 0 ? Math.floor(totalWorking / ct) : 0;
    }
    return payload;
  });

  const { data, error } = await supabase
    .from("shift_logs")
    .upsert(dbPayloads, {
      onConflict: "log_date,shift,line,machine_id",
    })
    .select();

  if (error) throw new Error(error.message);

  // Auto-sync valid Machine × Item × Operation cycle times in background
  await syncMachineItemCycleTimes(supabase, rows);

  revalidatePath("/");
  return {
    success: true,
    count: data?.length ?? dbPayloads.length,
    rows: (data as DbShiftLogRow[]).map(mapDbRowToUiRow),
  };
}

/**
 * ACTION 4: Single Machine Kiosk Save (OperatorKiosk.tsx)
 */
export async function updateSingleMachineLog(row: MachineShiftRow) {
  const isAdmin = await isUnitHeadSession();
  await assertShiftEditable(row.date, row.shift);

  const supabase = createAdminClient();
  const dbPayload = mapUiRowToDbRow(row);

  if (!isAdmin) {
    const ct = Number(dbPayload.cycle_time) || 0;
    const totalWorking = Number(dbPayload.total_working_minutes) || 0;
    dbPayload.std_output = ct > 0 ? Math.floor(totalWorking / ct) : 0;
  }

  const { data, error } = await supabase
    .from("shift_logs")
    .upsert(dbPayload, {
      onConflict: "log_date,shift,line,machine_id",
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  // Auto-sync valid Machine × Item × Operation cycle times in background
  await syncMachineItemCycleTimes(supabase, [row]);

  revalidatePath("/");
  return {
    success: true,
    row: mapDbRowToUiRow(data as DbShiftLogRow),
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

export async function upsertMachineItemCycleTime(entry: MachineItemCycleTime) {
  const supabase = createAdminClient();
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

  if (error) throw new Error(error.message);
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
  daysBackOrFilter: number | { startDate?: string; endDate?: string } = 30
): Promise<MachineShiftRow[]> {
  const supabase = createAdminClient();

  let startDate: string | undefined;
  let endDate: string | undefined;

  if (typeof daysBackOrFilter === "object" && daysBackOrFilter !== null) {
    startDate = daysBackOrFilter.startDate;
    endDate = daysBackOrFilter.endDate;
  } else {
    const daysBack = typeof daysBackOrFilter === "number" ? daysBackOrFilter : 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
    startDate = cutoffDate.toISOString().split("T")[0];
  }

  let query = supabase
    .from("shift_logs")
    .select("*")
    .order("log_date", { ascending: false })
    .order("sr_no", { ascending: true });

  if (startDate) {
    query = query.gte("log_date", startDate);
  }
  if (endDate) {
    query = query.lte("log_date", endDate);
  }

  const { data, error } = await query;

  if (error) throw new Error(error.message);
  return (data as DbShiftLogRow[]).map(mapDbRowToUiRow);
}