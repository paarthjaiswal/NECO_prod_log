"use client";
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Download,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  ExternalLink,
  Info,
  Zap,
  Lock,
} from 'lucide-react';
import {
  MachineShiftRow,
  MasterDataState,
  ShiftType,
  ShiftLockInfo,
} from '@/types';
import {
  calculateEfficiency,
  calculateTotalBreakdown,
  resolveMachineItemTarget,
  getOperationsForItem,
  calculateDynamicStdOutput,
  calculateDowntimePct,
  calculateShiftTimeBalance,
} from '@/services/storageService';

type BreakdownKey = 'noDisc' | 'change' | 'power' | 'operator';

const BD_KEYS: BreakdownKey[] = ['noDisc', 'change', 'power', 'operator'];

const BD_META: Record<
  BreakdownKey,
  {
    shortLabel: string;
    fullLabel: string;
    pillClass: string;
    activeCellClass: string;
  }
> = {
  noDisc: {
    shortLabel: 'NO/DISC',
    fullLabel: 'NO/DISC (Material)',
    pillClass: 'bg-amber-100 text-amber-900 border-amber-300',
    activeCellClass: 'bg-amber-50 text-amber-900 font-semibold border-amber-300',
  },
  change: {
    shortLabel: 'CHANGE',
    fullLabel: 'CHANGE (Tool/Setup)',
    pillClass: 'bg-sky-100 text-sky-900 border-sky-300',
    activeCellClass: 'bg-sky-50 text-sky-900 font-semibold border-sky-300',
  },
  power: {
    shortLabel: 'POWER',
    fullLabel: 'POWER (Electrical)',
    pillClass: 'bg-rose-100 text-rose-900 border-rose-300',
    activeCellClass: 'bg-rose-50 text-rose-900 font-semibold border-rose-300',
  },
  operator: {
    shortLabel: 'OPERATOR',
    fullLabel: 'OPERATOR (Delay)',
    pillClass: 'bg-purple-100 text-purple-900 border-purple-300',
    activeCellClass: 'bg-purple-50 text-purple-900 font-semibold border-purple-300',
  },
};

const NAV_COLS = [
  'cycleTime',
  'stdOutput',
  'actualOutput',
  'rework',
  'noDisc',
  'change',
  'power',
  'operator',
] as const;

interface DailyShiftSheetProps {
  rows: MachineShiftRow[];
  masterData: MasterDataState;
  onRowsChange: (updatedRows: MachineShiftRow[]) => void;
  onSave: (rowsToSave: MachineShiftRow[]) => void | Promise<void>;
  isSaving: boolean;
  selectedDate: string;
  selectedShift: ShiftType;
  selectedLine: string;
  hasUnsavedDraft: boolean;
  onDiscardDraft?: () => void;
  onExportExcel?: () => void;
  onOpenMachineInKiosk?: (machineId: string) => void;
  isAdmin?: boolean;
  isShiftLocked?: boolean;
  shiftLock?: ShiftLockInfo;
}

