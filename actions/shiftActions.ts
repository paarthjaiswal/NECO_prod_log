"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/utils/supabase/server";
import { getIsUnitHead } from "@/actions/authActions";
import { evaluateShiftLock } from "@/services/storageService";
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

function mapDbRowToUiRow(dbRow: DbShiftLogRow): MachineShiftRow {
  const totalWorking = Number(dbRow.total_working_minutes ?? 0);
  const noDisc = Number(dbRow.bd_no_disc ?? 0);
  const change = Number(dbRow.bd_change ?? 0);
  const power = Number(dbRow.bd_power ?? 0);
  const operator = Number(dbRow.bd_operator ?? 0);
  const totalBd = Number(
    dbRow.total_bd_minutes ?? noDisc + change + power + operator
  );

  return {
    id: dbRow.id,
    date: dbRow.log_date,
    shift: dbRow.shift as ShiftType,
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
  return {
    id:
      uiRow.id ||
      `${uiRow.date}_${uiRow.shift}_${uiRow.line}_${uiRow.machineId}`,
    log_date: uiRow.date,
    shift: uiRow.shift,
    line: uiRow.line,
    sr_no: Number(uiRow.srNo) || 0,
    machine_id: uiRow.machineId,
    machine_name: uiRow.machineName,
    operator_name: uiRow.operatorName?.trim() ?? "",
    item_id: uiRow.itemId?.trim() ?? "",
    item_name: uiRow.itemName?.trim() ?? "",
    operation: uiRow.operation?.trim() ?? "",
    cycle_time: Number(uiRow.cycleTime) || 0,
    total_working_minutes: Number(uiRow.totalWorkingMinutes) || 0,
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
    dailyWorkingMinutes: Number(dbLine.daily_working_minutes ?? 1350),
    isActive: Boolean(dbLine.is_active),
    sortOrder: Number(dbLine.sort_order ?? 0),
  };
}

function mapDbShiftToUi(dbShift: DbShiftRow): ShiftMaster {
  return {
    id: dbShift.id,
    shiftCode: dbShift.shift_code,
    displayName: dbShift.display_name as ShiftType,
    startTime: dbShift.start_time,
    endTime: dbShift.end_time,
    shiftWorkingMinutes: Number(dbShift.shift_working_minutes ?? 450),
    totalWorkingMinutesRef: Number(dbShift.total_working_minutes_ref ?? 1350),
    isActive: Boolean(dbShift.is_active),
    sortOrder: Number(dbShift.sort_order ?? 0),
  };
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
        totalWorkingMinutes: shiftWorkingMinutes || uiRow.totalWorkingMinutes,
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
      totalWorkingMinutes: shiftWorkingMinutes,
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
          autoSelectedShift: String(selShift) as ShiftType,
        };
      }
    }
  } catch {
    // RPC not available yet, fall back to Node server computation below
  }

  // Node server IST fallback
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(now);
  const getPart = (type: string) =>
    parts.find((p) => p.type === type)?.value || "";
  const year = getPart("year");
  const month = getPart("month");
  const day = getPart("day");
  const parsedHour = parseInt(getPart("hour"), 10);
  const hour = Number.isNaN(parsedHour) ? 0 : parsedHour % 24;
  const parsedMinute = parseInt(getPart("minute"), 10);
  const minute = Number.isNaN(parsedMinute) ? 0 : parsedMinute;
  const second = getPart("second");

  const todayStr = `${year}-${month}-${day}`;
  const serverNowIst = `${todayStr}T${String(hour).padStart(2, "0")}:${String(
    minute
  ).padStart(2, "0")}:${second}+05:30`;

  // Fetch active shifts to determine schedule
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

  const timeMinutes = hour * 60 + minute;

  // Calculate yesterday in IST for overnight shift C (00:00 - 05:59)
  const prevDateObj = new Date(
    Date.UTC(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10) - 1)
  );
  const yesterdayStr = prevDateObj.toISOString().slice(0, 10);

  if (shifts.length > 0) {
    // Match against shift records
    for (const s of shifts) {
      const [sh, sm] = (s.startTime || "00:00").split(":").map(Number);
      const [eh, em] = (s.endTime || "00:00").split(":").map(Number);
      const startMins = (sh || 0) * 60 + (sm || 0);
      const endMins = (eh || 0) * 60 + (em || 0);

      if (endMins > startMins) {
        // Normal daytime shift (e.g., 06:00 - 14:00 or 14:00 - 22:00)
        if (timeMinutes >= startMins && timeMinutes < endMins) {
          return {
            serverNowIst,
            activeDate: todayStr,
            autoSelectedShift: s.displayName,
          };
        }
      } else {
        // Overnight shift (e.g. 22:00 - 06:00)
        if (timeMinutes >= startMins) {
          // Started today, ends tomorrow morning
          return {
            serverNowIst,
            activeDate: todayStr,
            autoSelectedShift: s.displayName,
          };
        } else if (timeMinutes < endMins) {
          // Started yesterday night
          return {
            serverNowIst,
            activeDate: yesterdayStr,
            autoSelectedShift: s.displayName,
          };
        }
      }
    }
  }

  // Standard fallback timings if no custom shifts matched:
  // Shift A: 06:00 - 14:00
  // Shift B: 14:00 - 22:00
  // Shift C: 22:00 - 06:00 (overnight)
  if (timeMinutes >= 360 && timeMinutes < 840) {
    return {
      serverNowIst,
      activeDate: todayStr,
      autoSelectedShift: "Shift A (6AM-2PM)",
    };
  } else if (timeMinutes >= 840 && timeMinutes < 1320) {
    return {
      serverNowIst,
      activeDate: todayStr,
      autoSelectedShift: "Shift B (2PM-10PM)",
    };
  } else if (timeMinutes >= 1320) {
    return {
      serverNowIst,
      activeDate: todayStr,
      autoSelectedShift: "Shift C (10PM-6AM)",
    };
  } else {
    // 00:00 - 05:59 -> Shift C belonging to yesterday's date
    return {
      serverNowIst,
      activeDate: yesterdayStr,
      autoSelectedShift: "Shift C (10PM-6AM)",
    };
  }
}

