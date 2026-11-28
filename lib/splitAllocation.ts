import { BreakdownMinutes, MachineShiftRow } from "@/types";

export const round2 = (val: number): number => {
  const num = Number(val);
  return Number.isFinite(num) ? Number(num.toFixed(2)) : 0;
};

export interface CombinedSplitInput {
  overtimeMinutes: number;
  noDisc: number;
  change: number;
  power: number;
  operator: number;
  machineBreakdown: number;
  fixProgSettings: number;
  miscellaneous: number;
  // Optional DB-style aliases for convenience
  bdNoDisc?: number;
  bdChange?: number;
  bdPower?: number;
  bdOperator?: number;
  bdMachine?: number;
  bdFixProg?: number;
  bdMisc?: number;
}

/**
 * Pure deterministic proportional allocator with exact residual reconciliation.
 * Rounds each non-final positive-weight bucket to 2 decimals and assigns the exact
 * residual `round2(total - sumSoFar)` to the last bucket with `weight > 0` so
 * `sum(result) === round2(total)` with `0.00` drift and zero negative numbers.
 */
export function allocateExact(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const safeTotal = Math.max(0, round2(total));
  if (safeTotal <= 0) return weights.map(() => 0);

  const rawWeights = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const rawSum = rawWeights.reduce((acc, w) => acc + w, 0);

  const effectiveWeights = rawSum > 0 ? rawWeights : weights.map(() => 1);
  const weightSum = rawSum > 0 ? rawSum : weights.length;

  let lastPositiveIdx = -1;
  for (let i = effectiveWeights.length - 1; i >= 0; i--) {
    if (effectiveWeights[i] > 0) {
      lastPositiveIdx = i;
      break;
    }
  }
  if (lastPositiveIdx === -1) return weights.map(() => 0);

  const result = new Array<number>(weights.length).fill(0);
  let sumSoFar = 0;

  for (let i = 0; i < effectiveWeights.length; i++) {
    if (effectiveWeights[i] <= 0) {
      result[i] = 0;
      continue;
    }
    if (i === lastPositiveIdx) {
      result[i] = Math.max(0, round2(safeTotal - sumSoFar));
    } else {
      const share = Math.max(0, round2((effectiveWeights[i] / weightSum) * safeTotal));
      const capped = Math.min(share, Math.max(0, round2(safeTotal - sumSoFar)));
      result[i] = capped;
      sumSoFar = round2(sumSoFar + capped);
    }
  }

  return result;
}

function normalizeCombinedInput(input: CombinedSplitInput): {
  overtimeMinutes: number;
  noDisc: number;
  change: number;
  power: number;
  operator: number;
  machineBreakdown: number;
  fixProgSettings: number;
  miscellaneous: number;
} {
  return {
    overtimeMinutes: Math.max(0, round2(input.overtimeMinutes ?? 0)),
    noDisc: Math.max(0, round2(input.noDisc ?? input.bdNoDisc ?? 0)),
    change: Math.max(0, round2(input.change ?? input.bdChange ?? 0)),
    power: Math.max(0, round2(input.power ?? input.bdPower ?? 0)),
    operator: Math.max(0, round2(input.operator ?? input.bdOperator ?? 0)),
    machineBreakdown: Math.max(0, round2(input.machineBreakdown ?? input.bdMachine ?? 0)),
    fixProgSettings: Math.max(0, round2(input.fixProgSettings ?? input.bdFixProg ?? 0)),
    miscellaneous: Math.max(0, round2(input.miscellaneous ?? input.bdMisc ?? 0)),
  };
}

/**
 * Extracts combined shift OT and 7-category breakdown totals across a split group.
 */
export function extractCombinedSplitTotals(rows: MachineShiftRow[]): CombinedSplitInput {
  let overtimeMinutes = 0;
  let noDisc = 0;
  let change = 0;
  let power = 0;
  let operator = 0;
  let machineBreakdown = 0;
  let fixProgSettings = 0;
  let miscellaneous = 0;

  for (const r of rows) {
    overtimeMinutes += Math.max(0, Number(r.overtimeMinutes) || 0);
    const bd = r.breakdown;
    if (bd) {
      noDisc += Math.max(0, Number(bd.noDisc) || 0);
      change += Math.max(0, Number(bd.change) || 0);
      power += Math.max(0, Number(bd.power) || 0);
      operator += Math.max(0, Number(bd.operator) || 0);
      machineBreakdown += Math.max(0, Number(bd.machineBreakdown) || 0);
      fixProgSettings += Math.max(0, Number(bd.fixProgSettings) || 0);
      miscellaneous += Math.max(0, Number(bd.miscellaneous) || 0);
    }
  }

  return {
    overtimeMinutes: round2(overtimeMinutes),
    noDisc: round2(noDisc),
    change: round2(change),
    power: round2(power),
    operator: round2(operator),
    machineBreakdown: round2(machineBreakdown),
    fixProgSettings: round2(fixProgSettings),
    miscellaneous: round2(miscellaneous),
  };
}

export function isMergedSplitGroup(rows: Pick<MachineShiftRow, "isMergedDt">[]): boolean {
  return rows.length >= 2 && rows.every((r) => Boolean(r.isMergedDt));
}

/**
 * Allocates single-shift working budget, overtime, Std Output, and all 7 breakdown categories
 * across a machine's merged split rows (`isMergedDt = true`).
 *
 * Guarantees:
 * - `sum(row.totalWorkingMinutes) === round2(baseShiftMinutes + combinedInput.overtimeMinutes)`
 * - `sum(row[bdField]) === round2(combinedInput[bdField])`
 * - `sum(row.overtimeMinutes) === round2(combinedInput.overtimeMinutes)`
 */
