import {
  ItemMaster,
  BreakdownMinutes,
  MachineShiftRow,
  MachineItemCycleTime,
} from "@/types";

/**
 * Sums the 4 downtime categories (NO/DISC, CHANGE, POWER, OPERATOR).
 * Accepts either a BreakdownMinutes object or a full MachineShiftRow.
 */
export function calculateTotalBreakdown(
  input: BreakdownMinutes | MachineShiftRow | null | undefined
): number {
  if (!input) return 0;
  const b = "breakdown" in input ? input.breakdown : input;
  if (!b) return 0;

  return (
    (Number(b.noDisc) || 0) +
    (Number(b.change) || 0) +
    (Number(b.power) || 0) +
    (Number(b.operator) || 0)
  );
}

/**
 * Calculates production efficiency percentage: (actualOutput / stdOutput) * 100.
 * Accepts either (actualOutput, stdOutput) numbers or a full MachineShiftRow.
 */
export function calculateEfficiency(
  actualOrRow: number | MachineShiftRow,
  stdOutput?: number
): number {
  const actual =
    typeof actualOrRow === "object" && actualOrRow !== null
      ? Number(actualOrRow.actualOutput) || 0
      : Number(actualOrRow) || 0;

  const std =
    typeof actualOrRow === "object" && actualOrRow !== null
      ? Number(actualOrRow.stdOutput) || 0
      : Number(stdOutput) || 0;

  if (std <= 0) return 0;
  return Math.round((actual / std) * 100);
}

/**
 * Extracts all available operations for a given Item.
 * Supports comma/slash-separated operations (e.g., "OP-10, OP-20"),
 * multiple rows with the same itemCode/itemName, and operations saved in cycleTimes.
 */
export function getOperationsForItem(
  itemId: string,
  items: ItemMaster[],
  cycleTimes: MachineItemCycleTime[] = [],
  machineId?: string
): string[] {
  const selectedItem = items.find((i) => i.id === itemId);
  if (!selectedItem) return [];

  const matchingItems = items.filter(
    (i) =>
      i.id === selectedItem.id ||
      (i.itemCode && i.itemCode === selectedItem.itemCode) ||
      i.itemName.toLowerCase() === selectedItem.itemName.toLowerCase()
  );

  const opsSet = new Set<string>();

  // 1. Collect operations from ItemMaster definitions
  matchingItems.forEach((item) => {
    item.operation
      .split(/[,/]/)
      .map((op) => op.trim())
      .filter(Boolean)
      .forEach((op) => opsSet.add(op));
  });

  // 2. Also include any custom operations configured in machine_item_cycle_times
  cycleTimes
    .filter(
      (ct) =>
        ct.itemId === itemId && (!machineId || ct.machineId === machineId)
    )
    .forEach((ct) => {
      if (ct.operation?.trim()) {
        opsSet.add(ct.operation.trim());
      }
    });

  return Array.from(opsSet);
}

/**
 * Calculates how many items can be made in the selected shift's working minutes:
 * Example: Shift = 100 mins, Cycle Time = 10 -> Std Output = 100 / 10 = 10 items.
 */
export function calculateDynamicStdOutput(
  cycleTime: number,
  shiftWorkingMinutes: number
): number {
  const ct = Number(cycleTime) || 0;
  const shiftMins = Number(shiftWorkingMinutes) || 0;
  if (ct <= 0 || shiftMins <= 0) return 0;

  return Math.floor(shiftMins / ct);
}

/**
 * Computes the exact time-accounting balance for a machine row in a shift.
 * Example: Shift = 100m, Cycle Time = 10m, Actual = 5 ->
 *   Production Time = 50m, Required Breakdown = 50m.
 *   If supervisor logged 20m, unaccountedMinutes = 30m (needs 30m more in breakdown).
 */
