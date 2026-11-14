"use client";
import React, { useState, useEffect, useMemo } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  User,
  Package,
  Wrench,
  ArrowLeft,
  ArrowRight,
  Plus,
  Minus,
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
  calculateShiftTimeBalance,
  calculateDowntimePct,
  getOperationsForItem,
  resolveMachineItemTarget,
} from '@/services/storageService';

interface OperatorKioskProps {
  masterData: MasterDataState;
  rows: MachineShiftRow[];
  selectedDate: string;
  selectedShift: ShiftType;
  selectedLine: string;
  onSaveMachine: (updatedRow: MachineShiftRow) => void;
  isSaving?: boolean;
  selectedMachineId?: string | null;
  onSelectMachineId?: (machineId: string | null) => void;
  isAdmin?: boolean;
  isReadOnly?: boolean;
  isShiftLocked?: boolean;
  shiftLock?: ShiftLockInfo;
}

export function OperatorKiosk({
  masterData,
  rows,
  selectedDate,
  selectedShift,
  selectedLine,
  onSaveMachine,
  isSaving = false,
  selectedMachineId: externalMachineId,
  onSelectMachineId: externalOnSelectMachineId,
  isAdmin = false,
  isReadOnly,
  isShiftLocked: externalShiftLocked = false,
  shiftLock,
}: OperatorKioskProps) {
  const isShiftLocked = isReadOnly !== undefined ? isReadOnly : externalShiftLocked;
  const { machines, operators, items } = masterData;
  const cycleTimes = useMemo(() => masterData.cycleTimes ?? [], [masterData.cycleTimes]);

  // Internal state fallback if DashboardClient doesn't pass selectedMachineId
  const [internalMachineId, setInternalMachineId] = useState<string | null>(null);

  const selectedMachineId =
    externalMachineId !== undefined ? externalMachineId : internalMachineId;

  const onSelectMachineId = (machineId: string | null) => {
    if (externalOnSelectMachineId) {
      externalOnSelectMachineId(machineId);
    } else {
      setInternalMachineId(machineId);
    }
  };

  const [draft, setDraft] = useState<MachineShiftRow | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState(false);

  // Fetched from public.shifts in Supabase (matches displayName or shiftCode)
  const activeShiftObj = masterData.shifts?.find(
    (s) => s.displayName === selectedShift || s.shiftCode === selectedShift
  );
  const shiftWorkingMinutes =
    activeShiftObj?.shiftWorkingMinutes ??
    rows[0]?.totalWorkingMinutes ??
    0;

  // Filter machines for current production line
  const lineMachines = useMemo(
    () => machines.filter((m) => (m.line || 'Line 1') === selectedLine),
    [machines, selectedLine]
  );

  // Sync draft when selectedMachineId changes (and auto-hydrate cycleTime if missing)
  useEffect(() => {
    if (!selectedMachineId) {
      setDraft(null);
      setValidationError(null);
      return;
    }

    const existingRow = rows.find((r) => r.machineId === selectedMachineId);
    const machine = machines.find((m) => m.id === selectedMachineId);

    if (existingRow) {
      setDraft((prev) => {
        const baseRow =
          !isShiftLocked &&
          prev &&
          prev.machineId === existingRow.machineId &&
          prev.date === existingRow.date &&
          prev.shift === existingRow.shift &&
          prev.line === selectedLine
            ? prev
            : {
                ...existingRow,
                line: selectedLine,
                totalWorkingMinutes:
                  shiftWorkingMinutes || existingRow.totalWorkingMinutes,
              };

        // If item is already set but cycleTime is 0, auto-resolve from masterData.cycleTimes (only when editable)
        if (!isShiftLocked && baseRow.itemId && !(baseRow.cycleTime > 0) && cycleTimes.length > 0) {
          const target = resolveMachineItemTarget(
            baseRow.machineId,
            baseRow.itemId,
            items,
            cycleTimes,
            baseRow.operation || undefined,
            shiftWorkingMinutes,
            baseRow.machineName
          );
          if (target.cycleTime > 0) {
            return {
              ...baseRow,
              operation: baseRow.operation || target.operation,
              cycleTime: target.cycleTime,
              stdOutput: target.stdOutput || baseRow.stdOutput,
            };
          }
        }
        return baseRow;
      });
    } else if (machine) {
      setDraft((prev) => {
        if (
          prev &&
          prev.machineId === machine.id &&
          prev.date === selectedDate &&
          prev.shift === selectedShift &&
          prev.line === selectedLine
        ) {
          return prev;
        }
        const idx = lineMachines.findIndex((m) => m.id === machine.id);

        return {
          id: `${selectedDate}_${selectedShift}_${selectedLine}_${machine.id}`,
          date: selectedDate,
          shift: selectedShift,
          line: selectedLine,
          srNo: idx >= 0 ? idx + 1 : 1,
          machineId: machine.id,
          machineName: machine.name,
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
        };
      });
    }
    setValidationError(null);
  }, [
    selectedMachineId,
    rows,
    machines,
    lineMachines,
    selectedDate,
    selectedShift,
    selectedLine,
    shiftWorkingMinutes,
    items,
    cycleTimes,
    isShiftLocked,
  ]);

  // 1. When Item changes in draft: auto-set Operation, Cycle Time, and Std Output
  const handleItemSelect = (itemId: string) => {
    if (isShiftLocked || !draft) return;
    setValidationError(null);

    if (!itemId) {
      setDraft({
        ...draft,
        itemId: '',
        itemName: '',
        operation: '',
        cycleTime: 0,
        stdOutput: 0,
      });
      return;
    }

    const target = resolveMachineItemTarget(
      draft.machineId,
      itemId,
      items,
      cycleTimes,
      undefined,
      shiftWorkingMinutes,
      draft.machineName
    );

    setDraft({
      ...draft,
      itemId,
      itemName: target.itemName,
      operation: target.operation,
      cycleTime: target.cycleTime,
      stdOutput: target.stdOutput,
      totalWorkingMinutes: shiftWorkingMinutes || draft.totalWorkingMinutes,
    });
  };

  // 2. When Operation changes in draft: re-fetch Cycle Time & Std Output for (Machine + Item + Operation)
  const handleOperationSelect = (operationName: string) => {
    if (isShiftLocked || !draft) return;
    setValidationError(null);

    if (!draft.itemId) {
      setDraft({ ...draft, operation: operationName });
      return;
    }

    const target = resolveMachineItemTarget(
      draft.machineId,
      draft.itemId,
      items,
      cycleTimes,
      operationName,
      shiftWorkingMinutes,
      draft.machineName
    );

    setDraft({
      ...draft,
      operation: operationName,
      cycleTime: target.cycleTime,
      stdOutput: target.stdOutput,
      totalWorkingMinutes: shiftWorkingMinutes || draft.totalWorkingMinutes,
    });
  };

  const handleAdjustActual = (delta: number) => {
    if (isShiftLocked || !draft) return;
    setValidationError(null);
    const newVal = Math.max(0, (draft.actualOutput || 0) + delta);
    setDraft({ ...draft, actualOutput: newVal });
  };

  const handleAdjustRework = (delta: number) => {
    if (isShiftLocked || !draft) return;
    const newVal = Math.max(0, (draft.rework || 0) + delta);
    setDraft({ ...draft, rework: newVal });
  };

  const handleBreakdownStep = (
    field: 'noDisc' | 'change' | 'power' | 'operator',
    delta: number
  ) => {
    if (isShiftLocked || !draft) return;
    setValidationError(null);
    const currentVal = Number(draft.breakdown?.[field]) || 0;
    const nextVal = Math.max(0, currentVal + delta);
    setDraft({
      ...draft,
      breakdown: {
        ...draft.breakdown,
        [field]: nextVal,
      },
    });
  };

  const handleFillUnaccountedToField = (
    field: 'noDisc' | 'change' | 'power' | 'operator',
    unaccountedMins: number
  ) => {
    if (isShiftLocked || !draft || unaccountedMins <= 0) return;
    setValidationError(null);
    const currentVal = Number(draft.breakdown?.[field]) || 0;
    setDraft({
      ...draft,
      breakdown: {
        ...draft.breakdown,
        [field]: Math.max(0, currentVal + unaccountedMins),
      },
    });
  };

  const handleQuickRemark = (chip: string) => {
    if (isShiftLocked || !draft) return;
    const existing = draft.remarks ? draft.remarks + '; ' : '';
    setDraft({ ...draft, remarks: existing + chip });
  };

  // Submission with strict Shift Time Balance validation (same as DailyShiftSheet)
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isShiftLocked || !draft) return;

    if (!draft.operatorName) {
      setValidationError('Please select the operator name for this machine.');
      return;
    }

    if (!draft.itemId) {
      setValidationError('Please select the item/component being machined.');
      return;
    }

    const rowShiftMins = shiftWorkingMinutes || draft.totalWorkingMinutes;
    const balance = calculateShiftTimeBalance(draft, rowShiftMins);

    if (!balance.isBalanced) {
      if (balance.missingCycleTime) {
        setValidationError(
          `Cycle Time is 0! Actual output (${draft.actualOutput} pcs) was entered, but Cycle Time is missing. Please enter Cycle Time or select a configured Item.`
        );
      } else if (balance.isProductionExceeded) {
        setValidationError(
          `Wrong Entry: Actual output (${draft.actualOutput} pcs × ${draft.cycleTime}m = ${balance.productionMinutes} mins) exceeds total shift duration (${balance.shiftMinutes} mins)! Please reduce Actual Output or verify Cycle Time.`
        );
      } else if (balance.isOver) {
        setValidationError(
          `Wrong Entry: Productive time (${balance.productionMinutes}m) + Breakdown (${balance.loggedBreakdownMinutes}m) = ${balance.totalAccountedMinutes} mins, which exceeds shift duration (${balance.shiftMinutes} mins) by ${Math.abs(balance.unaccountedMinutes)} mins!`
        );
      } else {
        setValidationError(
          `Missing Breakdown Time: Shift is ${balance.shiftMinutes} mins. Actual output (${draft.actualOutput} pcs × ${draft.cycleTime}m) used ${balance.productionMinutes} mins, leaving ${balance.requiredBreakdownMinutes} mins of breakdown time. You have logged ${balance.loggedBreakdownMinutes} mins — please fill the remaining ${balance.unaccountedMinutes} mins in Breakdown.`
        );
      }
      return;
    }

    setValidationError(null);
    onSaveMachine({
      ...draft,
      totalWorkingMinutes: rowShiftMins,
    });
    setSaveSuccessMsg(true);
    setTimeout(() => setSaveSuccessMsg(false), 2500);
  };

  // Navigate to Next or Prev Machine
  const currentIdx = lineMachines.findIndex((m) => m.id === selectedMachineId);
  const handlePrevMachine = () => {
    if (currentIdx > 0) {
      onSelectMachineId(lineMachines[currentIdx - 1].id);
    }
  };

  const handleNextMachine = () => {
    if (currentIdx < lineMachines.length - 1) {
      onSelectMachineId(lineMachines[currentIdx + 1].id);
    }
  };

  // ============================================================================
  // VIEW 1: 16-MACHINE VISUAL GRID (When no machine is selected)
  // ============================================================================
  if (!selectedMachineId || !draft) {
    return (
      <div className="space-y-6">
        {/* Shift Lock Banner */}
        {isShiftLocked && (
          <div className="bg-rose-950 border border-rose-500/60 rounded-lg p-3.5 text-rose-100 flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 shadow-md">
            <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 text-xs font-semibold">
              <Lock className="w-4 h-4 text-rose-400 shrink-0" />
              <span>
                {shiftLock?.reason ||
                  'Shift Locked — The 30-minute post-shift editing window has closed. Data is now immutable.'}
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

        {/* Grace Period Banner */}
        {!isShiftLocked && shiftLock?.status === 'grace_period' && (
          <div className="bg-amber-950 border border-amber-500/60 rounded-lg p-3 text-amber-100 flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 shadow-md">
            <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 text-xs font-semibold">
              <span className="text-base leading-none animate-pulse">⏳</span>
              <span>
                Shift has concluded. Grace period active —{' '}
                <strong>{shiftLock.remainingMinutes} mins remaining</strong> before shift
                permanently locks.
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

        {/* Kiosk Mode Banner */}
        <div className="bg-slate-900 text-white p-4 rounded-lg border border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>Operator Touch Kiosk — {selectedLine}</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Select your assigned machine card below to log output, scrap, and downtime minutes for{' '}
              <span className="text-emerald-400 font-medium">
                {selectedLine} · {selectedShift}
              </span>{' '}
              ({selectedDate}).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-xs font-mono">
            {shiftWorkingMinutes > 0 && (
              <span className="text-amber-300">
                Shift Duration: <strong>{shiftWorkingMinutes}m</strong>
              </span>
            )}
            <span className="text-slate-400">
              Completed:{' '}
              <strong className="text-emerald-400">
                {rows.filter((r) => r.stdOutput > 0 || r.actualOutput > 0).length}
              </strong>{' '}
              / {lineMachines.length}
            </span>
          </div>
        </div>

        {/* Machine Visual Grid for current line */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 gap-2.5 sm:gap-4">
          {lineMachines.map((machine, index) => {
            const row = rows.find((r) => r.machineId === machine.id);
            const totalBd = row ? calculateTotalBreakdown(row.breakdown) : 0;
            const isRowActive =
              !!row &&
              (!!row.itemId ||
                !!row.operatorName ||
                (row.actualOutput || 0) > 0 ||
                totalBd > 0 ||
                (row.cycleTime || 0) > 0);
            const isLogged = !!row && (row.stdOutput > 0 || row.actualOutput > 0);
            const efficiency =
              row && row.stdOutput > 0
                ? calculateEfficiency(row.actualOutput, row.stdOutput)
                : 0;
            const rowShiftMins =
              shiftWorkingMinutes || row?.totalWorkingMinutes || 0;
            const balance = row
              ? calculateShiftTimeBalance(row, rowShiftMins)
              : null;
            const hasTimeMismatch = isRowActive && balance && !balance.isBalanced;

            return (
              <button
                key={machine.id}
                onClick={() => onSelectMachineId(machine.id)}
                className={`relative text-left p-3 sm:p-4 rounded-lg border transition-all text-slate-900 flex flex-col justify-between min-h-40 sm:min-h-44 group ${
                  hasTimeMismatch
                    ? balance.missingCycleTime ||
                      balance.isProductionExceeded ||
                      balance.isOver
                      ? 'bg-rose-50/40 border-rose-400 hover:border-rose-600 shadow-2xs'
                      : 'bg-amber-50/40 border-amber-400 hover:border-amber-600 shadow-2xs'
                    : isLogged
                    ? efficiency >= 90
                      ? 'bg-white border-emerald-300 hover:border-emerald-500 shadow-2xs hover:shadow-xs'
                      : 'bg-white border-amber-300 hover:border-amber-500 shadow-2xs hover:shadow-xs'
                    : 'bg-white border-slate-200 hover:border-slate-400 hover:bg-slate-50 shadow-2xs'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-mono font-bold text-slate-600">
                      #{index + 1}
                    </span>
                    {hasTimeMismatch ? (
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 ${
                          balance.missingCycleTime ||
                          balance.isProductionExceeded ||
                          balance.isOver
                            ? 'bg-rose-100 text-rose-800 border border-rose-300'
                            : 'bg-amber-100 text-amber-900 border border-amber-300'
                        }`}
                      >
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        <span>
                          {balance.missingCycleTime
                            ? 'No CT'
                            : balance.isProductionExceeded || balance.isOver
                            ? 'Over Time'
                            : `+${balance.unaccountedMinutes}m BD`}
                        </span>
                      </span>
                    ) : isLogged ? (
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          efficiency >= 90
                            ? 'bg-emerald-100 text-emerald-800'
                            : efficiency >= 75
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {efficiency}% Eff
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                        Pending
                      </span>
                    )}
                  </div>

                  <h3 className="font-bold text-sm sm:text-base text-slate-900 leading-tight group-hover:text-emerald-700 transition-colors">
                    {machine.name}
                  </h3>
                  <p className="text-xs text-slate-600 font-mono mt-0.5">
                    {machine.code} · {machine.type}
                  </p>
                </div>

                <div className="pt-2 border-t border-slate-100 text-xs">
                  {isRowActive && row ? (
                    <div>
                      <div className="flex items-center justify-between text-slate-700 font-mono text-[11px]">
                        <span>Act / Std:</span>
                        <strong className="text-slate-900">
                          {row.actualOutput} / {row.stdOutput}
                        </strong>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 mt-0.5">
                        <span className="truncate max-w-22.5">
                          {row.operatorName || '—'}
                        </span>
                        {balance?.isBalanced ? (
                          <span className="text-emerald-700 font-semibold">
                            ✓ {balance.shiftMinutes}m OK
                          </span>
                        ) : (
                          <span className="text-amber-700 font-medium">
                            BD: {totalBd}m
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-slate-600 text-xs flex items-center justify-between">
                      <span>Click to log</span>
                      <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ============================================================================
  // VIEW 2: SELECTED MACHINE STEP-BY-STEP FORM
  // ============================================================================
  const rowShiftMins = shiftWorkingMinutes || draft.totalWorkingMinutes;
  const totalBreakdown = calculateTotalBreakdown(draft.breakdown);
  const efficiency =
    draft.stdOutput > 0
      ? calculateEfficiency(draft.actualOutput, draft.stdOutput)
      : 0;
  const timeBalance = calculateShiftTimeBalance(draft, rowShiftMins);

  // Operations list for the selected item (renders dropdown if > 1 operation)
  const draftOperations = draft.itemId
    ? getOperationsForItem(
        draft.itemId,
        items,
        cycleTimes,
        draft.machineId,
        draft.machineName
      )
    : [];

  // Show live time-balance status once Actual Output is entered or the row has activity
  const hasEnteredOutputOrBd =
    (draft.actualOutput || 0) > 0 ||
    totalBreakdown > 0 ||
    (!!draft.itemId && draft.cycleTime > 0);
  const hasEntryError =
    hasEnteredOutputOrBd && !timeBalance.isBalanced;

  const pct = (mins: number) => calculateDowntimePct(mins, rowShiftMins);

  const BD_CARDS: {
    key: 'noDisc' | 'change' | 'power' | 'operator';
    title: string;
    subtitle: string;
    step1: number;
    step2: number;
    badgeClass: string;
  }[] = [
    {
      key: 'noDisc',
      title: 'NO / DISC',
      subtitle: 'Material / Disc shortage',
      step1: 10,
      step2: 20,
      badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
    },
    {
      key: 'change',
      title: 'CHANGE',
      subtitle: 'Tool insert / job setup',
      step1: 10,
      step2: 15,
      badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
    },
    {
      key: 'power',
      title: 'POWER',
      subtitle: 'Feeder trip / power outage',
      step1: 15,
      step2: 30,
      badgeClass: 'bg-rose-50 text-rose-800 border-rose-200',
    },
    {
      key: 'operator',
      title: 'OPERATOR',
      subtitle: 'Unattended / delay',
      step1: 10,
      step2: 20,
      badgeClass: 'bg-purple-50 text-purple-800 border-purple-200',
    },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Shift Lock Banner */}
      {isShiftLocked && (
        <div className="bg-rose-950 border border-rose-500/60 rounded-lg p-3.5 text-rose-100 flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 shadow-md">
          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 text-xs font-semibold">
            <Lock className="w-4 h-4 text-rose-400 shrink-0" />
            <span>
              {shiftLock?.reason ||
                'Shift Locked — The 30-minute post-shift editing window has closed. Data is now immutable.'}
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

      {/* Grace Period Banner */}
      {!isShiftLocked && shiftLock?.status === 'grace_period' && (
        <div className="bg-amber-950 border border-amber-500/60 rounded-lg p-3 text-amber-100 flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 shadow-md">
          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 text-xs font-semibold">
            <span className="text-base leading-none animate-pulse">⏳</span>
            <span>
              Shift has concluded. Grace period active —{' '}
              <strong>{shiftLock.remainingMinutes} mins remaining</strong> before shift
              permanently locks.
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

      {/* Top Machine Nav & Header */}
      <div className="bg-slate-900 text-white rounded-lg p-4 flex flex-wrap items-center justify-between gap-3 border border-slate-800 shadow-xs">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => onSelectMachineId(null)}
            className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors shrink-0"
            title="Return to machine grid"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono font-bold text-emerald-400">
                {selectedLine} · MACHINE #{currentIdx + 1} OF {lineMachines.length}
              </span>
              <span className="text-slate-500">·</span>
              <span className="text-xs text-slate-300">
                {draft.date} ({draft.shift.split(' ')[0]})
              </span>
              {rowShiftMins > 0 && (
                <>
                  <span className="text-slate-500">·</span>
                  <span className="text-xs font-mono text-amber-300">
                    Shift: {rowShiftMins}m
                  </span>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 mt-0.5">
              <h2 className="text-xl font-extrabold text-white tracking-tight">
                {draft.machineName}
              </h2>
              {hasEnteredOutputOrBd && (
                timeBalance.isBalanced ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950/90 text-emerald-300 border border-emerald-500/40 text-xs font-mono font-bold">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{timeBalance.shiftMinutes}m Balanced</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-950/90 text-rose-300 border border-rose-500/50 text-xs font-mono font-bold">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                    <span>
                      {timeBalance.missingCycleTime
                        ? 'Missing Cycle Time'
                        : timeBalance.isProductionExceeded
                        ? 'Output Exceeds Shift'
                        : timeBalance.isOver
                        ? `Over by +${Math.abs(timeBalance.unaccountedMinutes)}m`
                        : `Fill +${timeBalance.unaccountedMinutes}m BD`}
                    </span>
                  </span>
                )
              )}
            </div>
          </div>
        </div>

        {/* Machine Switcher Buttons */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handlePrevMachine}
            disabled={currentIdx === 0}
            className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-medium flex items-center gap-1 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Prev Machine</span>
          </button>
          <button
            type="button"
            onClick={handleNextMachine}
            disabled={currentIdx === lineMachines.length - 1}
            className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-medium flex items-center gap-1 transition-colors"
          >
            <span className="hidden sm:inline">Next Machine</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Form Submit Validation Alert */}
      {validationError && (
        <div className="bg-rose-50 border border-rose-300 text-rose-900 rounded-lg p-3 text-xs flex items-start gap-2.5 shadow-2xs">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <strong className="font-bold">Entry Error:</strong> {validationError}
          </div>
        </div>
      )}

      {/* Save Success Alert */}
      {saveSuccessMsg && (
        <div className="bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-lg p-3 text-xs flex items-center gap-2 shadow-2xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span className="font-bold">
            Shift entry for {draft.machineName} saved successfully!
          </span>
        </div>
      )}

      {/* Main Kiosk Form */}
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-lg border border-slate-300 shadow-xs divide-y divide-slate-200"
      >
        {/* Step 1: Assignment (Operator, Item, Operation, Cycle Time, Std Output) */}
        <div className="p-4 sm:p-5 space-y-4">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <User className="w-4 h-4 text-slate-700" />
            <span>1. Worker & Component Details (Auto-Completes Cycle Time & Target)</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Operator Selection */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Name of Operator <span className="text-rose-600">*</span>
              </label>
              <select
                value={draft.operatorName}
                disabled={isShiftLocked}
                onChange={(e) =>
                  setDraft({ ...draft, operatorName: e.target.value })
                }
                className="w-full bg-slate-50 border border-slate-300 rounded-md px-3 py-2 text-sm text-slate-900 font-medium focus:bg-white focus:border-slate-800 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <option value="">— Select Assigned Operator —</option>
                {operators.map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </select>
            </div>

            {/* Item Selection */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Machining Item / Component <span className="text-rose-600">*</span>
              </label>
              <select
                value={draft.itemId}
                disabled={isShiftLocked}
                onChange={(e) => handleItemSelect(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-md px-3 py-2 text-sm text-slate-900 font-medium focus:bg-white focus:border-slate-800 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <option value="">— Select Item from Master —</option>
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.itemName} ({it.itemCode})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Operation, Cycle Time & Std Output (4-Column Grid) */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 pt-1">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Operation Name
              </label>
              {!draft.itemId ? (
                <div className="w-full bg-slate-100 border border-slate-200 rounded-md px-3 py-2 text-sm text-slate-400 italic">
                  — Select Item First —
                </div>
              ) : draftOperations.length > 1 ? (
                <select
                  value={draft.operation}
                  disabled={isShiftLocked}
                  onChange={(e) => handleOperationSelect(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-md px-3 py-2 text-sm text-slate-900 font-medium focus:bg-white focus:border-slate-800 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <option value="">— Select Operation —</option>
                  {draftOperations.map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                  {draft.operation && !draftOperations.includes(draft.operation) && (
                    <option value={draft.operation}>{draft.operation}</option>
                  )}
                </select>
              ) : (
                <input
                  type="text"
                  value={draft.operation}
                  disabled={isShiftLocked}
                  readOnly={isShiftLocked}
                  onChange={(e) => handleOperationSelect(e.target.value)}
                  placeholder="e.g. OP-10 Rough Turning"
                  className="w-full bg-slate-50 border border-slate-300 rounded-md px-3 py-2 text-sm text-slate-900 font-medium focus:bg-white focus:border-slate-800 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                />
              )}
            </div>

            {/* Cycle Time (Auto-filled from Machine x Item x Operation; Locked for Non-Admins) */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Cycle Time
              </label>
              <div className="flex items-center">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  disabled={isShiftLocked}
                  readOnly={isShiftLocked}
                  title={
                    isShiftLocked
                      ? 'Shift is locked'
                      : 'Enter or adjust cycle time'
                  }
                  value={draft.cycleTime || ''}
                  placeholder="0.00"
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    if (isShiftLocked) return;
                    const newCt = Math.max(0, Number(e.target.value) || 0);
                    const shiftMins =
                      Number(draft.shiftWorkingMinutes ?? draft.totalWorkingMinutes) ||
                      rowShiftMins ||
                      465;
                    setDraft({
                      ...draft,
                      cycleTime: newCt,
                      stdOutput: newCt > 0 ? Math.floor(shiftMins / newCt) : 0,
                    });
                  }}
                  className={`w-full text-sm font-semibold px-3 py-2 border rounded-md bg-white disabled:bg-slate-100 ${
                    timeBalance.missingCycleTime
                      ? 'bg-rose-100 text-rose-950 border-rose-500 ring-2 ring-rose-300 animate-pulse'
                      : draft.cycleTime > 0
                      ? 'bg-blue-50/70 text-blue-950 border-blue-300 font-mono font-bold text-center'
                      : 'border-slate-300 text-slate-900 font-mono font-bold text-center'
                  }`}
                />
                <span className="ml-2 text-xs font-medium text-slate-500">m</span>
              </div>
            </div>

            {/* Std Output Target (Auto-calculated; Locked for Non-Admins) */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Std Output (Shift)
              </label>
              <div className="flex items-center">
                <input
                  type="number"
                  min="0"
                  disabled={!isAdmin || isShiftLocked}
                  readOnly={!isAdmin || isShiftLocked}
                  title={
                    !isAdmin
                      ? 'Std Output is auto-calculated from Cycle Time (Unit Head override required to edit manually)'
                      : isShiftLocked
                      ? 'Shift is locked'
                      : undefined
                  }
                  value={draft.stdOutput || ''}
                  placeholder="0"
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    if (!isAdmin || isShiftLocked) return;
                    setDraft({
                      ...draft,
                      stdOutput: Number(e.target.value) || 0,
                    });
                  }}
                  className="w-full bg-slate-50 border border-slate-300 rounded-md px-3 py-2 text-sm font-mono font-bold text-slate-900 text-center focus:bg-white focus:border-slate-800 focus:outline-none disabled:opacity-75 disabled:cursor-not-allowed"
                />
                <span className="ml-2 text-xs font-medium text-slate-500">pcs</span>
              </div>
            </div>
          </div>
        </div>

        {/* Step 2: Production Outputs (Actual Output & Rework) */}
        <div className="p-4 sm:p-5 space-y-4 bg-slate-50/50">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Package className="w-4 h-4 text-slate-700" />
              <span>2. Shift Output & Quality Inspection</span>
            </h3>

            {draft.stdOutput > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-mono">
                  Efficiency:
                </span>
                <span
                  className={`text-xs font-bold font-mono px-2.5 py-1 rounded border ${
                    efficiency >= 90
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                      : efficiency >= 75
                      ? 'bg-amber-100 text-amber-800 border-amber-300'
                      : 'bg-rose-100 text-rose-800 border-rose-300'
                  }`}
                >
                  {efficiency}%
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Actual Output */}
            <div
              className={`bg-white p-4 rounded-lg border space-y-3 ${
                timeBalance.isProductionExceeded || timeBalance.missingCycleTime
                  ? 'border-rose-400 ring-2 ring-rose-200'
                  : 'border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Actual Output (Pieces) <span className="text-rose-600">*</span>
                </label>
                <span className="text-xs font-mono text-slate-500">
                  Target: <strong>{draft.stdOutput}</strong> pcs
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isShiftLocked}
                  onClick={() => handleAdjustActual(-5)}
                  className="w-10 h-10 rounded bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 font-bold flex items-center justify-center text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  -5
                </button>
                <button
                  type="button"
                  disabled={isShiftLocked}
                  onClick={() => handleAdjustActual(-1)}
                  className="w-10 h-10 rounded bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 font-bold flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <input
                  type="number"
                  min="0"
                  disabled={isShiftLocked}
                  readOnly={isShiftLocked}
                  value={
                    draft.actualOutput > 0
                      ? draft.actualOutput
                      : draft.stdOutput > 0
                      ? 0
                      : ''
                  }
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    setValidationError(null);
                    setDraft({
                      ...draft,
                      actualOutput: Number(e.target.value) || 0,
                    });
                  }}
                  className={`flex-1 text-center font-mono text-2xl font-black py-1.5 border rounded focus:bg-white focus:border-slate-800 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed ${
                    timeBalance.isProductionExceeded ||
                    timeBalance.missingCycleTime
                      ? 'bg-rose-100 text-rose-900 border-rose-500'
                      : 'bg-slate-50 text-slate-900 border-slate-300'
                  }`}
                />
                <button
                  type="button"
                  disabled={isShiftLocked}
                  onClick={() => handleAdjustActual(1)}
                  className="w-10 h-10 rounded bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 font-bold flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={isShiftLocked}
                  onClick={() => handleAdjustActual(5)}
                  className="w-10 h-10 rounded bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 font-bold flex items-center justify-center text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  +5
                </button>
              </div>

              {/* Quick Preset Buttons */}
              <div className="flex items-center gap-1.5 justify-center pt-1">
                <button
                  type="button"
                  disabled={isShiftLocked}
                  onClick={() =>
                    !isShiftLocked && setDraft({ ...draft, actualOutput: draft.stdOutput })
                  }
                  className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Exact Target ({draft.stdOutput})
                </button>
                <button
                  type="button"
                  disabled={isShiftLocked}
                  onClick={() =>
                    !isShiftLocked &&
                    setDraft({
                      ...draft,
                      actualOutput: Math.max(0, draft.stdOutput - 5),
                    })
                  }
                  className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 px-2 py-0.5 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  -5 Pcs
                </button>
                <button
                  type="button"
                  disabled={isShiftLocked}
                  onClick={() =>
                    !isShiftLocked &&
                    setDraft({ ...draft, actualOutput: draft.stdOutput + 5 })
                  }
                  className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 px-2 py-0.5 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  +5 Pcs
                </button>
              </div>

              {/* Live Productive Time Calculation & Immediate Warning if Wrong Actual Output */}
              {draft.cycleTime > 0 && (
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-500">
                    Productive Time ({draft.actualOutput} × {draft.cycleTime}m):
                  </span>
                  <strong
                    className={
                      timeBalance.isProductionExceeded
                        ? 'text-rose-700'
                        : 'text-slate-900'
                    }
                  >
                    {timeBalance.productionMinutes}m / {timeBalance.shiftMinutes}m
                  </strong>
                </div>
              )}

              {timeBalance.missingCycleTime && (
                <div className="p-2 rounded bg-rose-50 border border-rose-300 text-rose-900 text-xs flex items-start gap-1.5 font-medium">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>
                    Cycle Time is 0! Please select an item with a configured
                    Cycle Time or enter Cycle Time in Step 1.
                  </span>
                </div>
              )}

              {timeBalance.isProductionExceeded && (
                <div className="p-2 rounded bg-rose-50 border border-rose-300 text-rose-900 text-xs flex items-start gap-1.5 font-medium">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>
                    Wrong Entry: Productive time ({timeBalance.productionMinutes}
                    m) exceeds total shift time ({timeBalance.shiftMinutes}m)!
                    Reduce Actual Output.
                  </span>
                </div>
              )}
            </div>

            {/* Re-work Pieces */}
            <div className="bg-white p-4 rounded-lg border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Re-Work Pieces (Quality Defect)
                </label>
                <span className="text-xs text-slate-500 font-mono">
                  Scrap / Correction
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isShiftLocked}
                  onClick={() => handleAdjustRework(-1)}
                  className="w-10 h-10 rounded bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 font-bold flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <input
                  type="number"
                  min="0"
                  disabled={isShiftLocked}
                  readOnly={isShiftLocked}
                  value={draft.rework > 0 ? draft.rework : ''}
                  placeholder="0"
                  onFocus={(e) => e.target.select()}
                  onChange={(e) =>
                    setDraft({ ...draft, rework: Number(e.target.value) || 0 })
                  }
                  className="flex-1 text-center font-mono text-2xl font-black py-1.5 bg-slate-50 border border-slate-300 rounded focus:bg-white focus:border-slate-800 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                />
                <button
                  type="button"
                  disabled={isShiftLocked}
                  onClick={() => handleAdjustRework(1)}
                  className="w-10 h-10 rounded bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 font-bold flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <p className="text-[11px] text-slate-500 text-center">
                Parts requiring dimension rectification or re-machining.
              </p>
            </div>
          </div>
        </div>

        {/* Step 3: Breakdown Downtime (Live Time-Accounting Prompt & Mismatch Warnings) */}
        <div
          className={`p-4 sm:p-5 space-y-4 transition-colors ${
            hasEntryError
              ? timeBalance.missingCycleTime ||
                timeBalance.isProductionExceeded ||
                timeBalance.isOver
                ? 'bg-rose-50/70 border-y-2 border-y-rose-400'
                : 'bg-amber-50/70 border-y-2 border-y-amber-400'
              : hasEnteredOutputOrBd && timeBalance.isBalanced
              ? 'bg-emerald-50/30'
              : 'bg-white'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Wrench className="w-4 h-4 text-amber-600" />
                <span>3. Breakdown & Downtime Log (Minutes)</span>
              </h3>

              {/* Live Time-Balance Status Banner */}
              {hasEnteredOutputOrBd && draft.cycleTime > 0 && (
                <div className="mt-1.5">
                  {timeBalance.isProductionExceeded ? (
                    <p className="text-xs text-rose-800 font-bold flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                      <span>
                        Wrong Entry: Actual output ({draft.actualOutput} pcs ×{' '}
                        {draft.cycleTime}m = {timeBalance.productionMinutes}m)
                        exceeds the {timeBalance.shiftMinutes}m shift!
                      </span>
                    </p>
                  ) : timeBalance.isOver ? (
                    <p className="text-xs text-rose-800 font-bold flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                      <span>
                        Wrong Entry: Productive ({timeBalance.productionMinutes}
                        m) + Breakdown ({timeBalance.loggedBreakdownMinutes}m) ={' '}
                        {timeBalance.totalAccountedMinutes}m, which exceeds the{' '}
                        {timeBalance.shiftMinutes}m shift by{' '}
                        {Math.abs(timeBalance.unaccountedMinutes)} mins!
                      </span>
                    </p>
                  ) : timeBalance.unaccountedMinutes > 0 ? (
                    <p className="text-xs text-amber-900 font-semibold flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>
                        Required Breakdown Time:{' '}
                        <strong>{timeBalance.requiredBreakdownMinutes} mins</strong>{' '}
                        ({timeBalance.shiftMinutes}m shift −{' '}
                        {timeBalance.productionMinutes}m productive). Please fill{' '}
                        <strong className="underline text-rose-700">
                          +{timeBalance.unaccountedMinutes} mins
                        </strong>{' '}
                        in the breakdown boxes below.
                      </span>
                    </p>
                  ) : (
                    <p className="text-xs text-emerald-800 font-semibold flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>
                        Shift Time Matched: Productive (
                        {timeBalance.productionMinutes}m) + Breakdown (
                        {timeBalance.loggedBreakdownMinutes}m) ={' '}
                        {timeBalance.shiftMinutes} mins.
                      </span>
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="text-xs font-mono font-bold bg-slate-900 text-amber-300 px-3 py-1.5 rounded flex items-center gap-2">
              <span>
                Logged BD: {totalBreakdown}m / {timeBalance.requiredBreakdownMinutes}m
              </span>
              {rowShiftMins > 0 && (
                <span className="text-slate-400">
                  ({pct(totalBreakdown)}% of {rowShiftMins}m)
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {BD_CARDS.map((card) => {
              const val = Number(draft.breakdown?.[card.key] || 0);
              return (
                <div
                  key={card.key}
                  className="bg-white p-3 rounded border border-slate-300 shadow-2xs space-y-2 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="block text-[11px] font-bold text-slate-800 uppercase">
                        {card.title}
                      </span>
                      {val > 0 && (
                        <span
                          className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${card.badgeClass}`}
                        >
                          {pct(val)}%
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 leading-tight mt-0.5">
                      {card.subtitle}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="0"
                        disabled={isShiftLocked}
                        readOnly={isShiftLocked}
                        value={val > 0 ? val : ''}
                        placeholder="0"
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          setValidationError(null);
                          setDraft({
                            ...draft,
                            breakdown: {
                              ...draft.breakdown,
                              [card.key]: Math.max(
                                0,
                                Number(e.target.value) || 0
                              ),
                            },
                          });
                        }}
                        className="w-full text-center font-mono text-base font-bold bg-slate-50 border border-slate-300 rounded py-1 focus:bg-white focus:border-slate-800 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                      <span className="text-xs text-slate-500">m</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={isShiftLocked}
                        onClick={() => handleBreakdownStep(card.key, card.step1)}
                        className="text-[10px] flex-1 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        +{card.step1}m
                      </button>
                      <button
                        type="button"
                        disabled={isShiftLocked}
                        onClick={() => handleBreakdownStep(card.key, card.step2)}
                        className="text-[10px] flex-1 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        +{card.step2}m
                      </button>
                    </div>

                    {/* 1-Click Auto-Fill Remaining Breakdown Time Button */}
                    {draft.cycleTime > 0 && timeBalance.unaccountedMinutes > 0 && (
                      <button
                        type="button"
                        disabled={isShiftLocked}
                        onClick={() =>
                          handleFillUnaccountedToField(
                            card.key,
                            timeBalance.unaccountedMinutes
                          )
                        }
                        className="w-full py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-mono font-bold text-[10px] transition-colors shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed"
                        title={`Add remaining ${timeBalance.unaccountedMinutes}m into ${card.title}`}
                      >
                        +Fill ({timeBalance.unaccountedMinutes}m)
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Step 4: Remarks & Quick Reason Chips */}
        <div className="p-4 sm:p-5 space-y-3">
          <label className="block text-xs font-semibold text-slate-700">
            Shift Remarks & Delay Notes
          </label>
          <input
            type="text"
            disabled={isShiftLocked}
            readOnly={isShiftLocked}
            value={draft.remarks}
            onChange={(e) => setDraft({ ...draft, remarks: e.target.value })}
            placeholder="Type notes or tap quick chips below..."
            className="w-full bg-slate-50 border border-slate-300 rounded-md px-3 py-2 text-sm text-slate-900 focus:bg-white focus:border-slate-800 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
          />

          <div className="flex items-center gap-1.5 flex-wrap pt-1 text-xs">
            <span className="text-slate-500 font-medium">Quick reason:</span>
            {[
              'Tool insert chipped',
              'Raw casting disc delay',
              'Substation power trip',
              'Fixture re-alignment',
              'Coolant top-up',
              'Target met smoothly',
            ].map((chip) => (
              <button
                key={chip}
                type="button"
                disabled={isShiftLocked}
                onClick={() => handleQuickRemark(chip)}
                className="text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 px-2 py-0.5 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                + {chip}
              </button>
            ))}
          </div>
        </div>

        {/* Bottom Submission Bar */}
        <div className="p-4 sm:p-5 bg-slate-50 flex flex-wrap items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => onSelectMachineId(null)}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded transition-colors"
          >
            ← Back to Grid
          </button>

          <div className="flex items-center gap-3">
            {isShiftLocked ? (
              <button
                type="button"
                disabled
                title={shiftLock?.reason || 'Shift is locked (View Only)'}
                className="px-6 py-2.5 bg-slate-200 text-slate-600 font-bold text-xs uppercase tracking-wider rounded-md border border-slate-300 flex items-center gap-2 cursor-not-allowed"
              >
                <span>🔒 Shift Locked — View Only</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={isSaving}
                className={`px-6 py-2.5 text-white font-bold text-xs uppercase tracking-wider rounded-md shadow-xs flex items-center gap-2 transition-colors disabled:opacity-50 ${
                  hasEntryError
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-emerald-600 hover:bg-emerald-500'
                }`}
              >
                {hasEntryError ? (
                  <>
                    <AlertTriangle className="w-4 h-4" />
                    <span>Fix Time Mismatch to Save</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      {isSaving ? 'Saving...' : 'Submit & Save Machine Entry'}
                    </span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

export default OperatorKiosk;