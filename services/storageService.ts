import {
  ItemMaster,
  BreakdownMinutes,
  MachineShiftRow,
  MachineItemCycleTime,
  ShiftMaster,
  ShiftLockInfo,
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

  const total =
    (Number(b.noDisc) || 0) +
    (Number(b.change) || 0) +
    (Number(b.power) || 0) +
    (Number(b.operator) || 0) +
    (Number(b.machineBreakdown) || 0) +
    (Number(b.fixProgSettings) || 0) +
    (Number(b.miscellaneous) || 0);

  return Number(total.toFixed(2));
}

/**
 * Single source-of-truth gatekeeper for empty/idle machine rows.
 * Returns true when a row has 0 actual output, 0 rework, 0 breakdown minutes, and no remarks.
 * Idle or blank rows must NEVER be submitted to public.shift_logs.
 */
export function isShiftRowEmpty(row: MachineShiftRow | null | undefined): boolean {
  if (!row) return true;
  const totalBd = calculateTotalBreakdown(row.breakdown);
  return (
    (Number(row.actualOutput) || 0) <= 0 &&
    (Number(row.rework) || 0) <= 0 &&
    totalBd <= 0 &&
    !(row.remarks || "").trim()
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
 * Builds a single canonical key for an item from its code and name.
 * Returns (itemCode || "").trim().toLowerCase() || (itemName || "").trim().toLowerCase().
 * Collapses multi-row items sharing the same code/name into ONE shift production entry.
 */
export function buildCanonicalItemKey(itemCode?: string | null, itemName?: string | null): string {
  return (itemCode || "").trim().toLowerCase() || (itemName || "").trim().toLowerCase();
}

/**
 * Deduplicates ItemMaster array by normalized itemName and/or itemCode
 * so each unique component/part appears only once in dropdown menus.
 */
export function getUniqueItems(items: ItemMaster[]): ItemMaster[] {
  if (!items || items.length === 0) return [];
  const seen = new Set<string>();
  const unique: ItemMaster[] = [];

  for (const item of items) {
    if (!item) continue;
    const nameKey = (item.itemName || "").trim().toLowerCase();
    const codeKey = (item.itemCode || "").trim().toLowerCase();
    const key = codeKey ? `${codeKey}:::${nameKey}` : nameKey;
    if (!key) continue;

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }

  return unique;
}

/**
 * Finds all sibling IDs in `items` that share the same normalized itemName or itemCode as `itemId`.
 */
export function getSiblingItemIds(
  itemId: string,
  items: ItemMaster[]
): string[] {
  if (!itemId || !itemId.trim() || !items || items.length === 0) return [];
  const cleanId = itemId.trim().toLowerCase();
  if (!cleanId) return [];

  const baseItem = items.find(
    (it) => {
      if (!it) return false;
      const itId = (it.id || "").trim().toLowerCase();
      const itCode = (it.itemCode || "").trim().toLowerCase();
      const itName = (it.itemName || "").trim().toLowerCase();
      return (
        (itId.length > 0 && itId === cleanId) ||
        (itCode.length > 0 && itCode === cleanId) ||
        (itName.length > 0 && itName === cleanId)
      );
    }
  );

  if (!baseItem) return [itemId.trim()];

  const baseName = (baseItem.itemName || "").trim().toLowerCase();
  const baseCode = (baseItem.itemCode || "").trim().toLowerCase();

  const siblingIds = new Set<string>();
  if (baseItem.id && baseItem.id.trim()) siblingIds.add(baseItem.id.trim());

  for (const it of items) {
    if (!it) continue;
    const itName = (it.itemName || "").trim().toLowerCase();
    const itCode = (it.itemCode || "").trim().toLowerCase();

    const matchesName = Boolean(baseName.length > 0 && itName.length > 0 && itName === baseName);
    const matchesCode = Boolean(baseCode.length > 0 && itCode.length > 0 && itCode === baseCode);

    if (matchesName || matchesCode) {
      if (it.id && it.id.trim()) siblingIds.add(it.id.trim());
    }
  }

  return Array.from(siblingIds);
}

/**
 * Given any itemId (or sibling itemId), returns the canonical ID from uniqueItems.
 */
export function getCanonicalItemId(
  itemId: string,
  items: ItemMaster[]
): string {
  if (!itemId || !itemId.trim() || !items || items.length === 0) return itemId;
  const cleanId = itemId.trim().toLowerCase();
  if (!cleanId) return "";
  const uniqueList = getUniqueItems(items);
  const foundInUnique = uniqueList.find(
    (it) => it.id && it.id.trim().toLowerCase() === cleanId
  );
  if (foundInUnique) return foundInUnique.id;

  const siblingIds = getSiblingItemIds(itemId, items);
  const siblingSet = new Set(siblingIds.map((s) => s.toLowerCase()));
  const canonical = uniqueList.find(
    (it) => it.id && siblingSet.has(it.id.trim().toLowerCase())
  );
  return canonical?.id || itemId;
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
  if (!itemId || !itemId.trim()) return [];
  const siblingIds = getSiblingItemIds(itemId, items);
  const siblingIdSet = new Set(siblingIds.map((id) => id.toLowerCase()));

  const cleanItemId = itemId.trim().toLowerCase();
  if (!cleanItemId) return [];
  const selectedItem = items.find((i) => {
    if (!i) return false;
    const iId = (i.id || "").trim().toLowerCase();
    const iCode = (i.itemCode || "").trim().toLowerCase();
    const iName = (i.itemName || "").trim().toLowerCase();
    return (
      (iId.length > 0 && siblingIdSet.has(iId)) ||
      (iCode.length > 0 && iCode === cleanItemId) ||
      (iName.length > 0 && iName === cleanItemId)
    );
  });
  if (!selectedItem && siblingIds.length === 0) return [];

  const itemKeys = new Set<string>(siblingIdSet);
  if (cleanItemId) itemKeys.add(cleanItemId);

  const matchingItems = items.filter((i) => {
    if (!i) return false;
    if (i.id && siblingIdSet.has(i.id.trim().toLowerCase())) return true;
    if (selectedItem) {
      if (
        i.itemCode &&
        selectedItem.itemCode &&
        i.itemCode.trim().toLowerCase() === selectedItem.itemCode.trim().toLowerCase()
      )
        return true;
      if (
        i.itemName &&
        selectedItem.itemName &&
        i.itemName.trim().toLowerCase() === selectedItem.itemName.trim().toLowerCase()
      )
        return true;
    }
    return false;
  });

  matchingItems.forEach((it) => {
    if (it.id) itemKeys.add(it.id.trim().toLowerCase());
    if (it.itemCode) itemKeys.add(it.itemCode.trim().toLowerCase());
    if (it.itemName) itemKeys.add(it.itemName.trim().toLowerCase());
  });

  const machineKeys = new Set<string>();
  if (machineId && machineId.trim()) machineKeys.add(machineId.trim().toLowerCase());
  if (machineName && machineName.trim()) machineKeys.add(machineName.trim().toLowerCase());

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
  isFullTargetBalanced?: boolean;
  cycleRemainderMinutes?: number;
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
  > & { itemId?: string; operatorName?: string; stdOutput?: number },
  shiftWorkingMinutes?: number
): ShiftTimeBalance {
  const shiftMins =
    Number(shiftWorkingMinutes) || Number(row.totalWorkingMinutes) || 0;
  const ct = Number(row.cycleTime) || 0;
  const actual = Number(row.actualOutput) || 0;
  const std = Number(row.stdOutput) || 0;
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
      isFullTargetBalanced: false,
      cycleRemainderMinutes: 0,
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
      isFullTargetBalanced: false,
      cycleRemainderMinutes: 0,
      errorMessage: `Actual output (${actual} pcs) entered, but cycle time is 0. Please select an Item with a cycle time or enter cycle time.`,
    };
  }

  const productionMinutes = Number((actual * ct).toFixed(2));
  const totalAccountedMinutes = Number(
    (productionMinutes + loggedBreakdown).toFixed(2)
  );
  const diff = Number((shiftMins - totalAccountedMinutes).toFixed(2));
  let isBalanced = Math.abs(diff) < 0.01;
  const isOver = diff < -0.01;
  let isUnder = diff > 0.01;
  const isProductionExceeded = productionMinutes > shiftMins + 0.01;

  let requiredBreakdownMinutes = Math.max(
    0,
    Number((shiftMins - productionMinutes).toFixed(2))
  );
  let unaccountedMinutes = diff;

  let isFullTargetBalanced = false;
  let cycleRemainderMinutes = 0;

  if (
    !isProductionExceeded &&
    !isOver &&
    std > 0 &&
    ct > 0 &&
    actual >= std &&
    totalAccountedMinutes <= shiftMins + 0.01
  ) {
    cycleRemainderMinutes = Math.max(0, Number((shiftMins - totalAccountedMinutes).toFixed(2)));
    isFullTargetBalanced = true;
    requiredBreakdownMinutes = 0;
    unaccountedMinutes = 0;
    isBalanced = true;
    isUnder = false;
  }

  let errorMessage: string | undefined = undefined;
  if (isProductionExceeded) {
    errorMessage = `Actual output time (${productionMinutes}m = ${actual} pcs × ${ct}m) exceeds shift duration (${shiftMins}m). Productive time alone is greater than shift timing.`;
  } else if (isOver) {
    errorMessage = `Total time (${totalAccountedMinutes}m = ${productionMinutes}m prod + ${loggedBreakdown}m BD) exceeds shift duration (${shiftMins}m) by ${Math.abs(diff)}m. Total time must not exceed shift timing.`;
  } else if (isUnder && !isFullTargetBalanced) {
    errorMessage = `Total time (${totalAccountedMinutes}m = ${productionMinutes}m prod + ${loggedBreakdown}m BD) is ${diff}m short of shift duration (${shiftMins}m). Log ${diff}m in breakdown to balance.`;
  }

  return {
    shiftMinutes: shiftMins,
    productionMinutes,
    requiredBreakdownMinutes,
    loggedBreakdownMinutes: loggedBreakdown,
    unaccountedMinutes,
    totalAccountedMinutes,
    isBalanced,
    isOver,
    isUnder,
    isProductionExceeded,
    missingCycleTime: false,
    isFullTargetBalanced,
    cycleRemainderMinutes,
    errorMessage,
  };
}