export function calculateShiftTimeBalance(
  row: Pick<MachineShiftRow, "cycleTime" | "actualOutput" | "breakdown" | "totalWorkingMinutes">,
  shiftWorkingMinutes?: number
) {
  const shiftMins =
    Number(shiftWorkingMinutes) || Number(row.totalWorkingMinutes) || 0;
  const ct = Number(row.cycleTime) || 0;
  const actual = Number(row.actualOutput) || 0;
  const loggedBreakdown = calculateTotalBreakdown(row.breakdown);

  if (ct <= 0 || shiftMins <= 0) {
    return {
      shiftMinutes: shiftMins,
      productionMinutes: 0,
      requiredBreakdownMinutes: 0,
      loggedBreakdownMinutes: loggedBreakdown,
      unaccountedMinutes: 0,
      totalAccountedMinutes: loggedBreakdown,
      isBalanced: true,
    };
  }

  const productionMinutes = Number((actual * ct).toFixed(2));
  const requiredBreakdownMinutes = Math.max(
    0,
    Number((shiftMins - productionMinutes).toFixed(2))
  );
  const unaccountedMinutes = Number(
    (requiredBreakdownMinutes - loggedBreakdown).toFixed(2)
  );
  const totalAccountedMinutes = Number(
    (productionMinutes + loggedBreakdown).toFixed(2)
  );

  return {
    shiftMinutes: shiftMins,
    productionMinutes,
    requiredBreakdownMinutes,
    loggedBreakdownMinutes: loggedBreakdown,
    unaccountedMinutes, // > 0 means supervisor still needs to log this many mins in Breakdown
    totalAccountedMinutes,
    isBalanced: Math.abs(unaccountedMinutes) < 0.01,
  };
}

/**
 * Looks up (machineId + itemId + operation) in machine_item_cycle_times.
 * Auto-populates operation, cycleTime, and single-shift stdOutput.
 */
export function resolveMachineItemTarget(
  machineId: string,
  itemId: string,
  items: ItemMaster[],
  cycleTimes: MachineItemCycleTime[] = [],
  explicitOperation?: string,
  shiftWorkingMinutes: number = 0
) {
  const baseItem = items.find((it) => it.id === itemId);
  if (!baseItem) {
    return {
      itemName: "",
      operation: "",
      availableOperations: [] as string[],
      cycleTime: 0,
      stdOutput: 0,
    };
  }

  const availableOperations = getOperationsForItem(
    itemId,
    items,
    cycleTimes,
    machineId
  );

  const chosenOperation =
    explicitOperation !== undefined
      ? explicitOperation
      : availableOperations[0] || baseItem.operation || "";

  // 1. Exact triple match: (machineId + itemId + chosenOperation)
  let matchedCt = cycleTimes.find(
    (ct) =>
      ct.machineId === machineId &&
      ct.itemId === itemId &&
      ct.operation.trim().toLowerCase() === chosenOperation.trim().toLowerCase()
  );

  // 2. Fallback: match by (machineId + itemId) if only one operation exists
  if (!matchedCt && !explicitOperation) {
    matchedCt = cycleTimes.find(
      (ct) => ct.machineId === machineId && ct.itemId === itemId
    );
  }

  const resolvedCycleTime = matchedCt ? Number(matchedCt.cycleTime) || 0 : 0;
  const resolvedOperation = matchedCt?.operation || chosenOperation;

  const calculatedStd = calculateDynamicStdOutput(
    resolvedCycleTime,
    shiftWorkingMinutes
  );

  return {
    itemName: baseItem.itemName,
    operation: resolvedOperation,
    availableOperations,
    cycleTime: resolvedCycleTime,
    stdOutput: calculatedStd,
  };
}

/**
 * Calculates live Downtime % against the shift's working minutes from the DB.
 */
export function calculateDowntimePct(
  minutes: number,
  shiftWorkingMinutes: number
): number {
  const denom = Number(shiftWorkingMinutes) || 0;
  if (denom <= 0) return 0;
  return Number(((Number(minutes || 0) / denom) * 100).toFixed(2));
}