/**
 * Enforces server-side shift edit window.
 * 1. If Unit Head is logged in, immediately allows edit.
 * 2. Attempts Supabase RPC 'check_shift_edit_window'.
 * 3. Falls back to evaluateShiftLock using server time and shifts master.
 * Throws Error if locked.
 */
async function assertShiftEditable(logDate: string, shift: string) {
  const isAdmin = await getIsUnitHead();
  if (isAdmin) {
    return;
  }

  const supabase = createAdminClient();

  let rpcLockError: string | null = null;
  let rpcHandled = false;

  try {
    const { data, error } = await supabase.rpc("check_shift_edit_window", {
      p_log_date: logDate,
      p_shift: shift,
      p_buffer_minutes: 30,
    });

    if (!error && data !== null && data !== undefined) {
      const rpcRow = Array.isArray(data) ? data[0] : data;
      if (typeof rpcRow === "boolean") {
        rpcHandled = true;
        if (!rpcRow) {
          rpcLockError = "Shift is locked — the editing window has closed.";
        }
      } else if (rpcRow && typeof rpcRow === "object") {
        const record = rpcRow as Record<string, unknown>;
        const isEditable = record.is_editable ?? record.isEditable;
        if (typeof isEditable === "boolean") {
          rpcHandled = true;
          if (!isEditable) {
            rpcLockError =
              typeof record.reason === "string" && record.reason
                ? record.reason
                : "Shift is locked — the editing window has closed.";
          }
        }
      }
    }
  } catch {
    // RPC not created or failed, proceed to evaluateShiftLock fallback
  }

  if (rpcLockError) {
    throw new Error(rpcLockError);
  }
  if (rpcHandled) {
    return;
  }

  // Fallback: evaluateShiftLock using server time context
  const timeContext = await getFactoryTimeContext();
  let shiftsMaster: ShiftMaster[] = [];
  try {
    const { data: dbShifts } = await supabase
      .from("shifts")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (dbShifts) {
      shiftsMaster = dbShifts.map(mapDbShiftToUi);
    }
  } catch {
    // ignore
  }

  const lockInfo = evaluateShiftLock(
    logDate,
    shift,
    shiftsMaster,
    timeContext.serverNowIst,
    false,
    30
  );

  if (!lockInfo.isEditable) {
    throw new Error(lockInfo.reason || "Shift is locked — the editing window has closed.");
  }
}

/**
 * Enforces Unit Head authorization for all Master Data modifications.
 */