export interface MachineGroupTimeBalance extends ShiftTimeBalance {
  machineId: string;
  runCount: number;
  rowProductionMinutes: Record<string, number>;
  rowBreakdownMinutes: Record<string, number>;
  rowBreakdownSummary?: Record<
    string,
    {
      prodMins: number;
      bdMins: number;
      rowTotalMins: number;
    }
  >;
}

/**
 * Computes the grouped time-accounting balance across all split runs of a single machine.
 * All split runs for the same machineId share and must balance against the single shift's shiftWorkingMinutes.
 */
export function calculateMachineGroupTimeBalance(
  allRows: MachineShiftRow[],
  machineId: string,
  shiftWorkingMinutes?: number
): MachineGroupTimeBalance {
  const machineRows = allRows.filter((r) => r.machineId === machineId);
  const shiftMins =
    Number(shiftWorkingMinutes) ||
    Number(machineRows[0]?.shiftWorkingMinutes) ||
    Number(machineRows[0]?.totalWorkingMinutes) ||
    1305;

  const rowProductionMinutes: Record<string, number> = {};
  const rowBreakdownMinutes: Record<string, number> = {};
  const rowBreakdownSummary: Record<
    string,
    {
      prodMins: number;
      bdMins: number;
      rowTotalMins: number;
    }
  > = {};

  if (machineRows.length === 0) {
    return {
      machineId,
      runCount: 0,
      rowProductionMinutes: {},
      rowBreakdownMinutes: {},
      rowBreakdownSummary: {},
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
    };
  }

  // Check if completely untouched
  const allUntouched = machineRows.every((r) => {
    const act = Number(r.actualOutput) || 0;
    const ct = Number(r.cycleTime) || 0;
    const bd = calculateTotalBreakdown(r.breakdown);
    return !r.itemId && !r.operatorName && act === 0 && bd === 0 && ct === 0;
  });

  if (allUntouched || shiftMins <= 0) {
    machineRows.forEach((r) => {
      rowProductionMinutes[r.id] = 0;
      rowBreakdownMinutes[r.id] = 0;
      rowBreakdownSummary[r.id] = { prodMins: 0, bdMins: 0, rowTotalMins: 0 };
    });
    return {
      machineId,
      runCount: machineRows.length,
      rowProductionMinutes,
      rowBreakdownMinutes,
      rowBreakdownSummary,
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
      isFullTargetBalanced: false,
      cycleRemainderMinutes: 0,
    };
  }

  let hasMissingCt = false;
  let totalProd = 0;
  let totalBd = 0;

  for (const r of machineRows) {
    const act = Number(r.actualOutput) || 0;
    const ct = Number(r.cycleTime) || 0;
    const bd = calculateTotalBreakdown(r.breakdown);

    if (act > 0 && ct <= 0) {
      hasMissingCt = true;
    }

    const prod = Number((act * ct).toFixed(2));
    const rowTotal = Number((prod + bd).toFixed(2));
    rowProductionMinutes[r.id] = prod;
    rowBreakdownMinutes[r.id] = bd;
    rowBreakdownSummary[r.id] = { prodMins: prod, bdMins: bd, rowTotalMins: rowTotal };

    totalProd = Number((totalProd + prod).toFixed(2));
    totalBd = Number((totalBd + bd).toFixed(2));
  }

  const productionMinutes = totalProd;
  const loggedBreakdownMinutes = totalBd;
  const totalAccountedMinutes = Number((productionMinutes + loggedBreakdownMinutes).toFixed(2));
  const diff = Number((shiftMins - totalAccountedMinutes).toFixed(2));
  const isProductionExceeded = productionMinutes > shiftMins + 0.01;
  const isOver = diff < -0.01;
  let isUnder = diff > 0.01;
  let isBalanced = !hasMissingCt && !isProductionExceeded && Math.abs(diff) < 0.01;

  let requiredBreakdownMinutes = Math.max(
    0,
    Number((shiftMins - productionMinutes).toFixed(2))
  );
  let unaccountedMinutes = diff;

  let isFullTargetBalanced = false;
  let cycleRemainderMinutes = 0;

  if (!hasMissingCt && !isProductionExceeded && !isOver) {
    if (machineRows.length === 1) {
      const singleRow = machineRows[0];
      const std = Number(singleRow.stdOutput) || 0;
      const ct = Number(singleRow.cycleTime) || 0;
      const act = Number(singleRow.actualOutput) || 0;

      if (std > 0 && ct > 0 && act >= std && totalAccountedMinutes <= shiftMins + 0.01) {
        cycleRemainderMinutes = Math.max(0, Number((shiftMins - totalAccountedMinutes).toFixed(2)));
        isFullTargetBalanced = true;
        requiredBreakdownMinutes = 0;
        unaccountedMinutes = 0;
        isBalanced = true;
        isUnder = false;
      }
    } else if (machineRows.length > 1) {
      const activeRuns = machineRows.filter(
        (r) =>
          (Number(r.cycleTime) || 0) > 0 ||
          (Number(r.actualOutput) || 0) > 0 ||
          (Number(r.stdOutput) || 0) > 0
      );

      if (activeRuns.length > 0) {
        const allActiveMetTarget = activeRuns.every((r) => {
          const rCt = Number(r.cycleTime) || 0;
          const rStd = Number(r.stdOutput) || 0;
          const rAct = Number(r.actualOutput) || 0;
          return rCt > 0 && rStd > 0 && rAct >= rStd;
        });

        const positiveCts = activeRuns
          .map((r) => Number(r.cycleTime) || 0)
          .filter((c) => c > 0);
        const minActiveCycleTime = positiveCts.length > 0 ? Math.min(...positiveCts) : 0;
        const gap = Math.max(0, Number((shiftMins - totalAccountedMinutes).toFixed(2)));

        if (
          allActiveMetTarget &&
          totalAccountedMinutes <= shiftMins + 0.01 &&
          minActiveCycleTime > 0 &&
          gap < minActiveCycleTime
        ) {
          isFullTargetBalanced = true;
          cycleRemainderMinutes = gap;
          requiredBreakdownMinutes = 0;
          unaccountedMinutes = 0;
          isBalanced = true;
          isUnder = false;
        }
      }
    }
  }

  let errorMessage: string | undefined = undefined;
  if (hasMissingCt) {
    errorMessage = `Actual output entered on ${machineRows[0]?.machineName || "machine"}, but cycle time is 0. Please select an Item with a cycle time or enter cycle time.`;
  } else if (isProductionExceeded) {
    errorMessage = `Combined actual output time (${productionMinutes}m) across ${machineRows.length} run(s) exceeds shift duration (${shiftMins}m). Productive time alone is greater than shift timing.`;
  } else if (isOver) {
    errorMessage = `Combined machine time (${totalAccountedMinutes}m = ${productionMinutes}m prod + ${loggedBreakdownMinutes}m BD) exceeds shift duration (${shiftMins}m) by ${Math.abs(diff)}m.`;
  } else if (isUnder && !isFullTargetBalanced) {
    errorMessage = `Combined machine time (${totalAccountedMinutes}m = ${productionMinutes}m prod + ${loggedBreakdownMinutes}m BD) is ${diff}m short of shift duration (${shiftMins}m). Log ${diff}m in breakdown to balance.`;
  }

  return {
    machineId,
    runCount: machineRows.length,
    rowProductionMinutes,
    rowBreakdownMinutes,
    rowBreakdownSummary,
    shiftMinutes: shiftMins,
    productionMinutes,
    requiredBreakdownMinutes,
    loggedBreakdownMinutes,
    unaccountedMinutes,
    totalAccountedMinutes,
    isBalanced,
    isOver,
    isUnder,
    isProductionExceeded,
    missingCycleTime: hasMissingCt,
    isFullTargetBalanced,
    cycleRemainderMinutes,
    errorMessage,
  };
}

