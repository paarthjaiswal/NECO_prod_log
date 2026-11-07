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
  machineId?: string,
  machineName?: string
): string[] {
  const cleanItemId = (itemId || "").trim().toLowerCase();
  const selectedItem = items.find((i) => {
    if (!i) return false;
    return (
      (i.id && i.id.trim().toLowerCase() === cleanItemId) ||
      (i.itemCode && i.itemCode.trim().toLowerCase() === cleanItemId) ||
      (i.itemName && i.itemName.trim().toLowerCase() === cleanItemId)
    );
  });
  if (!selectedItem) return [];

  const itemKeys = new Set<string>();
  if (selectedItem.id) itemKeys.add(selectedItem.id.trim().toLowerCase());
  if (selectedItem.itemCode) itemKeys.add(selectedItem.itemCode.trim().toLowerCase());
  if (selectedItem.itemName) itemKeys.add(selectedItem.itemName.trim().toLowerCase());

  const machineKeys = new Set<string>();
  if (machineId && machineId.trim()) machineKeys.add(machineId.trim().toLowerCase());
  if (machineName && machineName.trim()) machineKeys.add(machineName.trim().toLowerCase());

  const matchingItems = items.filter(
    (i) =>
      i.id === selectedItem.id ||
      (i.itemCode && i.itemCode === selectedItem.itemCode) ||
      i.itemName.toLowerCase() === selectedItem.itemName.toLowerCase()
  );

  const opsSet = new Set<string>();

  // 1. Collect operations from ItemMaster definitions
  matchingItems.forEach((item) => {
    (item.operation || "")
      .split(/[,/]/)
      .map((op) => op.trim())
      .filter(Boolean)
      .forEach((op) => opsSet.add(op));
  });

  // 2. Also include any custom operations configured in machine_item_cycle_times
  cycleTimes
    .filter((ct) => {
      const ctItem = (ct.itemId || "").trim().toLowerCase();
      if (!itemKeys.has(ctItem)) return false;
      if (machineKeys.size > 0) {
        const ctMach = (ct.machineId || "").trim().toLowerCase();
        return machineKeys.has(ctMach);
      }
      return true;
    })
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

export interface ShiftTimeBalance {
  shiftMinutes: number;
  productionMinutes: number;
  requiredBreakdownMinutes: number;
  loggedBreakdownMinutes: number;
  unaccountedMinutes: number; // positive = missing breakdown mins; negative = exceeds shift
  totalAccountedMinutes: number;
  isBalanced: boolean;
  isOver: boolean;
  isUnder: boolean;
  isProductionExceeded: boolean;
  missingCycleTime: boolean;
  errorMessage?: string;
}

/**
 * Computes the exact time-accounting balance for a machine row in a shift.
 * Enforces: Total Productive Time (actualOutput * cycleTime) + Total Breakdown Time = Shift Timing.
 * Total time must not exceed shift timing—it must be exactly equal.
 */
export function calculateShiftTimeBalance(
  row: Pick<
    MachineShiftRow,
    "cycleTime" | "actualOutput" | "breakdown" | "totalWorkingMinutes"
  > & { itemId?: string; operatorName?: string },
  shiftWorkingMinutes?: number
): ShiftTimeBalance {
  const shiftMins =
    Number(shiftWorkingMinutes) || Number(row.totalWorkingMinutes) || 0;
  const ct = Number(row.cycleTime) || 0;
  const actual = Number(row.actualOutput) || 0;
  const loggedBreakdown = calculateTotalBreakdown(row.breakdown);

  // If machine row is completely idle / untouched
  const isUntouched =
    !row.itemId &&
    !row.operatorName &&
    actual === 0 &&
    loggedBreakdown === 0 &&
    ct === 0;

  if (isUntouched || shiftMins <= 0) {
    return {
      shiftMinutes: shiftMins,
      productionMinutes: 0,
      requiredBreakdownMinutes: 0,
      loggedBreakdownMinutes: 0,
      unaccountedMinutes: 0,
      totalAccountedMinutes: 0,
      isBalanced: true,
      isOver: false,
      isUnder: false,
      isProductionExceeded: false,
      missingCycleTime: false,
      errorMessage: undefined,
    };
  }

  // If actual output is entered but cycle time is 0 / not configured
  if (actual > 0 && ct <= 0) {
    const diff = Number((shiftMins - loggedBreakdown).toFixed(2));
    return {
      shiftMinutes: shiftMins,
      productionMinutes: 0,
      requiredBreakdownMinutes: shiftMins,
      loggedBreakdownMinutes: loggedBreakdown,
      unaccountedMinutes: diff,
      totalAccountedMinutes: loggedBreakdown,
      isBalanced: false,
      isOver: loggedBreakdown > shiftMins,
      isUnder: true,
      isProductionExceeded: false,
      missingCycleTime: true,
      errorMessage: `Actual output (${actual} pcs) entered, but cycle time is 0. Please select an Item with a cycle time or enter cycle time.`,
    };
  }

  const productionMinutes = Number((actual * ct).toFixed(2));
  const totalAccountedMinutes = Number(
    (productionMinutes + loggedBreakdown).toFixed(2)
  );
  const diff = Number((shiftMins - totalAccountedMinutes).toFixed(2));
  const isBalanced = Math.abs(diff) < 0.01;
  const isOver = diff < -0.01;
  const isUnder = diff > 0.01;
  const isProductionExceeded = productionMinutes > shiftMins + 0.01;

  const requiredBreakdownMinutes = Math.max(
    0,
    Number((shiftMins - productionMinutes).toFixed(2))
  );

  let errorMessage: string | undefined = undefined;
  if (isProductionExceeded) {
    errorMessage = `Actual output time (${productionMinutes}m = ${actual} pcs × ${ct}m) exceeds shift duration (${shiftMins}m). Productive time alone is greater than shift timing.`;
  } else if (isOver) {
    errorMessage = `Total time (${totalAccountedMinutes}m = ${productionMinutes}m prod + ${loggedBreakdown}m BD) exceeds shift duration (${shiftMins}m) by ${Math.abs(diff)}m. Total time must not exceed shift timing.`;
  } else if (isUnder) {
    errorMessage = `Total time (${totalAccountedMinutes}m = ${productionMinutes}m prod + ${loggedBreakdown}m BD) is ${diff}m short of shift duration (${shiftMins}m). Log ${diff}m in breakdown to balance.`;
  }

  return {
    shiftMinutes: shiftMins,
    productionMinutes,
    requiredBreakdownMinutes,
    loggedBreakdownMinutes: loggedBreakdown,
    unaccountedMinutes: diff,
    totalAccountedMinutes,
    isBalanced,
    isOver,
    isUnder,
    isProductionExceeded,
    missingCycleTime: false,
    errorMessage,
  };
}

/**
 * Flexibly looks up a cycle time entry matching machine, item, and operation.
 * Supports:
 * - Machine matching by ID or Name (trimmed, case-insensitive)
 * - Item matching by ID, Code, or Name (trimmed, case-insensitive)
 * - Operation matching:
 *     1. Exact match (trimmed, case-insensitive)
 *     2. Normalized match (e.g. "op-10" === "op 10" === "op10")
 *     3. Substring/Prefix match (e.g. "OP-10" in "OP-10 Rough Turning" or vice versa)
 *     4. OP code extraction (e.g. "OP-10", "OP 20")
 *     5. Single-operation fallback: if a machine + item only has 1 cycle time configured, return it!
 */
export function findMatchingCycleTime(
  cycleTimes: MachineItemCycleTime[] = [],
  machineIdentifier: string,
  itemIdentifier: string,
  items: ItemMaster[] = [],
  operationName?: string,
  machineName?: string
): MachineItemCycleTime | undefined {
  if (!cycleTimes || cycleTimes.length === 0) return undefined;

  const cleanItemId = (itemIdentifier || "").trim().toLowerCase();
  const item = items.find((it) => {
    if (!it) return false;
    return (
      (it.id && it.id.trim().toLowerCase() === cleanItemId) ||
      (it.itemCode && it.itemCode.trim().toLowerCase() === cleanItemId) ||
      (it.itemName && it.itemName.trim().toLowerCase() === cleanItemId)
    );
  });

  // All acceptable keys for this item
  const itemKeys = new Set<string>();
  if (cleanItemId) itemKeys.add(cleanItemId);
  if (item) {
    if (item.id) itemKeys.add(item.id.trim().toLowerCase());
    if (item.itemCode) itemKeys.add(item.itemCode.trim().toLowerCase());
    if (item.itemName) itemKeys.add(item.itemName.trim().toLowerCase());
  }

  // All acceptable keys for this machine
  const cleanMachId = (machineIdentifier || "").trim().toLowerCase();
  const cleanMachName = (machineName || "").trim().toLowerCase();
  const machineKeys = new Set<string>();
  if (cleanMachId) machineKeys.add(cleanMachId);
  if (cleanMachName) machineKeys.add(cleanMachName);

  // 1. Filter cycleTimes for this Machine and Item
  const machineItemCts = cycleTimes.filter((ct) => {
    const ctMach = (ct.machineId || "").trim().toLowerCase();
    const machMatch = machineKeys.size === 0 || machineKeys.has(ctMach);
    if (!machMatch) return false;

    const ctItem = (ct.itemId || "").trim().toLowerCase();
    return itemKeys.has(ctItem);
  });

  if (machineItemCts.length === 0) {
    // If not found by machine + item, check if there's an item-wide cycle time configured
    const itemOnlyCts = cycleTimes.filter((ct) => {
      const ctItem = (ct.itemId || "").trim().toLowerCase();
      return itemKeys.has(ctItem);
    });

    if (itemOnlyCts.length === 1 && (!operationName || !operationName.trim())) {
      return itemOnlyCts[0];
    }
    return undefined;
  }

  // If no operation specified, return the first matching cycle time for this machine+item
  if (!operationName || !operationName.trim()) {
    return machineItemCts[0];
  }

  const cleanOp = operationName.trim().toLowerCase();
  const normOp = cleanOp.replace(/[^a-z0-9]/g, "");

  // 1. Exact operation match (case-insensitive, trimmed)
  let match = machineItemCts.find(
    (ct) => (ct.operation || "").trim().toLowerCase() === cleanOp
  );
  if (match) return match;

  // 2. Normalized match (ignoring spaces, dashes, punctuation: e.g. "op-10" === "op 10" === "op10")
  match = machineItemCts.find(
    (ct) =>
      (ct.operation || "").toLowerCase().replace(/[^a-z0-9]/g, "") === normOp
  );
  if (match) return match;

  // 3. Substring / Prefix match (e.g. "OP-10" matches "OP-10 Rough Turning" or vice versa)
  match = machineItemCts.find((ct) => {
    const ctOp = (ct.operation || "").trim().toLowerCase();
    return (
      cleanOp.startsWith(ctOp) ||
      ctOp.startsWith(cleanOp) ||
      cleanOp.includes(ctOp) ||
      ctOp.includes(cleanOp)
    );
  });
  if (match) return match;

  // 4. Operation Code extraction (e.g. "OP-10", "OP 20")
  const opCodeRegex = /op[-_\s]?\d+/i;
  const targetCode = cleanOp.match(opCodeRegex)?.[0]?.replace(/[^a-z0-9]/g, "");
  if (targetCode) {
    match = machineItemCts.find((ct) => {
      const ctCode = (ct.operation || "")
        .match(opCodeRegex)?.[0]
        ?.replace(/[^a-z0-9]/g, "");
      return ctCode === targetCode;
    });
    if (match) return match;
  }

  // 5. Fallback: if only 1 cycle time is configured for this machine and item, use it
  if (machineItemCts.length === 1) {
    return machineItemCts[0];
  }

  return undefined;
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
  shiftWorkingMinutes: number = 0,
  machineName?: string
) {
  const cleanItemId = (itemId || "").trim().toLowerCase();
  const baseItem = items.find((it) => {
    if (!it) return false;
    return (
      (it.id && it.id.trim().toLowerCase() === cleanItemId) ||
      (it.itemCode && it.itemCode.trim().toLowerCase() === cleanItemId) ||
      (it.itemName && it.itemName.trim().toLowerCase() === cleanItemId)
    );
  });

  if (!baseItem) {
    return {
      itemName: "",
      operation: explicitOperation || "",
      availableOperations: [] as string[],
      cycleTime: 0,
      stdOutput: 0,
    };
  }

  const availableOperations = getOperationsForItem(
    baseItem.id,
    items,
    cycleTimes,
    machineId,
    machineName
  );

  // Find matching stored cycle time entry
  const matchedCt = findMatchingCycleTime(
    cycleTimes,
    machineId,
    baseItem.id,
    items,
    explicitOperation,
    machineName
  );

  const resolvedCycleTime = matchedCt ? Number(matchedCt.cycleTime) || 0 : 0;
  const resolvedOperation =
    explicitOperation !== undefined
      ? explicitOperation
      : matchedCt?.operation || availableOperations[0] || baseItem.operation || "";

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