async function assertUnitHead() {
  const isHead = await getIsUnitHead();
  if (!isHead) {
    throw new Error("Unauthorized: Only the Unit Head can modify Master Data.");
  }
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

  return {
    machines: (machinesRes.data as DbMachineRow[]).map(mapDbMachineToUi),
    operators: (operatorsRes.data as DbOperatorRow[]).map((op) => op.name),
    items: (itemsRes.data as DbItemRow[]).map(mapDbItemToUi),
    lines: linesRes.data
      ? (linesRes.data as DbProductionLineRow[]).map(mapDbLineToUi)
      : [],
    shifts: shiftsRes.data
      ? (shiftsRes.data as DbShiftRow[]).map(mapDbShiftToUi)
      : [],
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
      .or(`display_name.eq."${shift}",shift_code.eq."${shift}"`)
      .maybeSingle(),
  ]);

  if (machinesRes.error) throw new Error(machinesRes.error.message);
  if (logsRes.error) throw new Error(logsRes.error.message);
  if (shiftConfigRes.error) throw new Error(shiftConfigRes.error.message);

  const dbShiftMinutes = Number(shiftConfigRes.data?.shift_working_minutes ?? 0);

  return hydrateShiftSheetRows(
    machinesRes.data as DbMachineRow[],
    logsRes.data as DbShiftLogRow[],
    date,
    shift,
    line,
    dbShiftMinutes
  );
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
  const dbPayloads = rows.map(mapUiRowToDbRow);

  const { data, error } = await supabase
    .from("shift_logs")
    .upsert(dbPayloads, {
      onConflict: "log_date,shift,line,machine_id",
    })
    .select();

  if (error) throw new Error(error.message);

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
  await assertShiftEditable(row.date, row.shift);

  const supabase = createAdminClient();
  const dbPayload = mapUiRowToDbRow(row);

  const { data, error } = await supabase
    .from("shift_logs")
    .upsert(dbPayload, {
      onConflict: "log_date,shift,line,machine_id",
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

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
  machine: MachineMaster,
  sortOrder?: number
) {
  await assertUnitHead();
  const supabase = createAdminClient();
  const fallbackSortOrder = parseInt(machine.id.replace(/\D/g, ""), 10) || 999;

  const payload: Partial<DbMachineRow> = {
    id: machine.id,
    name: machine.name.trim(),
    code: machine.code.trim(),
    line: machine.line ?? "Line 1",
    type: machine.type ?? null,
    status: machine.status ?? "active",
    sort_order: typeof sortOrder === "number" ? sortOrder : fallbackSortOrder,
  };

  const { data, error } = await supabase
    .from("machines")
    .upsert(payload, { onConflict: "id" })
    .select()
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/");
  return mapDbMachineToUi(data as DbMachineRow);
}

export async function disableMachineMaster(machineId: string) {
  await assertUnitHead();
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("machines")
    .update({ status: "idle" })
    .eq("id", machineId);

  if (error) throw new Error(error.message);
  revalidatePath("/");
  return { success: true };
}

export async function upsertItemMaster(item: ItemMaster) {
  await assertUnitHead();
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("items")
    .upsert(
      {
        id: item.id,
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
  return mapDbItemToUi(data as DbItemRow);
}

export async function deleteItemMaster(itemId: string) {
  await assertUnitHead();
  const supabase = createAdminClient();
  const { error } = await supabase.from("items").delete().eq("id", itemId);

  if (error) throw new Error(error.message);
  revalidatePath("/");
  return { success: true };
}

export async function addOperatorMaster(operatorName: string) {
  await assertUnitHead();
  const supabase = createAdminClient();
  const cleanName = operatorName.trim();

  const { error } = await supabase
    .from("operators")
    .upsert({ name: cleanName, is_active: true }, { onConflict: "name" });

  if (error) throw new Error(error.message);
  revalidatePath("/");
  return { success: true, name: cleanName };
}

export async function removeOperatorMaster(operatorName: string) {
  await assertUnitHead();
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
  await assertUnitHead();
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
  await assertUnitHead();
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
  await assertUnitHead();
  const supabase = createAdminClient();
  const { error } = await supabase.from("production_lines").upsert(
    {
      id: line.id,
      name: line.name.trim(),
      description: line.description ?? "",
      daily_working_minutes: Number(line.dailyWorkingMinutes) || 1350,
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
  await assertUnitHead();
  const supabase = createAdminClient();
  const { error } = await supabase.from("shifts").upsert(
    {
      id: shift.id,
      shift_code: shift.shiftCode.trim(),
      display_name: shift.displayName.trim(),
      start_time: shift.startTime,
      end_time: shift.endTime,
      shift_working_minutes: Number(shift.shiftWorkingMinutes) || 450,
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
  await assertUnitHead();
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
  await assertUnitHead();
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
  daysBack: number = 30
): Promise<MachineShiftRow[]> {
  const supabase = createAdminClient();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);
  const cutoffStr = cutoffDate.toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("shift_logs")
    .select("*")
    .gte("log_date", cutoffStr)
    .order("log_date", { ascending: false })
    .order("sr_no", { ascending: true });

  if (error) throw new Error(error.message);
  return (data as DbShiftLogRow[]).map(mapDbRowToUiRow);
}