/**
 * Calculates the suggested stdOutput for a specific split row given a new cycle time
 * by allocating remaining unallocated target minutes from other split runs.
 */
export function calculateSplitRowSuggestedStd(
  allRows: MachineShiftRow[],
  targetRowId: string,
  newCycleTime: number,
  shiftWorkingMinutes: number
): number {
  if (newCycleTime <= 0) return 0;
  const targetRow = allRows.find((r) => r.id === targetRowId);
  if (!targetRow) return 0;

  const machineRows = allRows.filter((r) => r.machineId === targetRow.machineId);
  if (machineRows.length <= 1) {
    return Math.floor(shiftWorkingMinutes / newCycleTime);
  }

  const otherRuns = machineRows.filter((r) => r.id !== targetRowId);
  const otherTargetMins = otherRuns.reduce((sum, r) => {
    const std = Number(r.stdOutput) || 0;
    const ct = Number(r.cycleTime) || 0;
    if (std > 0 && ct > 0) {
      return Number((sum + std * ct).toFixed(2));
    }
    return sum;
  }, 0);

  const remainingMins = Math.max(0, Number((shiftWorkingMinutes - otherTargetMins).toFixed(2)));
  return Math.floor(remainingMins / newCycleTime);
}

/**
 * Proportionally distributes shift working minutes and computes stdOutput for each run
 * of a machine group.
 * - Single run: standard shiftWorkingMinutes / cycleTime
 * - Multiple split runs:
 *   - Unlocks stdOutput so users can enter exact split targets.
 *   - NEVER overwrites user-entered stdOutput (> 0) on split rows when actualOutput or breakdown changes!
 *   - If stdOutput === 0 and cycleTime > 0, suggests stdOutput from remaining unallocated target minutes.
 */