export const DailyShiftSheet: React.FC<DailyShiftSheetProps> = ({
  rows,
  masterData,
  onRowsChange,
  onSave,
  isSaving,
  selectedDate,
  selectedShift,
  selectedLine,
  hasUnsavedDraft,
  onDiscardDraft,
  onExportExcel,
  onOpenMachineInKiosk,
  isAdmin = false,
  isShiftLocked = false,
  shiftLock,
}) => {
const operators = useMemo(() => masterData?.operators ?? [], [masterData?.operators]);
const items = useMemo(() => masterData?.items ?? [], [masterData?.items]);
const cycleTimes = useMemo(() => masterData?.cycleTimes ?? [], [masterData?.cycleTimes]);

  // Fetched from public.shifts in Supabase (matches displayName or shiftCode)
  const activeShiftObj = masterData?.shifts?.find(
    (s) => s.displayName === selectedShift || s.shiftCode === selectedShift
  );
  const shiftWorkingMinutes =
    activeShiftObj?.shiftWorkingMinutes ??
    rows[0]?.totalWorkingMinutes ??
    0;

  const hasUnsavedChanges = hasUnsavedDraft;

  // Tracks which row + BD cell is currently focused for quick-add buttons (defaults to row 0, noDisc)
  const [activeBdCell, setActiveBdCell] = useState<{
    rowIndex: number;
    field: BreakdownKey;
  }>({ rowIndex: 0, field: 'noDisc' });

  // State for Line-Wide Bulk Breakdown Applier (e.g., Power Cut across all machines)
  const [bulkBdField, setBulkBdField] = useState<BreakdownKey>('power');
  const [bulkBdMinutes, setBulkBdMinutes] = useState<string>('');

  // Apply a patch to one row (single onRowsChange call -> single draft write)
  const updateRow = useCallback(
    (index: number, updatedFields: Partial<MachineShiftRow>) => {
      if (isShiftLocked) return;
      onRowsChange(rows.map((r, i) => (i === index ? { ...r, ...updatedFields } : r)));
    },
    [isShiftLocked, rows, onRowsChange]
  );

  // Apply patches to many rows at once (avoids stale-closure overwrites from looping updateRow)
  const patchRows = (
    fn: (row: MachineShiftRow, idx: number) => Partial<MachineShiftRow> | null
  ) => {
    if (isShiftLocked) return;
    onRowsChange(
      rows.map((row, idx) => {
        const patch = fn(row, idx);
        return patch ? { ...row, ...patch } : row;
      })
    );
  };

  // Auto-populate stored Cycle Time for any row that has an Item configured but cycleTime is 0
  useEffect(() => {
    if (isShiftLocked || !cycleTimes || cycleTimes.length === 0 || rows.length === 0) return;

    let hasUpdates = false;
    const updated = rows.map((row) => {
      if (!row.itemId || row.cycleTime > 0) return row;
      const target = resolveMachineItemTarget(
        row.machineId,
        row.itemId,
        items,
        cycleTimes,
        row.operation || undefined,
        shiftWorkingMinutes,
        row.machineName
      );
      if (target.cycleTime > 0) {
        hasUpdates = true;
        return {
          ...row,
          operation: row.operation || target.operation,
          cycleTime: target.cycleTime,
          stdOutput: target.stdOutput || row.stdOutput,
        };
      }
      return row;
    });

    if (hasUpdates) {
      onRowsChange(updated);
    }
  }, [isShiftLocked, cycleTimes, items, shiftWorkingMinutes]);

  // 1. When Item changes: auto-select default operation & fetch matching Cycle Time + Std Output
  const handleItemChange = useCallback(
    (index: number, itemId: string) => {
      if (isShiftLocked) return;
      const currentRow = rows[index];
      if (!itemId) {
        updateRow(index, {
          itemId: '',
          itemName: '',
          operation: '',
          cycleTime: 0,
          stdOutput: 0,
        });
        return;
      }

      const target = resolveMachineItemTarget(
        currentRow.machineId,
        itemId,
        items,
        cycleTimes,
        undefined, // Let helper pick the operation & cycle time for this machine + item
        shiftWorkingMinutes,
        currentRow.machineName
      );

      updateRow(index, {
        itemId,
        itemName: target.itemName,
        operation: target.operation,
        cycleTime: target.cycleTime,
        stdOutput: target.stdOutput,
        totalWorkingMinutes: shiftWorkingMinutes,
      });
    },
    [isShiftLocked, rows, items, cycleTimes, shiftWorkingMinutes, updateRow]
  );

  // 2. When Operation changes: re-fetch Cycle Time for (Machine + Item + selected Operation)
  const handleOperationChange = useCallback(
    (index: number, operationName: string) => {
      if (isShiftLocked) return;
      const currentRow = rows[index];
      if (!currentRow.itemId) {
        updateRow(index, { operation: operationName });
        return;
      }

      const target = resolveMachineItemTarget(
        currentRow.machineId,
        currentRow.itemId,
        items,
        cycleTimes,
        operationName,
        shiftWorkingMinutes,
        currentRow.machineName
      );

      updateRow(index, {
        operation: operationName,
        cycleTime: target.cycleTime,
        stdOutput: target.stdOutput,
        totalWorkingMinutes: shiftWorkingMinutes,
      });
    },
    [isShiftLocked, rows, items, cycleTimes, shiftWorkingMinutes, updateRow]
  );

  // Handle Breakdown Sub-column update
  const handleBreakdownChange = useCallback(
    (index: number, field: BreakdownKey, val: number) => {
      if (isShiftLocked) return;
      const current = rows[index]?.breakdown || {
        noDisc: 0,
        change: 0,
        power: 0,
        operator: 0,
      };
      const safeVal = isNaN(val) ? 0 : Math.max(0, val);
      updateRow(index, {
        breakdown: {
          ...current,
          [field]: safeVal,
        },
      });
    },
    [isShiftLocked, rows, updateRow]
  );

  // Quick-adjust the currently focused BD cell (+5, +10, +15, +30, +60, -5, Clear)
  const handleQuickAdjustBd = (deltaOrExact: number, mode: 'add' | 'set' = 'add') => {
    if (isShiftLocked) return;
    const active = activeBdCell || { rowIndex: 0, field: 'noDisc' };
    const targetRow = rows[active.rowIndex] || rows[0];
    if (!targetRow) return;

    const currentVal = Number(targetRow.breakdown?.[active.field] ?? 0);
    const nextVal =
      mode === 'set' ? Math.max(0, deltaOrExact) : Math.max(0, currentVal + deltaOrExact);

    handleBreakdownChange(active.rowIndex, active.field, nextVal);
  };

  // Auto-balance unaccounted minutes into the active BD column (or noDisc if none focused on that row)
  const handleFillUnaccountedBd = (rowIndex: number, preferredField?: BreakdownKey) => {
    if (isShiftLocked) return;
    const row = rows[rowIndex];
    if (!row) return;

    const rowShiftMins = shiftWorkingMinutes || row.totalWorkingMinutes;
    const balance = calculateShiftTimeBalance(row, rowShiftMins);
    if (balance.unaccountedMinutes <= 0) return;

    const targetField: BreakdownKey =
      preferredField ??
      (activeBdCell?.rowIndex === rowIndex ? activeBdCell.field : 'noDisc');

    const currentVal = Number(row.breakdown?.[targetField] ?? 0);
    handleBreakdownChange(rowIndex, targetField, currentVal + balance.unaccountedMinutes);
    setActiveBdCell({ rowIndex, field: targetField });
  };

  // Apply bulk breakdown minutes across all machines on the line (e.g., Power Cut)
  const handleApplyBulkLineBd = () => {
    if (isShiftLocked) return;
    const minsToAdd = parseInt(bulkBdMinutes, 10);
    if (!minsToAdd || minsToAdd <= 0) return;

    patchRows((row) => {
      const currentBd = row.breakdown || {
        noDisc: 0,
        change: 0,
        power: 0,
        operator: 0,
      };
      return {
        breakdown: {
          ...currentBd,
          [bulkBdField]: Math.max(0, Number(currentBd[bulkBdField] || 0) + minsToAdd),
        },
      };
    });
    setBulkBdMinutes('');
  };

  // Excel-style Arrow Key & Enter navigation across numeric cells
  const handleGridKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    rowIndex: number,
    colKey: string
  ) => {
    if (
      !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)
    ) {
      return;
    }

    let nextRow = rowIndex;
    let nextCol = colKey;

    if (e.key === 'ArrowUp') {
      nextRow = rowIndex - 1;
    } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
      nextRow = rowIndex + 1;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const colIdx = NAV_COLS.indexOf(colKey as (typeof NAV_COLS)[number]);
      if (colIdx !== -1) {
        const targetIdx = e.key === 'ArrowLeft' ? colIdx - 1 : colIdx + 1;
        if (targetIdx >= 0 && targetIdx < NAV_COLS.length) {
          nextCol = NAV_COLS[targetIdx];
        } else {
          return;
        }
      }
    }

    const targetInput = document.querySelector<HTMLInputElement>(
      `input[data-grid-cell="${nextRow}-${nextCol}"]`
    );
    if (targetInput) {
      e.preventDefault();
      targetInput.focus();
      targetInput.select();
    }
  };

  // Quick fill remaining unassigned machines with sensible defaults
  const handleQuickFillEmpty = () => {
    if (isShiftLocked) return;
    if (!operators.length || !items.length) return;
    patchRows((row, idx) => {
      if (row.operatorName && row.itemId) return null;
      const op = operators[idx % operators.length];
      const it = items[idx % items.length];
      const target = resolveMachineItemTarget(
        row.machineId,
        it.id,
        items,
        cycleTimes,
        undefined,
        shiftWorkingMinutes,
        row.machineName
      );
      return {
        operatorName: op,
        itemId: it.id,
        itemName: target.itemName,
        operation: target.operation,
        cycleTime: target.cycleTime,
        totalWorkingMinutes: shiftWorkingMinutes,
        stdOutput: target.stdOutput,
        actualOutput: Math.max(0, target.stdOutput - 4),
        rework: 1,
        breakdown: { noDisc: 0, change: 10, power: 0, operator: 0 },
        remarks: 'Standard production cycle logged',
      };
    });
  };

  // Reset current shift sheet to blank rows
  const handleClearSheet = () => {
    if (isShiftLocked) return;
    if (window.confirm('Clear all inputs on this shift sheet?')) {
      patchRows(() => ({
        operatorName: '',
        itemId: '',
        itemName: '',
        operation: '',
        cycleTime: 0,
        totalWorkingMinutes: shiftWorkingMinutes,
        stdOutput: 0,
        actualOutput: 0,
        rework: 0,
        breakdown: { noDisc: 0, change: 0, power: 0, operator: 0 },
        remarks: '',
      }));
    }
  };

  const handleSaveWithValidation = () => {
    if (isShiftLocked) {
      alert(shiftLock?.reason || 'Shift is locked. Data is read-only.');
      return;
    }
    const unbalancedRows = rows.filter((row) => {
      const isTouched =
        !!row.itemId ||
        !!row.operatorName ||
        (row.actualOutput || 0) > 0 ||
        calculateTotalBreakdown(row.breakdown) > 0 ||
        (row.cycleTime || 0) > 0;
      if (!isTouched) return false;
      const balance = calculateShiftTimeBalance(row, shiftWorkingMinutes);
      return !balance.isBalanced;
    });

    if (unbalancedRows.length > 0) {
      const firstBad = unbalancedRows[0];
      const bal = calculateShiftTimeBalance(firstBad, shiftWorkingMinutes);
      let details = '';
      if (bal.missingCycleTime) {
        details =
          `• ERROR: Actual output (${firstBad.actualOutput} pcs) was entered, but Cycle Time is 0!\n` +
          `• Productive time cannot be verified. Please select an Item with a cycle time or enter cycle time.`;
      } else if (bal.isProductionExceeded) {
        details =
          `• ERROR: Actual output (${firstBad.actualOutput} pcs × ${firstBad.cycleTime}m = ${bal.productionMinutes} mins) exceeds shift duration (${bal.shiftMinutes} mins)!\n` +
          `• Productive time alone is greater than shift timing. Please reduce Actual Output or verify cycle time.`;
      } else if (bal.isOver) {
        details =
          `• ERROR: Total productive time (${bal.productionMinutes}m) + breakdown (${bal.loggedBreakdownMinutes}m) = ${bal.totalAccountedMinutes} mins, which exceeds shift duration (${bal.shiftMinutes} mins) by ${Math.abs(bal.unaccountedMinutes)} mins!\n` +
          `• Total productive time + total breakdown time must NOT exceed shift duration—it must be exactly equal.`;
      } else {
        details =
          `• Actual Output Time (${firstBad.actualOutput} pcs × ${firstBad.cycleTime}m): ${bal.productionMinutes} mins\n` +
          `• Required Breakdown / Downtime: ${bal.requiredBreakdownMinutes} mins\n` +
          `• Currently Logged Breakdown: ${bal.loggedBreakdownMinutes} mins\n\n` +
          `• Please fill the remaining ${bal.unaccountedMinutes} mins in Breakdown columns (NO/DISC, CHANGE, POWER, or OPERATOR) so total time equals ${bal.shiftMinutes} mins.`;
      }

      alert(
        `Shift Time Mismatch on ${firstBad.machineName} (Row #${firstBad.srNo}):\n\n` +
          `• Shift Duration (from DB): ${bal.shiftMinutes} mins\n` +
          details
      );
      return;
    }

    onSave(
      rows.map((r) => ({
        ...r,
        totalWorkingMinutes: shiftWorkingMinutes || r.totalWorkingMinutes,
      }))
    );
  };

  // Calculations for summary footer row
  const totalStd = rows.reduce((acc, r) => acc + (Number(r.stdOutput) || 0), 0);
  const totalAct = rows.reduce((acc, r) => acc + (Number(r.actualOutput) || 0), 0);
  const totalRework = rows.reduce((acc, r) => acc + (Number(r.rework) || 0), 0);
  const totalNoDisc = rows.reduce((acc, r) => acc + (Number(r.breakdown?.noDisc) || 0), 0);
  const totalChange = rows.reduce((acc, r) => acc + (Number(r.breakdown?.change) || 0), 0);
  const totalPower = rows.reduce((acc, r) => acc + (Number(r.breakdown?.power) || 0), 0);
  const totalOperator = rows.reduce((acc, r) => acc + (Number(r.breakdown?.operator) || 0), 0);
  const grandBreakdown = totalNoDisc + totalChange + totalPower + totalOperator;
  const overallEfficiency = totalStd > 0 ? Math.round((totalAct / totalStd) * 100) : 0;
  const activeMachineCount = rows.filter((r) => (Number(r.stdOutput) || 0) > 0).length;

  // Active rows & time balance sanity checks across all machines
  const activeRows = rows.filter((r) => {
    return (
      !!r.itemId ||
      !!r.operatorName ||
      (r.actualOutput || 0) > 0 ||
      calculateTotalBreakdown(r.breakdown) > 0 ||
      (r.cycleTime || 0) > 0
    );
  });
  const unbalancedRows = activeRows.filter((r) => {
    const b = calculateShiftTimeBalance(r, shiftWorkingMinutes);
    return !b.isBalanced;
  });
  const unbalancedCount = unbalancedRows.length;

  // Footer downtime %: total minutes vs. available minutes of machines that are in use
  const footerWorkingMinutes = rows.reduce((acc, r) => {
    const inUse = (Number(r.stdOutput) || 0) > 0 || calculateTotalBreakdown(r.breakdown) > 0;
    return inUse ? acc + (r.totalWorkingMinutes || shiftWorkingMinutes) : acc;
  }, 0);
  const renderFooterPct = (mins: number) =>
    mins > 0 && footerWorkingMinutes > 0 ? (
      <div className="text-[10px] leading-none text-slate-400 font-normal mt-0.5">
        ({calculateDowntimePct(mins, footerWorkingMinutes)}%)
      </div>
    ) : null;

  // Derive active row & its remaining unaccounted BD balance for the Quick BD Strip
  const focusedRow = rows[activeBdCell?.rowIndex ?? 0] || rows[0] || null;
  const focusedRowBalance =
    focusedRow && focusedRow.itemId && focusedRow.cycleTime > 0
      ? calculateShiftTimeBalance(
          focusedRow,
          shiftWorkingMinutes || focusedRow.totalWorkingMinutes
        )
      : null;

  return (
    <div className="w-full space-y-2.5">
      {/* Shift Lock Banner */}
      {isShiftLocked && (
        <div className="bg-rose-950 border border-rose-500/60 rounded-lg p-3 text-rose-100 flex items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-2.5 text-xs font-semibold">
            <Lock className="w-4 h-4 text-rose-400 shrink-0" />
            <span>
              {shiftLock?.reason ||
                "Shift Locked — The 30-minute post-shift editing window has closed. Data is now immutable."}
            </span>
            {shiftLock?.lockDeadlineText && (
              <span className="text-rose-300 font-mono text-[11px] bg-rose-900/60 px-2 py-0.5 rounded border border-rose-700/60">
                Locked at: {shiftLock.lockDeadlineText}
              </span>
            )}
          </div>
          <span className="text-[11px] font-bold uppercase tracking-wider bg-rose-900 text-rose-200 px-2.5 py-0.5 rounded border border-rose-700 shrink-0">
            Read-Only
          </span>
        </div>
      )}

      {/* Grace Period Warning Banner */}
      {!isShiftLocked && shiftLock?.status === 'grace_period' && (
        <div className="bg-amber-950 border border-amber-500/60 rounded-lg p-3 text-amber-100 flex items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-2.5 text-xs font-semibold">
            <span className="text-base leading-none animate-pulse">⏳</span>
            <span>
              Shift has concluded. Grace period active — <strong>{shiftLock.remainingMinutes} mins remaining</strong> before shift permanently locks.
            </span>
            {shiftLock?.lockDeadlineText && (
              <span className="text-amber-200 font-mono text-[11px] bg-amber-900/60 px-2 py-0.5 rounded border border-amber-600/60">
                Lock Deadline: {shiftLock.lockDeadlineText}
              </span>
            )}
          </div>
          <span className="text-[11px] font-bold uppercase tracking-wider bg-amber-800 text-amber-100 px-2.5 py-0.5 rounded border border-amber-600 shrink-0">
            Grace Window
          </span>
        </div>
      )}

      {/* Top Action Bar matching factory paper log instructions */}
      <div className="bg-white rounded-lg border border-slate-200 p-3 sm:p-4 shadow-2xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-slate-900 text-white px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-2">
            <span className="text-emerald-400 font-bold uppercase">{selectedLine}</span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-400">SHIFT:</span>
            <span>{selectedShift}</span>
            {shiftWorkingMinutes > 0 && (
              <>
                <span className="text-slate-600">·</span>
                <span className="text-amber-300 font-mono">{shiftWorkingMinutes}m</span>
              </>
            )}
          </div>
          <div className="text-xs text-slate-600 hidden md:flex items-center gap-2">
            <span>Date: <strong className="text-slate-900">{selectedDate}</strong></span>
            <span>·</span>
            <span>Active Machines: <strong className="text-emerald-700">{activeMachineCount} / {rows.length}</strong></span>
            <span>·</span>
            <span>Line Target: <strong className="text-slate-900">{totalStd} pcs</strong></span>
            <span>·</span>
            {unbalancedCount > 0 ? (
              <span
                className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold border border-rose-300 flex items-center gap-1 animate-pulse"
                title={`${unbalancedCount} machines have shift time mismatches. Total productive time + breakdown must equal ${shiftWorkingMinutes}m.`}
              >
                <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                <span>{unbalancedCount} Time {unbalancedCount === 1 ? 'Mismatch' : 'Mismatches'}</span>
              </span>
            ) : activeRows.length > 0 ? (
              <span
                className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold border border-emerald-300 flex items-center gap-1"
                title={`All ${activeRows.length} active machines are time-balanced (Productive + Breakdown = ${shiftWorkingMinutes}m)`}
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>All {activeRows.length} Balanced</span>
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {!isShiftLocked && (
            <button
              onClick={handleQuickFillEmpty}
              className="px-2.5 py-1.5 text-xs text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded font-medium flex items-center gap-1.5 transition-colors"
              title="Auto-fill empty machine rows with standard sample jobs"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-600" />
              <span className="hidden sm:inline">Fill Remaining</span>
            </button>
          )}

          {!isShiftLocked && (
            <button
              onClick={handleClearSheet}
              className="px-2.5 py-1.5 text-xs text-rose-700 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded font-medium flex items-center gap-1 transition-colors"
              title="Clear all rows for this shift"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Clear Sheet</span>
            </button>
          )}

          {onExportExcel && (
            <button
              onClick={onExportExcel}
              className="px-3 py-1.5 text-xs font-semibold text-slate-800 hover:text-slate-950 bg-emerald-100 hover:bg-emerald-200/80 border border-emerald-300 rounded flex items-center gap-1.5 transition-colors shadow-2xs"
            >
              <Download className="w-3.5 h-3.5 text-emerald-700" />
              <span>Export to Excel (.xlsx)</span>
            </button>
          )}

          {!isShiftLocked && hasUnsavedDraft && onDiscardDraft && (
            <div className="flex items-center gap-2 bg-amber-100 text-amber-900 border border-amber-300 px-3 py-1 rounded text-xs font-medium">
              <span>Unsaved local draft</span>
              <button
                type="button"
                onClick={onDiscardDraft}
                disabled={isSaving}
                className="underline hover:text-amber-950 ml-1 disabled:opacity-50"
              >
                Discard
              </button>
            </div>
          )}

          {isShiftLocked ? (
            <div
              className="px-4 py-1.5 text-xs font-bold rounded flex items-center gap-1.5 bg-slate-200 text-slate-600 border border-slate-300 cursor-not-allowed"
              title={shiftLock?.reason || 'Shift is locked'}
            >
              <span>🔒 Shift Locked</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleSaveWithValidation}
              disabled={isSaving}
              className={`px-4 py-1.5 text-xs font-bold rounded flex items-center gap-1.5 transition-colors shadow-xs disabled:opacity-60 disabled:cursor-not-allowed ${
                unbalancedCount > 0
                  ? 'bg-rose-600 hover:bg-rose-700 text-white ring-2 ring-rose-300 ring-offset-1'
                  : hasUnsavedChanges
                  ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 ring-2 ring-amber-300 ring-offset-1'
                  : 'bg-slate-900 hover:bg-slate-800 text-white'
              }`}
            >
              {isSaving ? (
                <span>Saving to Cloud...</span>
              ) : unbalancedCount > 0 ? (
                <>
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Save Shift Log ({unbalancedCount} Error{unbalancedCount > 1 ? 's' : ''})</span>
                </>
              ) : hasUnsavedChanges ? (
                <>
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Save Shift Log *</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Shift Log Synced</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Quick Breakdown Entry & Line-Wide Bulk Action Strip: Hidden when Shift is Locked */}
      {!isShiftLocked && (
        <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-3 text-xs shadow-2xs">
          {/* Left: Context-Sensitive Quick-Add Buttons for the Focused BD Cell */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-bold text-slate-700 flex items-center gap-1 mr-1">
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              <span>Quick BD:</span>
            </span>

            {/* Machine Selector */}
            <div className="flex items-center gap-1 bg-slate-100 rounded px-2 py-0.5 border border-slate-300">
              <span className="text-[11px] font-semibold text-slate-500">Machine:</span>
              <select
                value={activeBdCell.rowIndex}
                onChange={(e) =>
                  setActiveBdCell({
                    rowIndex: Number(e.target.value),
                    field: activeBdCell.field,
                  })
                }
                className="bg-transparent font-bold text-slate-900 text-xs focus:outline-none cursor-pointer"
              >
                {rows.map((r, i) => (
                  <option key={r.machineId || i} value={i}>
                    #{r.srNo} {r.machineName}
                  </option>
                ))}
              </select>
            </div>

            {/* Breakdown Field Pills */}
            <div className="flex items-center gap-1">
              {BD_KEYS.map((k) => {
                const isSelected = activeBdCell.field === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() =>
                      setActiveBdCell({
                        rowIndex: activeBdCell.rowIndex,
                        field: k,
                      })
                    }
                    className={`px-2 py-0.5 rounded text-xs font-bold transition-all cursor-pointer border ${
                      isSelected
                        ? `${BD_META[k].pillClass} ring-2 ring-blue-300 shadow-2xs`
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {BD_META[k].shortLabel}
                  </button>
                );
              })}
            </div>

            {/* 1-Click Adjust Buttons: Always available */}
            {[5, 10, 15, 30, 45, 60].map((mins) => (
              <button
                key={mins}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleQuickAdjustBd(mins, 'add');
                }}
                onClick={() => handleQuickAdjustBd(mins, 'add')}
                className="px-2 py-1 bg-slate-100 hover:bg-slate-900 hover:text-white text-slate-800 font-mono font-bold rounded border border-slate-300 transition-colors cursor-pointer"
              >
                +{mins}m
              </button>
            ))}

            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                handleQuickAdjustBd(-5, 'add');
              }}
              onClick={() => handleQuickAdjustBd(-5, 'add')}
              className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono font-semibold rounded border border-slate-300 cursor-pointer"
            >
              -5m
            </button>

            {focusedRowBalance && (focusedRowBalance.isOver || focusedRowBalance.isProductionExceeded) && (
              <span className="px-2.5 py-1 bg-rose-100 text-rose-800 font-mono font-bold rounded border border-rose-300 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                <span>
                  Exceeds Shift by {Math.abs(focusedRowBalance.unaccountedMinutes)}m ({focusedRowBalance.totalAccountedMinutes}m / {focusedRowBalance.shiftMinutes}m)
                </span>
              </span>
            )}

            {focusedRowBalance && focusedRowBalance.unaccountedMinutes > 0 && (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleFillUnaccountedBd(activeBdCell.rowIndex, activeBdCell.field);
                }}
                onClick={() => handleFillUnaccountedBd(activeBdCell.rowIndex, activeBdCell.field)}
                className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-mono font-bold rounded shadow-2xs flex items-center gap-1 cursor-pointer animate-pulse"
                title="Fill exact remaining unaccounted shift minutes into this cell"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>+Fill Balance ({focusedRowBalance.unaccountedMinutes}m)</span>
              </button>
            )}

            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                handleQuickAdjustBd(0, 'set');
              }}
              onClick={() => handleQuickAdjustBd(0, 'set')}
              className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold rounded border border-rose-200 cursor-pointer"
            >
              Clear (0)
            </button>
          </div>

          {/* Right: Line-Wide Bulk Breakdown Applier */}
          <div className="flex items-center gap-1.5 border-t sm:border-t-0 sm:border-l border-slate-200 pt-2 sm:pt-0 sm:pl-3 w-full sm:w-auto">
            <span className="font-semibold text-slate-600 whitespace-nowrap">Line-Wide BD:</span>
            <select
              value={bulkBdField}
              onChange={(e) => setBulkBdField(e.target.value as BreakdownKey)}
              className="border border-slate-300 rounded px-2 py-1 text-xs bg-slate-50 font-medium text-slate-800 focus:outline-none focus:border-slate-800"
            >
              <option value="power">POWER (All Machines)</option>
              <option value="noDisc">NO/DISC (All Machines)</option>
              <option value="change">CHANGE (All Machines)</option>
              <option value="operator">OPERATOR (All Machines)</option>
            </select>
            <input
              type="number"
              min="1"
              step="5"
              placeholder="Mins"
              value={bulkBdMinutes}
              onChange={(e) => setBulkBdMinutes(e.target.value)}
              className="w-16 border border-slate-300 rounded px-2 py-1 text-xs font-mono text-center focus:outline-none focus:border-slate-800"
            />
            <button
              type="button"
              onClick={handleApplyBulkLineBd}
              disabled={!bulkBdMinutes || Number(bulkBdMinutes) <= 0}
              className="bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white px-2.5 py-1 rounded text-xs font-semibold whitespace-nowrap transition-colors"
            >
              + Apply to All
            </button>
          </div>
        </div>
      )}

      {/* Interactive Paper Log Sheet (Grouped Table) */}
      <div className="bg-white rounded-lg border border-slate-300 shadow-xs overflow-hidden">
        <div className="overflow-x-auto max-w-full">
          <table className="w-full text-xs text-left border-collapse select-none min-w-310">
            {/* Exact Grouped Table Header */}
            <thead>
              <tr className="bg-slate-900 text-slate-100 border-b border-slate-800 text-[11px] uppercase tracking-wider font-semibold">
                <th rowSpan={2} className="px-2.5 py-2.5 border-r border-slate-800 text-center w-12">
                  SR. NO
                </th>
                <th rowSpan={2} className="px-3 py-2.5 border-r border-slate-800 min-w-35">
                  MACHINE
                </th>
                <th rowSpan={2} className="px-2.5 py-2.5 border-r border-slate-800 min-w-37.5">
                  NAME OF OPERATOR
                </th>
                <th rowSpan={2} className="px-2.5 py-2.5 border-r border-slate-800 min-w-42.5">
                  ITEM
                </th>
                <th rowSpan={2} className="px-2.5 py-2.5 border-r border-slate-800 min-w-42.5">
                  OPERATION
                </th>
                <th rowSpan={2} className="px-2 py-2.5 border-r border-slate-800 text-center w-22">
                  CYCLE TIME
                </th>
                <th rowSpan={2} className="px-2 py-2.5 border-r border-slate-800 text-center w-20">
                  STD O/PUT
                </th>
                <th rowSpan={2} className="px-2 py-2.5 border-r border-slate-800 text-center w-20 bg-slate-800">
                  ACT. O/PUT
                </th>
                <th rowSpan={2} className="px-2 py-2.5 border-r border-slate-800 text-center w-18">
                  RE-WORK
                </th>
                <th
                  colSpan={4}
                  className="px-2 py-1.5 border-r border-slate-800 text-center bg-slate-800 text-amber-300 font-bold tracking-normal"
                >
                  BREAKDOWN (MINUTES)
                </th>
                <th rowSpan={2} className="px-2 py-2.5 border-r border-slate-800 text-center w-24 bg-slate-800 text-amber-200">
                  TOTAL BD
                </th>
                <th rowSpan={2} className="px-2.5 py-2.5 border-r border-slate-800 min-w-42.5">
                  REMARKS
                </th>
                <th rowSpan={2} className="px-2 py-2.5 border-r border-slate-800 text-center w-24">
                  EFFICIENCY %
                </th>
                <th rowSpan={2} className="px-2 py-2.5 text-center w-14">
                  KIOSK
                </th>
              </tr>
              <tr className="bg-slate-800 text-slate-300 border-b border-slate-700 text-[10px] font-bold text-center">
                <th className="px-1.5 py-1 border-r border-slate-700 w-16" title="Disc or raw material shortage">
                  NO/DISC
                </th>
                <th className="px-1.5 py-1 border-r border-slate-700 w-16" title="Tool change / setup time">
                  CHANGE
                </th>
                <th className="px-1.5 py-1 border-r border-slate-700 w-16" title="Power interruption">
                  POWER
                </th>
                <th className="px-1.5 py-1 border-r border-slate-800 w-16" title="Operator delay / absentee">
                  OPERATOR
                </th>
              </tr>
            </thead>

            {/* Table Rows (16 fixed machine rows) */}
            <tbody className="divide-y divide-slate-200">
              {rows.map((row, index) => {
                const hasTarget = row.stdOutput > 0;
                const efficiency = hasTarget ? calculateEfficiency(row.actualOutput, row.stdOutput) : 0;
                const isUnderperforming = hasTarget && row.actualOutput < row.stdOutput;
                const isRowConfigured = !!row.operatorName && !!row.itemName;
                const rowOperations = row.itemId
                  ? getOperationsForItem(row.itemId, items, cycleTimes, row.machineId, row.machineName)
                  : [];
                const rowWorkingMinutes = row.totalWorkingMinutes || shiftWorkingMinutes;
                const pct = (mins: number) => calculateDowntimePct(mins, rowWorkingMinutes);

                const rowShiftMins = shiftWorkingMinutes || row.totalWorkingMinutes;
                const timeBalance = calculateShiftTimeBalance(row, rowShiftMins);
                const isRowActive =
                  !!row.itemId ||
                  !!row.operatorName ||
                  (row.actualOutput || 0) > 0 ||
                  calculateTotalBreakdown(row.breakdown) > 0 ||
                  (row.cycleTime || 0) > 0;
                const isRowInvalid = isRowActive && !timeBalance.isBalanced;

                return (
                  <tr
                    key={row.id || index}
                    className={`transition-colors ${
                      isRowInvalid
                        ? timeBalance.missingCycleTime || timeBalance.isProductionExceeded || timeBalance.isOver
                          ? 'bg-rose-50/70 hover:bg-rose-100/60 border-l-4 border-l-rose-600'
                          : 'bg-amber-50/50 hover:bg-amber-100/50 border-l-4 border-l-amber-500'
                        : isRowActive && timeBalance.isBalanced
                        ? 'border-l-4 border-l-emerald-500 hover:bg-emerald-50/20'
                        : isUnderperforming
                        ? 'border-l-2 border-l-amber-400 hover:bg-slate-50/80'
                        : index % 2 === 0
                        ? 'bg-white hover:bg-slate-50/80'
                        : 'bg-slate-50/40 hover:bg-slate-50/80'
                    }`}
                  >
                    {/* 1. SR. NO */}
                    <td className="px-2 py-2 text-center font-mono font-semibold text-slate-600 border-r border-slate-200">
                      {row.srNo}
                    </td>

                    {/* 2. MACHINE */}
                    <td className="px-3 py-2 font-semibold text-slate-900 border-r border-slate-200 whitespace-nowrap">
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5">
                          <span>{row.machineName}</span>
                          {isRowInvalid ? (
                            <span
                              className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                timeBalance.missingCycleTime || timeBalance.isProductionExceeded || timeBalance.isOver
                                  ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                  : 'bg-amber-100 text-amber-900 border border-amber-300'
                              }`}
                              title={timeBalance.errorMessage}
                            >
                              <AlertTriangle className="w-3 h-3 shrink-0" />
                              <span>
                                {timeBalance.missingCycleTime
                                  ? 'No Cycle Time'
                                  : timeBalance.isProductionExceeded
                                  ? 'Exceeds Shift'
                                  : timeBalance.isOver
                                  ? 'Over Time'
                                  : 'Missing Time'}
                              </span>
                            </span>
                          ) : isRowActive && timeBalance.isBalanced ? (
                            <span
                              className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300"
                              title={`Balanced: Productive (${timeBalance.productionMinutes}m) + BD (${timeBalance.loggedBreakdownMinutes}m) = ${timeBalance.shiftMinutes}m`}
                            >
                              <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                              <span>OK</span>
                            </span>
                          ) : isRowConfigured ? (
                            <span
                              className="w-1.5 h-1.5 rounded-full bg-slate-400"
                              title="Configured"
                            />
                          ) : null}
                        </div>
                      </div>
                    </td>

                    {/* 3. NAME OF OPERATOR */}
                    <td className="px-1.5 py-1 border-r border-slate-200">
                      <select
                        value={row.operatorName}
                        disabled={isShiftLocked}
                        onChange={(e) => updateRow(index, { operatorName: e.target.value })}
                        className={`w-full bg-transparent px-1.5 py-1 rounded border border-transparent ${
                          isShiftLocked
                            ? 'cursor-not-allowed opacity-75'
                            : 'hover:border-slate-300 focus:border-slate-800 focus:bg-white cursor-pointer'
                        } text-xs font-medium text-slate-900 focus:outline-none`}
                      >
                        <option value="">— Select Operator —</option>
                        {operators.map((op) => (
                          <option key={op} value={op}>
                            {op}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* 4. ITEM */}
                    <td className="px-1.5 py-1 border-r border-slate-200">
                      <select
                        value={row.itemId}
                        disabled={isShiftLocked}
                        onChange={(e) => handleItemChange(index, e.target.value)}
                        className={`w-full bg-transparent px-1.5 py-1 rounded border border-transparent ${
                          isShiftLocked
                            ? 'cursor-not-allowed opacity-75'
                            : 'hover:border-slate-300 focus:border-slate-800 focus:bg-white cursor-pointer'
                        } text-xs text-slate-900 font-medium focus:outline-none`}
                      >
                        <option value="">— Select Item —</option>
                        {items.map((item) => (
                          <option key={item.id} value={item.id}>
                            {`${item.itemName} (${item.itemCode})`}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* 5. OPERATION */}
                    <td className="px-1.5 py-1 border-r border-slate-200">
                      {!row.itemId ? (
                        <span className="block px-2 py-1 text-xs text-slate-400 italic">
                          — Select Item First —
                        </span>
                      ) : rowOperations.length > 1 ? (
                        <select
                          value={row.operation}
                          disabled={isShiftLocked}
                          onChange={(e) => handleOperationChange(index, e.target.value)}
                          className={`w-full bg-transparent px-1.5 py-1 rounded border border-transparent ${
                            isShiftLocked
                              ? 'cursor-not-allowed opacity-75'
                              : 'hover:border-slate-300 focus:border-slate-800 focus:bg-white cursor-pointer'
                          } text-xs text-slate-900 font-medium focus:outline-none`}
                        >
                          <option value="">— Select Operation —</option>
                          {rowOperations.map((op) => (
                            <option key={op} value={op}>
                              {op}
                            </option>
                          ))}
                          {row.operation && !rowOperations.includes(row.operation) && (
                            <option key={row.operation} value={row.operation}>
                              {row.operation}
                            </option>
                          )}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={row.operation}
                          disabled={isShiftLocked}
                          readOnly={isShiftLocked}
                          onChange={(e) => handleOperationChange(index, e.target.value)}
                          placeholder="e.g. OP-10 Turning"
                          className={`w-full bg-transparent px-2 py-1 rounded border border-transparent ${
                            isShiftLocked
                              ? 'cursor-not-allowed opacity-75'
                              : 'hover:border-slate-300 focus:border-slate-800 focus:bg-white'
                          } text-xs text-slate-800 font-medium focus:outline-none`}
                        />
                      )}
                    </td>

                    {/* 5B. CYCLE TIME (Locked for Non-Admins & When Shift is Locked) */}
                    <td className="px-1 py-1 border-r border-slate-200 text-center">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        disabled={!isAdmin || isShiftLocked}
                        readOnly={!isAdmin || isShiftLocked}
                        data-grid-cell={`${index}-cycleTime`}
                        value={row.cycleTime > 0 ? row.cycleTime : ''}
                        placeholder="—"
                        title={
                          !isAdmin
                            ? 'Cycle Time is configured in Master Data (Unit Head access required to edit manually)'
                            : isShiftLocked
                            ? 'Shift is locked (Read-Only)'
                            : timeBalance.missingCycleTime
                            ? `ERROR: Actual Output is ${row.actualOutput} pcs, but Cycle Time is 0. Enter cycle time or select configured item.`
                            : row.cycleTime > 0
                            ? `Cycle time: ${row.cycleTime}s`
                            : 'No cycle time configured for this Machine + Item + Operation in Master Data'
                        }
                        onFocus={(e) => e.target.select()}
                        onKeyDown={(e) => handleGridKeyDown(e, index, 'cycleTime')}
                        onChange={(e) => {
                          if (!isAdmin || isShiftLocked) return;
                          const newCt = parseFloat(e.target.value) || 0;
                          const newStd =
                            newCt > 0
                              ? calculateDynamicStdOutput(newCt, shiftWorkingMinutes)
                              : row.stdOutput;
                          updateRow(index, { cycleTime: newCt, stdOutput: newStd });
                        }}
                        className={`w-16 mx-auto text-center font-mono text-xs px-1 py-1 rounded border ${
                          timeBalance.missingCycleTime
                            ? 'bg-rose-100 text-rose-950 font-bold border-rose-500 ring-2 ring-rose-300 animate-pulse'
                            : row.cycleTime > 0
                            ? 'bg-blue-50/60 text-blue-900 font-bold border-blue-200'
                            : 'bg-transparent text-slate-400 border-transparent hover:border-slate-300'
                        } ${
                          !isAdmin || isShiftLocked
                            ? 'cursor-not-allowed opacity-85'
                            : 'focus:border-slate-800 focus:bg-white'
                        } focus:outline-none`}
                      />
                    </td>

                    {/* 6. STD O/PUT (Locked for Non-Admins & When Shift is Locked) */}
                    <td className="px-1 py-1 border-r border-slate-200 text-center">
                      <input
                        type="number"
                        min="0"
                        disabled={!isAdmin || isShiftLocked}
                        readOnly={!isAdmin || isShiftLocked}
                        data-grid-cell={`${index}-stdOutput`}
                        value={row.stdOutput || ''}
                        title={
                          !isAdmin
                            ? 'Std Output is auto-calculated from Cycle Time (Unit Head access required to edit manually)'
                            : isShiftLocked
                            ? 'Shift is locked (Read-Only)'
                            : undefined
                        }
                        onFocus={(e) => e.target.select()}
                        onKeyDown={(e) => handleGridKeyDown(e, index, 'stdOutput')}
                        onChange={(e) => {
                          if (!isAdmin || isShiftLocked) return;
                          updateRow(index, { stdOutput: Number(e.target.value) || 0 });
                        }}
                        className={`w-16 mx-auto text-center font-mono font-semibold text-slate-700 bg-transparent px-1 py-1 rounded border border-transparent ${
                          !isAdmin || isShiftLocked
                            ? 'cursor-not-allowed opacity-85'
                            : 'hover:border-slate-300 focus:border-slate-800 focus:bg-white'
                        } focus:outline-none`}
                      />
                    </td>

                    {/* 7. ACT. O/PUT */}
                    <td className="px-1 py-1 border-r border-slate-200 text-center bg-slate-50/80">
                      <input
                        type="number"
                        min="0"
                        disabled={isShiftLocked}
                        readOnly={isShiftLocked}
                        data-grid-cell={`${index}-actualOutput`}
                        value={row.actualOutput > 0 ? row.actualOutput : hasTarget ? 0 : ''}
                        onFocus={(e) => e.target.select()}
                        onKeyDown={(e) => handleGridKeyDown(e, index, 'actualOutput')}
                        onChange={(e) =>
                          updateRow(index, { actualOutput: Number(e.target.value) || 0 })
                        }
                        title={
                          isShiftLocked
                            ? 'Shift is locked (Read-Only)'
                            : timeBalance.missingCycleTime
                            ? `ERROR: Actual output (${row.actualOutput} pcs) entered, but cycle time is 0!`
                            : timeBalance.isProductionExceeded
                            ? `ERROR: Actual output (${row.actualOutput} pcs × ${row.cycleTime}m = ${timeBalance.productionMinutes}m) alone exceeds shift duration (${timeBalance.shiftMinutes}m)!`
                            : undefined
                        }
                        className={`w-16 mx-auto text-center font-mono font-bold px-1 py-1 rounded border ${
                          timeBalance.isProductionExceeded || timeBalance.missingCycleTime
                            ? 'bg-rose-100 text-rose-900 border-rose-500 ring-2 ring-rose-300'
                            : timeBalance.isOver
                            ? 'bg-rose-50 text-rose-900 border-rose-400'
                            : isUnderperforming
                            ? 'bg-amber-50 text-amber-900 border-amber-300'
                            : efficiency >= 90 && hasTarget
                            ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                            : 'bg-white text-slate-900 border-slate-200'
                        } ${
                          isShiftLocked ? 'cursor-not-allowed opacity-75' : 'focus:border-slate-800'
                        } focus:outline-none`}
                      />
                    </td>

                    {/* 8. RE-WORK */}
                    <td className="px-1 py-1 border-r border-slate-200 text-center">
                      <input
                        type="number"
                        min="0"
                        disabled={isShiftLocked}
                        readOnly={isShiftLocked}
                        data-grid-cell={`${index}-rework`}
                        value={row.rework > 0 ? row.rework : ''}
                        placeholder="0"
                        onFocus={(e) => e.target.select()}
                        onKeyDown={(e) => handleGridKeyDown(e, index, 'rework')}
                        onChange={(e) =>
                          updateRow(index, { rework: Number(e.target.value) || 0 })
                        }
                        className={`w-14 mx-auto text-center font-mono px-1 py-1 rounded border ${
                          row.rework > 0
                            ? 'bg-rose-50 text-rose-800 border-rose-200 font-bold'
                            : 'text-slate-600 border-transparent hover:border-slate-300'
                        } ${
                          isShiftLocked ? 'cursor-not-allowed opacity-75' : 'focus:border-slate-800 focus:bg-white'
                        } focus:outline-none`}
                      />
                    </td>

                    {/* 9. BREAKDOWN SUB-COLUMNS (NO/DISC, CHANGE, POWER, OPERATOR) */}
                    {BD_KEYS.map((bdKey) => {
                      const val = Number(row.breakdown?.[bdKey] ?? 0);
                      const isFocused =
                        activeBdCell?.rowIndex === index && activeBdCell?.field === bdKey;

                      return (
                        <td
                          key={bdKey}
                          className={`px-1 py-1 border-r border-slate-200 text-center transition-colors ${
                            isFocused ? 'bg-blue-50/40' : ''
                          }`}
                        >
                          <input
                            type="number"
                            min="0"
                            step="5"
                            disabled={isShiftLocked}
                            readOnly={isShiftLocked}
                            data-grid-cell={`${index}-${bdKey}`}
                            value={val > 0 ? val : ''}
                            placeholder="0"
                            onFocus={(e) => {
                              e.target.select();
                              setActiveBdCell({ rowIndex: index, field: bdKey });
                            }}
                            onKeyDown={(e) => handleGridKeyDown(e, index, bdKey)}
                            onChange={(e) =>
                              handleBreakdownChange(index, bdKey, Number(e.target.value))
                            }
                            className={`w-13 mx-auto text-center font-mono text-xs px-1 py-1 rounded border transition-colors focus:outline-none ${
                              isShiftLocked
                                ? 'cursor-not-allowed opacity-75 border-transparent bg-transparent text-slate-500'
                                : isFocused
                                ? 'border-blue-600 ring-2 ring-blue-200 bg-white font-bold text-slate-900'
                                : val > 0
                                ? BD_META[bdKey].activeCellClass
                                : 'text-slate-400 border-transparent hover:border-slate-300 bg-transparent'
                            }`}
                          />
                          {val > 0 && (
                            <div className="text-[10px] leading-none text-slate-500 font-normal mt-0.5">
                              ({pct(val)}%)
                            </div>
                          )}
                        </td>
                      );
                    })}

                    {/* TOTAL BD & SHIFT TIME BALANCE (Click badge to auto-fill remaining balance) */}
                    <td className={`px-2 py-1 border-r border-slate-200 text-center font-mono text-xs ${
                      !isRowActive
                        ? 'bg-slate-50/60'
                        : isRowInvalid
                        ? timeBalance.missingCycleTime || timeBalance.isProductionExceeded || timeBalance.isOver
                          ? 'bg-rose-50/80'
                          : 'bg-amber-50/80'
                        : 'bg-emerald-50/30'
                    }`}>
                      {!isRowActive ? (
                        <span className="text-slate-400 font-normal">0</span>
                      ) : (
                        <div className="leading-tight space-y-0.5">
                          <div className="font-bold text-slate-900 flex items-center justify-center gap-1">
                            <span>{timeBalance.loggedBreakdownMinutes}m / {timeBalance.requiredBreakdownMinutes}m</span>
                          </div>
                          <div className="text-[10px] text-slate-500 font-normal">
                            Total: {timeBalance.totalAccountedMinutes}m / {timeBalance.shiftMinutes}m
                          </div>
                          {timeBalance.missingCycleTime ? (
                            <span
                              className="inline-block px-1.5 py-0.5 rounded bg-rose-200 text-rose-950 font-extrabold text-[10px] border border-rose-400 shadow-2xs"
                              title={timeBalance.errorMessage}
                            >
                              ⚠️ Set Cycle Time
                            </span>
                          ) : timeBalance.isProductionExceeded ? (
                            <span
                              className="inline-block px-1.5 py-0.5 rounded bg-rose-200 text-rose-950 font-extrabold text-[10px] border border-rose-400 shadow-2xs"
                              title={timeBalance.errorMessage}
                            >
                              ⚠️ Prod Time &gt; Shift ({timeBalance.productionMinutes}m &gt; {timeBalance.shiftMinutes}m)
                            </span>
                          ) : timeBalance.isOver ? (
                            <span
                              className="inline-block px-1.5 py-0.5 rounded bg-rose-100 text-rose-900 font-extrabold text-[10px] border border-rose-300 shadow-2xs"
                              title={timeBalance.errorMessage}
                            >
                              ⚠️ Exceeds Shift (+{Math.abs(timeBalance.unaccountedMinutes)}m)
                            </span>
                          ) : timeBalance.unaccountedMinutes > 0 ? (
                            <button
                              type="button"
                              disabled={isShiftLocked}
                              onClick={() => !isShiftLocked && handleFillUnaccountedBd(index)}
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-bold text-[10px] transition-colors border shadow-2xs ${
                                isShiftLocked
                                  ? 'bg-slate-100 text-slate-500 border-slate-200 cursor-not-allowed'
                                  : 'bg-amber-100 hover:bg-amber-200 text-amber-900 border-amber-300 cursor-pointer'
                              }`}
                              title={
                                isShiftLocked
                                  ? 'Shift is locked (Read-Only)'
                                  : `Productive time (${timeBalance.productionMinutes}m) + Breakdown (${timeBalance.loggedBreakdownMinutes}m) = ${timeBalance.totalAccountedMinutes}m. Click to auto-fill +${timeBalance.unaccountedMinutes}m into ${
                                      activeBdCell?.rowIndex === index
                                        ? BD_META[activeBdCell.field].shortLabel
                                        : 'NO/DISC'
                                    } so total time equals ${timeBalance.shiftMinutes}m`
                              }
                            >
                              <span>{isShiftLocked ? '🔒' : '⚠️'} Missing {timeBalance.unaccountedMinutes}m BD</span>
                              {!isShiftLocked && <span className="underline font-extrabold">(+Fill)</span>}
                            </button>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px] border border-emerald-300">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              <span>{timeBalance.shiftMinutes}m Balanced</span>
                            </span>
                          )}
                        </div>
                      )}
                    </td>

                    {/* 10. REMARKS */}
                    <td className="px-2 py-1 border-r border-slate-200">
                      <input
                        type="text"
                        disabled={isShiftLocked}
                        readOnly={isShiftLocked}
                        value={row.remarks}
                        onChange={(e) => updateRow(index, { remarks: e.target.value })}
                        placeholder="Notes / tool issues..."
                        className={`w-full bg-transparent px-2 py-1 rounded border border-transparent ${
                          isShiftLocked
                            ? 'cursor-not-allowed opacity-75'
                            : 'hover:border-slate-300 focus:border-slate-800 focus:bg-white'
                        } text-xs text-slate-800 focus:outline-none`}
                      />
                    </td>

                    {/* 11. EFFICIENCY % */}
                    <td className="px-2 py-2 text-center border-r border-slate-200 font-mono">
                      {!hasTarget ? (
                        <span className="text-slate-400 font-normal">—</span>
                      ) : (
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
                            efficiency >= 90
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : efficiency >= 75
                              ? 'bg-amber-100 text-amber-800 border border-amber-300'
                              : 'bg-rose-100 text-rose-800 border border-rose-300'
                          }`}
                        >
                          {efficiency}%
                        </span>
                      )}
                    </td>

                    {/* ACTION / KIOSK LINK */}
                    <td className="px-2 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => onOpenMachineInKiosk?.(row.machineId)}
                        title={`Open ${row.machineName} in Operator Kiosk`}
                        className="p-1 text-slate-400 hover:text-slate-900 hover:bg-slate-200 rounded transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>

            {/* Exact Grouped Summary Footer */}
            <tfoot>
              <tr className="bg-slate-900 text-slate-100 font-bold border-t-2 border-slate-700 text-xs">
                <td colSpan={2} className="px-3 py-3 border-r border-slate-800 text-left">
                  SHIFT TOTALS ({activeMachineCount} Active Machines)
                </td>
                <td className="px-2 py-3 border-r border-slate-800 text-slate-400 font-normal">
                  —
                </td>
                <td className="px-2 py-3 border-r border-slate-800 text-slate-400 font-normal">
                  —
                </td>
                <td className="px-2 py-3 border-r border-slate-800 text-slate-400 font-normal">
                  —
                </td>
                <td className="px-2 py-3 border-r border-slate-800 text-center text-slate-400 font-normal">
                  —
                </td>
                <td className="px-2 py-3 border-r border-slate-800 text-center font-mono text-slate-200">
                  {totalStd}
                </td>
                <td className="px-2 py-3 border-r border-slate-800 text-center font-mono text-emerald-400 bg-slate-800">
                  {totalAct}
                </td>
                <td className="px-2 py-3 border-r border-slate-800 text-center font-mono text-rose-400">
                  {totalRework}
                </td>
                <td className="px-1 py-3 border-r border-slate-800 text-center font-mono text-amber-300">
                  {totalNoDisc}m
                  {renderFooterPct(totalNoDisc)}
                </td>
                <td className="px-1 py-3 border-r border-slate-800 text-center font-mono text-sky-300">
                  {totalChange}m
                  {renderFooterPct(totalChange)}
                </td>
                <td className="px-1 py-3 border-r border-slate-800 text-center font-mono text-rose-300">
                  {totalPower}m
                  {renderFooterPct(totalPower)}
                </td>
                <td className="px-1 py-3 border-r border-slate-800 text-center font-mono text-purple-300">
                  {totalOperator}m
                  {renderFooterPct(totalOperator)}
                </td>
                <td className="px-2 py-3 border-r border-slate-800 text-center font-mono text-amber-400 bg-slate-800">
                  {grandBreakdown}m
                  {renderFooterPct(grandBreakdown)}
                </td>
                <td className="px-2 py-3 border-r border-slate-800 text-xs">
                  <div className="text-slate-300 font-semibold">
                    Variance: {totalAct - totalStd >= 0 ? `+${totalAct - totalStd}` : `${totalAct - totalStd}`} pcs
                  </div>
                  {unbalancedCount > 0 ? (
                    <div className="mt-1 text-rose-300 font-bold flex items-center gap-1 text-[11px]">
                      <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
                      <span>{unbalancedCount} row{unbalancedCount > 1 ? 's' : ''} have time mismatches</span>
                    </div>
                  ) : activeRows.length > 0 ? (
                    <div className="mt-1 text-emerald-400 font-semibold flex items-center gap-1 text-[11px]">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                      <span>All rows balanced ({shiftWorkingMinutes}m)</span>
                    </div>
                  ) : null}
                </td>
                <td className="px-2 py-3 border-r border-slate-800 text-center font-mono text-sm">
                  <span
                    className={`inline-block px-2 py-0.5 rounded ${
                      overallEfficiency >= 90
                        ? 'bg-emerald-500 text-slate-950 font-extrabold'
                        : overallEfficiency >= 75
                        ? 'bg-amber-400 text-slate-950 font-extrabold'
                        : 'bg-rose-500 text-white font-extrabold'
                    }`}
                  >
                    {overallEfficiency}%
                  </span>
                </td>
                <td className="px-2 py-3"></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Legend & Factory Supervisor Instructions */}
        <div className="bg-slate-50 border-t border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-600">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="font-semibold text-slate-700 flex items-center gap-1">
              <Info className="w-3.5 h-3.5 text-slate-400" /> Efficiency Thresholds:
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded bg-emerald-500 inline-block" />
              <span>Target Met: <strong>≥ 90%</strong></span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded bg-amber-500 inline-block" />
              <span>Moderate: <strong>75% – 89%</strong></span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded bg-rose-500 inline-block" />
              <span>Critical Shortfall: <strong>&lt; 75%</strong></span>
            </span>
          </div>

          <div className="text-slate-500 text-[11px]">
            Arrow Keys / Enter / TAB navigate cells. Click &apos;+Fill&apos; badge to auto-balance shift minutes.
          </div>
        </div>
      </div>
    </div>
  );
};

export default DailyShiftSheet;