export function allocateMergedSplitGroup(
  rows: MachineShiftRow[],
  combinedInput: CombinedSplitInput,
  baseShiftMinutes: number
): MachineShiftRow[] {
  if (!rows || rows.length === 0) return [];

  const safeBaseShift = Math.max(0, round2(baseShiftMinutes));
  const combined = normalizeCombinedInput(combinedInput);
  const groupWorkingMins = round2(safeBaseShift + combined.overtimeMinutes);

  const n = rows.length;
  const prodMins = rows.map((r) =>
    Math.max(0, round2((Number(r.actualOutput) || 0) * (Number(r.cycleTime) || 0)))
  );
  const sumProd = prodMins.reduce((acc, v) => acc + v, 0);
  const prodWeights = sumProd > 0 ? prodMins : rows.map(() => 1);

  const anyManual = rows.some((r) => Boolean(r.isManualStd));

  let workingMins: number[];
  let bdWeights: number[];
  let otWeights: number[];
  let nextStdOutputs: number[];

  if (!anyManual) {
    // Case 1: Auto Std (proportional to productive run-time share, or equal if 0)
    workingMins = allocateExact(groupWorkingMins, prodWeights);
    bdWeights = prodWeights;
    otWeights = prodWeights;
    nextStdOutputs = rows.map((r, i) => {
      const ct = Math.max(0, Number(r.cycleTime) || 0);
      return ct > 0 ? Math.round(workingMins[i] / ct) : 0;
    });
  } else {
    // Case 2: Manual Std override on 1+ splits with gap-based downtime flow
    const isManual = rows.map((r) => Boolean(r.isManualStd));
    const cts = rows.map((r) => Math.max(0, Number(r.cycleTime) || 0));
    const manualStds = rows.map((r) => Math.max(0, Math.round(Number(r.stdOutput) || 0)));
    const manualRaw = rows.map((_, i) => (isManual[i] ? round2(manualStds[i] * cts[i]) : 0));

    const sumManualRaw = round2(manualRaw.reduce((acc, v) => acc + v, 0));
    const hasAuto = isManual.some((m) => !m);

    if (sumManualRaw < groupWorkingMins && hasAuto) {
      const remaining = Math.max(0, round2(groupWorkingMins - sumManualRaw));
      const sumAutoProd = rows.reduce((acc, _, i) => acc + (isManual[i] ? 0 : prodMins[i]), 0);
      const autoWeights = rows.map((_, i) =>
        isManual[i] ? 0 : sumAutoProd > 0 ? prodMins[i] : 1
      );
      const autoWorking = allocateExact(remaining, autoWeights);
      workingMins = rows.map((_, i) => (isManual[i] ? manualRaw[i] : autoWorking[i]));
      nextStdOutputs = rows.map((_, i) => {
        if (isManual[i]) return manualStds[i];
        return cts[i] > 0 ? Math.round(workingMins[i] / cts[i]) : 0;
      });
    } else {
      // All splits are manual OR sum(manualRaw) >= groupWorkingMins
      const manualMaskWeights = rows.map((_, i) => {
        if (!isManual[i]) return 0;
        return manualRaw[i] > 0 ? manualRaw[i] : sumManualRaw > 0 ? 0 : 1;
      });
      const maskSum = manualMaskWeights.reduce((acc, v) => acc + v, 0);
      workingMins = allocateExact(
        groupWorkingMins,
        maskSum > 0 ? manualMaskWeights : rows.map((_, i) => (isManual[i] ? 1 : 0))
      );
      const scaledDown = sumManualRaw > groupWorkingMins + 0.01;
      nextStdOutputs = rows.map((_, i) => {
        if (!isManual[i]) return 0;
        if (scaledDown && cts[i] > 0) {
          return Math.round(workingMins[i] / cts[i]);
        }
        return manualStds[i];
      });
    }

    const gaps = rows.map((_, i) => Math.max(0, round2(workingMins[i] - prodMins[i])));
    const sumGaps = gaps.reduce((acc, v) => acc + v, 0);
    bdWeights = sumGaps > 0 ? gaps : prodWeights;
    otWeights = groupWorkingMins > 0 ? workingMins : prodWeights;
  }

  const otAlloc = allocateExact(combined.overtimeMinutes, otWeights);
  const noDiscAlloc = allocateExact(combined.noDisc, bdWeights);
  const changeAlloc = allocateExact(combined.change, bdWeights);
  const powerAlloc = allocateExact(combined.power, bdWeights);
  const operatorAlloc = allocateExact(combined.operator, bdWeights);
  const machineBdAlloc = allocateExact(combined.machineBreakdown, bdWeights);
  const fixProgAlloc = allocateExact(combined.fixProgSettings, bdWeights);
  const miscAlloc = allocateExact(combined.miscellaneous, bdWeights);

  const out: MachineShiftRow[] = new Array<MachineShiftRow>(n);
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    const nextBd: BreakdownMinutes = {
      noDisc: noDiscAlloc[i],
      change: changeAlloc[i],
      power: powerAlloc[i],
      operator: operatorAlloc[i],
      machineBreakdown: machineBdAlloc[i],
      fixProgSettings: fixProgAlloc[i],
      miscellaneous: miscAlloc[i],
    };
    out[i] = {
      ...r,
      isMergedDt: true,
      isManualStd: Boolean(r.isManualStd),
      shiftWorkingMinutes: safeBaseShift,
      totalWorkingMinutes: workingMins[i],
      overtimeMinutes: otAlloc[i],
      stdOutput: nextStdOutputs[i],
      breakdown: nextBd,
    };
  }
  return out;
}
