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
 * Calculates Standard Output dynamically from Cycle Time and net shift operating minutes.
 * Assumes Cycle Time is in seconds (e.g. 54 sec) and default shift is 450 mins (1350 / 3).
 */
export function calculateDynamicStdOutput(
  cycleTimeSeconds: number,
  shiftWorkingMinutes: number = 450,
  totalBreakdownMinutes: number = 0
): number {
  const ct = Number(cycleTimeSeconds) || 0;
  if (ct <= 0) return 0;

  const netMinutes = Math.max(
    0,
    (Number(shiftWorkingMinutes) || 450) - (Number(totalBreakdownMinutes) || 0)
  );
  return Math.floor((netMinutes * 60) / ct);
}

/**
 * Looks up (machineId + itemId + operation) in machine_item_cycle_times.
 * Auto-populates operation, cycleTime, and calculated stdOutput.
 */
export function resolveMachineItemTarget(
  machineId: string,
  itemId: string,
  items: ItemMaster[],
  cycleTimes: MachineItemCycleTime[] = [],
  explicitOperation?: string,
  shiftWorkingMinutes: number = 450,
  totalBreakdownMinutes: number = 0
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

  // Pick the explicitly chosen operation, or default to the first available operation
  const chosenOperation =
    explicitOperation !== undefined
      ? explicitOperation
      : availableOperations[0] || baseItem.operation || "";

  // 1. Try exact triple match: (machineId + itemId + chosenOperation)
  let matchedCt = cycleTimes.find(
    (ct) =>
      ct.machineId === machineId &&
      ct.itemId === itemId &&
      ct.operation.trim().toLowerCase() === chosenOperation.trim().toLowerCase()
  );

  // 2. Fallback: if only one cycle time record exists for (machineId + itemId), use it
  if (!matchedCt && !explicitOperation) {
    matchedCt = cycleTimes.find(
      (ct) => ct.machineId === machineId && ct.itemId === itemId
    );
  }

  const resolvedCycleTime = matchedCt ? Number(matchedCt.cycleTime) || 0 : 0;
  const resolvedOperation = matchedCt?.operation || chosenOperation;

  // Auto-calculate stdOutput from cycleTime if cycleTime > 0
  const calculatedStd =
    resolvedCycleTime > 0
      ? calculateDynamicStdOutput(
          resolvedCycleTime,
          shiftWorkingMinutes,
          totalBreakdownMinutes
        )
      : Number(baseItem.stdOutput) || 0;

  return {
    itemName: baseItem.itemName,
    operation: resolvedOperation,
    availableOperations,
    cycleTime: resolvedCycleTime,
    stdOutput: calculatedStd,
  };
}

/**
 * Calculates live Downtime % against the row's totalWorkingMinutes (default 1350)
 * so the UI matches PostgreSQL's GENERATED ALWAYS columns in real time.
 */
export function calculateDowntimePct(
  minutes: number,
  totalWorkingMinutes: number = 1350
): number {
  const denom = totalWorkingMinutes > 0 ? totalWorkingMinutes : 1350;
  return Number(((Number(minutes || 0) / denom) * 100).toFixed(2));
}