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
 * Looks up (machineId + itemId) in machine_item_cycle_times first.
 * Falls back to ItemMaster if no machine-specific override exists yet.
 */
export function resolveMachineItemTarget(
  machineId: string,
  itemId: string,
  items: ItemMaster[],
  cycleTimes: MachineItemCycleTime[] = []
) {
  const baseItem = items.find((it) => it.id === itemId);
  if (!baseItem) {
    return { itemName: "", operation: "", cycleTime: 0, stdOutput: 0 };
  }

  // Check if this specific Machine + Item has a custom cycle time configured
  const specificMatch = cycleTimes.find(
    (ct) => ct.machineId === machineId && ct.itemId === itemId
  );

  return {
    itemName: baseItem.itemName,
    operation: specificMatch?.operation || baseItem.operation,
    cycleTime: specificMatch ? Number(specificMatch.cycleTime) : 0,
    stdOutput:
      specificMatch && specificMatch.stdOutput > 0
        ? Number(specificMatch.stdOutput)
        : Number(baseItem.stdOutput),
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