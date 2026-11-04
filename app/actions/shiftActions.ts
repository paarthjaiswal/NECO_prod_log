"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/utils/supabase/server";
import {
  MachineShiftRow,
  MachineMaster,
  ItemMaster,
  MasterDataState,
  ShiftType,
} from "@/app/types/index";

// ============================================================================
// DATABASE ROW INTERFACES (Matches your Supabase SQL Schema)
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
  std_output: number | null;
  actual_output: number | null;
  rework: number | null;
  bd_no_disc: number | null;
  bd_change: number | null;
  bd_power: number | null;
  bd_operator: number | null;
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
}

// ============================================================================
// STEP 2: INTERNAL DATA TRANSLATORS (SQL <-> UI MAPPERS)
// ============================================================================

function mapDbRowToUiRow(dbRow: DbShiftLogRow): MachineShiftRow {
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
    stdOutput: Number(dbRow.std_output ?? 0),
    actualOutput: Number(dbRow.actual_output ?? 0),
    rework: Number(dbRow.rework ?? 0),
    breakdown: {
      noDisc: Number(dbRow.bd_no_disc ?? 0),
      change: Number(dbRow.bd_change ?? 0),
      power: Number(dbRow.bd_power ?? 0),
      operator: Number(dbRow.bd_operator ?? 0),
    },
    remarks: dbRow.remarks ?? "",
    updatedAt: dbRow.updated_at ?? undefined,
  };
}

function mapUiRowToDbRow(uiRow: MachineShiftRow): DbShiftLogRow {
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

function hydrateShiftSheetRows(
  sortedLineMachines: DbMachineRow[],
  savedDbLogs: DbShiftLogRow[],
  date: string,
  shift: ShiftType,
  line: string
): MachineShiftRow[] {
  const savedLogMap = new Map<string, DbShiftLogRow>(
    savedDbLogs
      .filter((row) => row.machine_id !== null)
      .map((row) => [row.machine_id as string, row])
  );

  return sortedLineMachines.map((machine, index) => {
    const existingLog = savedLogMap.get(machine.id);
    if (existingLog) {
      return {
        ...mapDbRowToUiRow(existingLog),
        srNo: index + 1
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
      stdOutput: 0,
      actualOutput: 0,
      rework: 0,
      breakdown: {
        noDisc: 0,
        change: 0,
        power: 0,
        operator: 0,
      },
      remarks: "",
    };
  });
}

// ============================================================================
// STEP 3: THE 5 CORE SERVER ACTIONS (Replaces storageService.ts)
// ============================================================================

/**
 * ACTION 1: Fetch Master Data in Parallel
 * Fetches machines (ordered by sort_order), operators, and items simultaneously.
 */
export async function getMasterData(): Promise<MasterDataState> {
  const supabase = createAdminClient();

 const [machinesRes, operatorsRes, itemsRes] = await Promise.all([
    supabase
      .from("machines")
      .select("*")
      .order("sort_order", { ascending: true }),
    supabase
      .from("operators")
      .select("*")
      .eq("is_active", true) // <-- Add this so removed operators stay hidden
      .order("name", { ascending: true }),
    supabase.from("items").select("*").order("item_code", { ascending: true }),
  ]);

  if (machinesRes.error) throw new Error(machinesRes.error.message);
  if (operatorsRes.error) throw new Error(operatorsRes.error.message);
  if (itemsRes.error) throw new Error(itemsRes.error.message);

  return {
    machines: (machinesRes.data as DbMachineRow[]).map(mapDbMachineToUi),
    operators: (operatorsRes.data as DbOperatorRow[]).map((op) => op.name),
    items: (itemsRes.data as DbItemRow[]).map(mapDbItemToUi),
  };
}

/**
 * ACTION 2: Fetch Active Shift Rows (with Empty Shift Auto-Hydration)
 * Queries only the selected Date + Shift + Line and merges with active line machines.
 */
export async function getShiftSheetRows(
  date: string,
  shift: ShiftType,
  line: string
): Promise<MachineShiftRow[]> {
  const supabase = createAdminClient();

  const [machinesRes, logsRes] = await Promise.all([
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
  ]);

  if (machinesRes.error) throw new Error(machinesRes.error.message);
  if (logsRes.error) throw new Error(logsRes.error.message);

  return hydrateShiftSheetRows(
    machinesRes.data as DbMachineRow[],
    logsRes.data as DbShiftLogRow[],
    date,
    shift,
    line
  );
}

/**
 * ACTION 3: Batch Save Shift Sheet (DailyShiftSheet.tsx)
 * Runs a single bulk upsert for all machines on the active line.
 */
export async function saveShiftSheetRows(rows: MachineShiftRow[]) {
  if (!rows || rows.length === 0) return { success: true, count: 0 };

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
 * Upserts a single machine row without touching other machines on the line.
 */
export async function updateSingleMachineLog(row: MachineShiftRow) {
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

/**
 * ACTION 5: Master Data CRUD (MasterDataSettings.tsx)
 * Uses soft-disable (status = 'idle') on machines to protect historical foreign keys.
 */
export async function upsertMachineMaster(
  machine: MachineMaster,
  sortOrder?: number
) {
  const supabase = createAdminClient();

 // Extract numeric ID (e.g. 'm31' -> 31) so new machines go to the bottom, never row 0
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

  if (typeof sortOrder === "number") {
    payload.sort_order = sortOrder;
  }

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
  const supabase = createAdminClient();

  // Soft-delete: sets status to 'idle' instead of DELETE so shift_logs foreign keys never break
  const { error } = await supabase
    .from("machines")
    .update({ status: "idle" })
    .eq("id", machineId);

  if (error) throw new Error(error.message);
  revalidatePath("/");
  return { success: true };
}

export async function upsertItemMaster(item: ItemMaster) {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("items")
    .upsert(
      {
        id: item.id,
        item_code: item.itemCode.trim(),
        item_name: item.itemName.trim(),
        operation: item.operation.trim(),
        std_output: Number(item.stdOutput) || 0,
      },
      { onConflict: "id" }
    )
    .select()
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/");
  return mapDbItemToUi(data as DbItemRow);
}

export async function addOperatorMaster(operatorName: string) {
  const supabase = createAdminClient();
  const cleanName = operatorName.trim();

  const { error } = await supabase
    .from("operators")
    .upsert({ name: cleanName }, { onConflict: "name" });

  if (error) throw new Error(error.message);
  revalidatePath("/");
  return { success: true, name: cleanName };
}


export async function removeOperatorMaster(operatorName: string) {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("operators")
    .update({ is_active: false })
    .eq("name", operatorName.trim());

  if (error) throw new Error(error.message);
  revalidatePath("/");
  return { success: true };
}

export async function deleteItemMaster(itemId: string) {
  const supabase = createAdminClient();
  const { error } = await supabase.from("items").delete().eq("id", itemId);

  if (error) throw new Error(error.message);
  revalidatePath("/");
  return { success: true };
}

/**
 * ACTION 6: On-Demand Historical Logs for AnalyticsPreview.tsx
 * Only called when the user opens the 'analytics' tab (keeps shop-floor PC RAM near zero).
 */
export async function getAnalyticsLogs(daysBack: number = 30): Promise<MachineShiftRow[]> {
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