export function recalculateMachineGroupStdOutputs(
  allRows: MachineShiftRow[],
  machineId: string,
  shiftWorkingMinutes?: number
): MachineShiftRow[] {
  const machineRows = allRows.filter((r) => r.machineId === machineId);
  if (machineRows.length === 0) return allRows;

  const shiftMins =
    Number(shiftWorkingMinutes) ||
    Number(machineRows[0]?.shiftWorkingMinutes) ||
    Number(machineRows[0]?.totalWorkingMinutes) ||
    1305;

  // Single run: standard behavior
  if (machineRows.length === 1) {
    const single = machineRows[0];
    const ct = Number(single.cycleTime) || 0;
    const std = ct > 0 && shiftMins > 0 ? Math.floor(shiftMins / ct) : 0;
    return allRows.map((r) => (r.id === single.id ? { ...r, stdOutput: std } : r));
  }

  // Multiple split runs:
  // 1. Preserve each split row's existing stdOutput if already set (> 0)
  // 2. Sum allocated target minutes of runs that already have a positive stdOutput
  const allocatedTargetMins = machineRows.reduce((sum, r) => {
    const std = Number(r.stdOutput) || 0;
    const ct = Number(r.cycleTime) || 0;
    if (std > 0 && ct > 0) {
      return Number((sum + std * ct).toFixed(2));
    }
    return sum;
  }, 0);

  let remainingTargetMins = Math.max(0, Number((shiftMins - allocatedTargetMins).toFixed(2)));

  const updatedStdMap = new Map<string, number>();
  for (const run of machineRows) {
    const currentStd = Number(run.stdOutput) || 0;
    const ct = Number(run.cycleTime) || 0;
    if (currentStd > 0) {
      // Keep existing target - do NOT overwrite based on actual or breakdown!
      updatedStdMap.set(run.id, currentStd);
    } else if (ct > 0 && remainingTargetMins > 0) {
      const suggested = Math.floor(remainingTargetMins / ct);
      updatedStdMap.set(run.id, suggested);
      remainingTargetMins = Math.max(0, Number((remainingTargetMins - suggested * ct).toFixed(2)));
    } else {
      updatedStdMap.set(run.id, 0);
    }
  }

  return allRows.map((r) => {
    if (r.machineId === machineId && updatedStdMap.has(r.id)) {
      return { ...r, stdOutput: updatedStdMap.get(r.id)! };
    }
    return r;
  });
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
  if (!cycleTimes || cycleTimes.length === 0 || !itemIdentifier || !itemIdentifier.trim()) return undefined;

  const cleanItemId = itemIdentifier.trim().toLowerCase();
  if (!cleanItemId) return undefined;
  const siblingIds = getSiblingItemIds(itemIdentifier, items);
  const itemKeys = new Set<string>(siblingIds.map((id) => id.toLowerCase()));
  if (cleanItemId) itemKeys.add(cleanItemId);

  const item = items.find((it) => {
    if (!it) return false;
    const itId = (it.id || "").trim().toLowerCase();
    const itCode = (it.itemCode || "").trim().toLowerCase();
    const itName = (it.itemName || "").trim().toLowerCase();
    return (
      (itId.length > 0 && itemKeys.has(itId)) ||
      (itCode.length > 0 && itCode === cleanItemId) ||
      (itName.length > 0 && itName === cleanItemId)
    );
  });

  const matchingItems = items.filter((it) => {
    if (!it) return false;
    if (it.id && itemKeys.has(it.id.trim().toLowerCase())) return true;
    if (item) {
      if (
        it.itemCode &&
        item.itemCode &&
        it.itemCode.trim().toLowerCase() === item.itemCode.trim().toLowerCase()
      )
        return true;
      if (
        it.itemName &&
        item.itemName &&
        it.itemName.trim().toLowerCase() === item.itemName.trim().toLowerCase()
      )
        return true;
    }
    return false;
  });

  matchingItems.forEach((it) => {
    if (it.id) itemKeys.add(it.id.trim().toLowerCase());
    if (it.itemCode) itemKeys.add(it.itemCode.trim().toLowerCase());
    if (it.itemName) itemKeys.add(it.itemName.trim().toLowerCase());
  });

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
  if (!cleanItemId) {
    return {
      itemName: "",
      operation: explicitOperation || "",
      availableOperations: [] as string[],
      cycleTime: 0,
      stdOutput: 0,
    };
  }

  const baseItem = items.find((it) => {
    if (!it) return false;
    const itId = (it.id || "").trim().toLowerCase();
    const itCode = (it.itemCode || "").trim().toLowerCase();
    const itName = (it.itemName || "").trim().toLowerCase();
    return (
      (itId.length > 0 && itId === cleanItemId) ||
      (itCode.length > 0 && itCode === cleanItemId) ||
      (itName.length > 0 && itName === cleanItemId)
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

/**
 * Pure evaluation function for Shift Editing / Locking rules based on Supabase server time in IST.
 * CRITICAL RULE: Never uses client browser's new Date() - always anchored to serverNowIstStr.
 */
export function evaluateShiftLock(
  date: string,
  shiftName: string,
  shiftsMaster: ShiftMaster[] = [],
  serverNowIstStr: string,
  isAdmin: boolean,
  bufferMinutes: number = 30
): ShiftLockInfo {
  // 1. Unit Head Override: Immediate access to all historical and future shifts
  if (isAdmin) {
    return {
      isEditable: true,
      status: "admin_override",
      reason:
        "Unit Head Override Active — All historical and future shifts unlocked.",
    };
  }

  // 2. Resolve Shift Timings
  const lower = (shiftName || "").toLowerCase();
  const shift = shiftsMaster.find(
    (s) =>
      s.displayName === shiftName ||
      s.shiftCode === shiftName ||
      (s.shiftCode && lower.startsWith(s.shiftCode.toLowerCase())) ||
      (s.displayName && lower.startsWith(s.displayName.toLowerCase()))
  );

  let startTime = "07:00:00";
  let endTime = "15:30:00";

  if (shift) {
    startTime = shift.startTime;
    endTime = shift.endTime;
  } else if (lower.includes("b") || lower.includes("3:30pm") || lower.includes("2pm") || lower.includes("15:30")) {
    startTime = "15:30:00";
    endTime = "00:00:00";
  } else if (lower.includes("c") || lower.includes("12am") || lower.includes("10pm")) {
    startTime = "00:00:00";
    endTime = "07:00:00";
  }

  const normalizeTime = (t: string) => {
    const parts = (t || "").trim().split(":");
    const h = (parts[0] || "00").padStart(2, "0");
    const m = (parts[1] || "00").padStart(2, "0");
    const s = (parts[2] || "00").padStart(2, "0");
    return `${h}:${m}:${s}`;
  };

  const normStart = normalizeTime(startTime);
  const normEnd = normalizeTime(endTime);

  // 3. Parse Server Timestamp in IST (UTC+05:30)
  const parseIstTimestamp = (str: string): number => {
    if (!str) return 0;
    const clean = str.trim().replace(" ", "T");
    if (clean.includes("+") || clean.includes("Z") || (clean.length > 10 && clean.slice(10).includes("-"))) {
      return new Date(clean).getTime();
    }
    return new Date(`${clean}+05:30`).getTime();
  };

  const serverNow = parseIstTimestamp(serverNowIstStr);

  // 4. Construct Shift Start & End Times in IST
  const shiftStart = new Date(`${date}T${normStart}+05:30`).getTime();

  let shiftEnd: number;
  if (normEnd <= normStart) {
    // Overnight Shift (e.g. Shift C 22:00 -> 06:00 next day)
    const [y, m, d] = date.split("-").map(Number);
    const nextDateObj = new Date(Date.UTC(y, m - 1, d + 1));
    const nextDateStr = nextDateObj.toISOString().slice(0, 10);
    shiftEnd = new Date(`${nextDateStr}T${normEnd}+05:30`).getTime();
  } else {
    shiftEnd = new Date(`${date}T${normEnd}+05:30`).getTime();
  }

  const lockDeadline = shiftEnd + bufferMinutes * 60_000;

  let lockDeadlineText: string | undefined;
  try {
    lockDeadlineText = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(lockDeadline)) + " IST";
  } catch {
    lockDeadlineText = undefined;
  }

  // 5. Evaluate Lock Status
  if (serverNow < shiftStart) {
    return {
      isEditable: false,
      status: "future",
      reason: "Shift Locked — This shift has not started yet.",
      lockDeadlineText,
    };
  }

  if (serverNow > lockDeadline) {
    return {
      isEditable: false,
      status: "locked",
      reason:
        "Shift Locked — The 30-minute post-shift editing window has closed.",
      lockDeadlineText,
    };
  }

  if (serverNow >= shiftEnd && serverNow <= lockDeadline) {
    const remainingMinutes = Math.max(1, Math.ceil((lockDeadline - serverNow) / 60000));
    return {
      isEditable: true,
      status: "grace_period",
      reason: `Grace Period Active — ${remainingMinutes}m left before shift locks.`,
      lockDeadlineText,
      remainingMinutes,
    };
  }

  return {
    isEditable: true,
    status: "open",
    reason: null,
    lockDeadlineText,
  };
}