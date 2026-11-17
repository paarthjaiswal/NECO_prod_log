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
  UserPlus,
  PackagePlus,
  Edit2,
  X,
  Check,
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
  calculateMachineGroupTimeBalance,
  calculateSplitRowSuggestedStd,
  recalculateMachineGroupStdOutputs,
  calculateDowntimePct,
  getOperationsForItem,
  getUniqueItems,
  getCanonicalItemId,
  resolveMachineItemTarget,
} from '@/services/storageService';
import {
  addOperatorMaster,
  upsertItemMaster,
  upsertMachineMaster,
  upsertMachineItemCycleTime,
} from '@/actions/shiftActions';
import { useFeedback } from '@/context/FeedbackContext';

interface OperatorKioskProps {
  masterData: MasterDataState;
  rows: MachineShiftRow[];
  selectedDate: string;
  selectedShift: ShiftType;
  selectedLine: string;
  onSaveMachine: (updatedRow: MachineShiftRow) => void;
  onSaveMachineRuns?: (updatedRuns: MachineShiftRow[]) => void;
  onRefreshMasterData?: () => Promise<void>;
  onRowsChange?: (rows: MachineShiftRow[]) => void;
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
  onSaveMachineRuns,
  onRefreshMasterData,
  onRowsChange,
  isSaving = false,
  selectedMachineId: externalMachineId,
  onSelectMachineId: externalOnSelectMachineId,
  isAdmin = false,
  isReadOnly,
  isShiftLocked: externalShiftLocked = false,
  shiftLock,
}: OperatorKioskProps) {
  const isShiftLocked = isReadOnly !== undefined ? isReadOnly : externalShiftLocked;
  const { runWithFeedback } = useFeedback();
  const { machines, operators, items } = masterData;
  const cycleTimes = useMemo(() => masterData.cycleTimes ?? [], [masterData.cycleTimes]);
  const uniqueItems = useMemo(() => getUniqueItems(items ?? []), [items]);

  // Inline "+ Add" & Machine Edit states
  const [showAddOperatorModal, setShowAddOperatorModal] = useState(false);
  const [newOperatorName, setNewOperatorName] = useState("");

  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemCode, setNewItemCode] = useState("");
  const [newItemOperation, setNewItemOperation] = useState("");

  const [showAddOpInput, setShowAddOpInput] = useState(false);
  const [newOperationName, setNewOperationName] = useState("");

  const [showAddMachineBar, setShowAddMachineBar] = useState(false);
  const [newMachineName, setNewMachineName] = useState("");
  const [newMachineCode, setNewMachineCode] = useState("");
  const [newMachineType, setNewMachineType] = useState("CNC");

  const [isEditingMachine, setIsEditingMachine] = useState(false);
  const [editMachineName, setEditMachineName] = useState("");
  const [editMachineCode, setEditMachineCode] = useState("");
  const [editMachineType, setEditMachineType] = useState("CNC");

  const [isInlineSaving, setIsInlineSaving] = useState(false);
  const [quickAddError, setQuickAddError] = useState<string | null>(null);

  // Internal state fallback if DashboardClient doesn't pass selectedMachineId
  const [internalMachineId, setInternalMachineId] = useState<string | null>(null);
  const [activeRunNo, setActiveRunNo] = useState<number>(1);

  const selectedMachineId =
    externalMachineId !== undefined ? externalMachineId : internalMachineId;

  const onSelectMachineId = (machineId: string | null) => {
    setActiveRunNo(1);
    if (externalOnSelectMachineId) {
      externalOnSelectMachineId(machineId);
    } else {
      setInternalMachineId(machineId);
    }
  };

  const [draft, setDraft] = useState<MachineShiftRow | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState(false);
  const [editingBdField, setEditingBdField] = useState<string | null>(null);
  const [editingBdText, setEditingBdText] = useState<string>('');

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

  // Sync draft when selectedMachineId or activeRunNo changes (and auto-hydrate cycleTime if missing)
  useEffect(() => {
    if (!selectedMachineId) {
      setDraft(null);
      setValidationError(null);
      return;
    }

    const matchingRows = rows.filter((r) => r.machineId === selectedMachineId);
    const existingRow =
      matchingRows.find((r) => (r.runNo || 1) === activeRunNo) ||
      matchingRows[0] ||
      null;
    const machine = machines.find((m) => m.id === selectedMachineId);

    if (existingRow) {
      if ((existingRow.runNo || 1) !== activeRunNo) {
        setActiveRunNo(existingRow.runNo || 1);
      }
      setDraft((prev) => {
        const baseRow =
          !isShiftLocked &&
          prev &&
          prev.machineId === existingRow.machineId &&
          (prev.runNo || 1) === (existingRow.runNo || 1) &&
          prev.date === existingRow.date &&
          prev.shift === existingRow.shift &&
          prev.line === selectedLine
            ? prev
            : {
                ...existingRow,
                runNo: existingRow.runNo || 1,
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
      setActiveRunNo(1);
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
          runNo: 1,
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
          breakdown: {
            noDisc: 0,
            change: 0,
            power: 0,
            operator: 0,
            machineBreakdown: 0,
            fixProgSettings: 0,
          },
          remarks: '',
        };
      });
    }
    setValidationError(null);
  }, [
    selectedMachineId,
    activeRunNo,
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

  const rowShiftMins = shiftWorkingMinutes || draft?.totalWorkingMinutes || 0;

  const currentMachineRuns = useMemo(() => {
    if (!selectedMachineId) return [];
    const matched = rows.filter((r) => r.machineId === selectedMachineId);
    if (!draft) return matched;
    if (!matched.some((r) => (r.runNo || 1) === (draft.runNo || 1))) {
      return [...matched, draft];
    }
    return matched.map((r) => ((r.runNo || 1) === (draft.runNo || 1) ? draft : r));
  }, [rows, selectedMachineId, draft]);

  const timeBalance = useMemo(() => {
    if (!selectedMachineId) {
      return calculateShiftTimeBalance(draft || ({} as MachineShiftRow), rowShiftMins);
    }
    return calculateMachineGroupTimeBalance(currentMachineRuns, selectedMachineId, rowShiftMins);
  }, [currentMachineRuns, selectedMachineId, draft, rowShiftMins]);

  // Update current active run draft, sync to rows, and auto-recalculate proportional stdOutput
  const updateDraft = (updates: Partial<MachineShiftRow>) => {
    if (isShiftLocked || !draft) return;
    setValidationError(null);
    const updatedDraft: MachineShiftRow = { ...draft, ...updates };
    setDraft(updatedDraft);

    if (selectedMachineId) {
      const hasMatch = rows.some(
        (r) => r.machineId === selectedMachineId && (r.runNo || 1) === (draft.runNo || 1)
      );
      const syncedRows = hasMatch
        ? rows.map((r) =>
            r.machineId === selectedMachineId && (r.runNo || 1) === (draft.runNo || 1)
              ? updatedDraft
              : r
          )
        : [...rows, updatedDraft];

      const balanced = recalculateMachineGroupStdOutputs(
        syncedRows,
        selectedMachineId,
        shiftWorkingMinutes || draft.totalWorkingMinutes
      );
      const refreshedDraft = balanced.find(
        (r) => r.machineId === selectedMachineId && (r.runNo || 1) === (draft.runNo || 1)
      );
      if (refreshedDraft && refreshedDraft.stdOutput !== updatedDraft.stdOutput) {
        setDraft(refreshedDraft);
      }
      if (onRowsChange) {
        onRowsChange(balanced);
      }
    }
  };

  const handleAddSplitRun = () => {
    if (isShiftLocked || !selectedMachineId || !draft) return;
    const currentDraft = draft;
    const baseRun = currentDraft || rows.find((r) => r.machineId === selectedMachineId);
    if (!baseRun) return;

    const existingWithDraft: MachineShiftRow[] = rows.map((r) =>
      r.machineId === selectedMachineId && (r.runNo || 1) === (currentDraft.runNo || 1) ? currentDraft : r
    );
    const runsForMach = existingWithDraft.filter((r) => r.machineId === selectedMachineId);
    const nextRunNo = Math.max(...runsForMach.map((r) => r.runNo || 1), 0) + 1;

    const newRun: MachineShiftRow = {
      id: `${selectedDate}_${selectedShift}_${selectedLine}_${selectedMachineId}_r${nextRunNo}`,
      date: selectedDate,
      shift: selectedShift,
      line: selectedLine,
      productionLine: selectedLine,
      srNo: baseRun.srNo,
      runNo: nextRunNo,
      machineId: selectedMachineId,
      machineName: baseRun.machineName,
      machineCode: baseRun.machineCode,
      operatorName: baseRun.operatorName || '',
      itemId: '',
      itemName: '',
      operation: '',
      cycleTime: 0,
      stdOutput: 0,
      actualOutput: 0,
      rework: 0,
      totalWorkingMinutes: shiftWorkingMinutes || baseRun.totalWorkingMinutes,
      breakdown: {
        noDisc: 0,
        change: 0,
        power: 0,
        operator: 0,
        machineBreakdown: 0,
        fixProgSettings: 0,
      },
      remarks: '',
    };

    const lastIdx = existingWithDraft.reduce(
      (last, r, i) => (r.machineId === selectedMachineId ? i : last),
      -1
    );
    const nextRows = [...existingWithDraft];
    if (lastIdx >= 0) {
      nextRows.splice(lastIdx + 1, 0, newRun);
    } else {
      nextRows.push(newRun);
    }

    const balancedRows = recalculateMachineGroupStdOutputs(
      nextRows,
      selectedMachineId,
      shiftWorkingMinutes || baseRun.totalWorkingMinutes
    );

    if (onRowsChange) {
      onRowsChange(balancedRows);
    }
    setActiveRunNo(nextRunNo);
    const newDraft = balancedRows.find(
      (r) => r.machineId === selectedMachineId && r.runNo === nextRunNo
    );
    if (newDraft) {
      setDraft(newDraft);
    }
  };

  const handleRemoveSplitRun = (runNoToRemove: number) => {
    if (isShiftLocked || !selectedMachineId || runNoToRemove <= 1) return;
    const remaining = rows.filter(
      (r) => !(r.machineId === selectedMachineId && (r.runNo || 1) === runNoToRemove)
    );
    let runCounter = 1;
    const renumbered = remaining.map((r) => {
      if (r.machineId === selectedMachineId) {
        const updated = {
          ...r,
          runNo: runCounter,
          id:
            runCounter === 1
              ? `${selectedDate}_${selectedShift}_${selectedLine}_${r.machineId}`
              : `${selectedDate}_${selectedShift}_${selectedLine}_${r.machineId}_r${runCounter}`,
        };
        runCounter++;
        return updated;
      }
      return r;
    });

    const balancedRows = recalculateMachineGroupStdOutputs(
      renumbered,
      selectedMachineId,
      shiftWorkingMinutes || (draft?.totalWorkingMinutes ?? 465)
    );

    if (onRowsChange) {
      onRowsChange(balancedRows);
    }
    setActiveRunNo(1);
    const nextDraft = balancedRows.find(
      (r) => r.machineId === selectedMachineId && (r.runNo || 1) === 1
    );
    if (nextDraft) {
      setDraft(nextDraft);
    }
  };

  const handleSelectRun = (targetRunNo: number) => {
    if (!draft || (draft.runNo || 1) === targetRunNo) {
      setActiveRunNo(targetRunNo);
      return;
    }
    const currentDraft = draft;
    const syncedRows: MachineShiftRow[] = rows.map((r) =>
      r.machineId === selectedMachineId && (r.runNo || 1) === (currentDraft.runNo || 1) ? currentDraft : r
    );
    const balancedRows = recalculateMachineGroupStdOutputs(
      syncedRows,
      selectedMachineId!,
      shiftWorkingMinutes || currentDraft.totalWorkingMinutes
    );
    if (onRowsChange) {
      onRowsChange(balancedRows);
    }
    setActiveRunNo(targetRunNo);
    const targetDraft = balancedRows.find(
      (r) => r.machineId === selectedMachineId && (r.runNo || 1) === targetRunNo
    );
    if (targetDraft) {
      setDraft(targetDraft);
    }
    setValidationError(null);
  };

  // 1. When Item changes in draft: auto-set Operation, Cycle Time, and Std Output
  const handleItemSelect = (itemId: string) => {
    if (isShiftLocked || !draft) return;
    setValidationError(null);

    if (!itemId) {
      updateDraft({
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

    const isSplit = currentMachineRuns.length > 1;
    const targetStd = isSplit
      ? calculateSplitRowSuggestedStd(
          rows,
          draft.id,
          target.cycleTime,
          shiftWorkingMinutes || draft.totalWorkingMinutes
        )
      : target.stdOutput;

    updateDraft({
      itemId,
      itemName: target.itemName,
      operation: target.operation,
      cycleTime: target.cycleTime,
      stdOutput: targetStd,
      totalWorkingMinutes: shiftWorkingMinutes || draft.totalWorkingMinutes,
    });
  };

  // 2. When Operation changes in draft: re-fetch Cycle Time & Std Output for (Machine + Item + Operation)
  const handleOperationSelect = (operationName: string) => {
    if (isShiftLocked || !draft) return;
    setValidationError(null);

    if (!draft.itemId) {
      updateDraft({ operation: operationName });
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

    const isSplit = currentMachineRuns.length > 1;
    const targetStd = isSplit
      ? calculateSplitRowSuggestedStd(
          rows,
          draft.id,
          target.cycleTime,
          shiftWorkingMinutes || draft.totalWorkingMinutes
        )
      : target.stdOutput;

    updateDraft({
      operation: operationName,
      cycleTime: target.cycleTime,
      stdOutput: targetStd,
      totalWorkingMinutes: shiftWorkingMinutes || draft.totalWorkingMinutes,
    });
  };

  // 2A. Create Operator inline & assign to active draft
  const handleQuickCreateOperator = async () => {
    if (!newOperatorName.trim()) return;
    setIsInlineSaving(true);
    setQuickAddError(null);
    try {
      await runWithFeedback(
        async () => {
          const res = await addOperatorMaster(newOperatorName);
          if (onRefreshMasterData) await onRefreshMasterData();

          if (draft) {
            setDraft((prev) => (prev ? { ...prev, operatorName: res.operator.name } : null));
            if (onRowsChange) {
              const updated = rows.map((r) =>
                r.machineId === draft.machineId ? { ...r, operatorName: res.operator.name } : r
              );
              onRowsChange(updated);
            }
          }
          setNewOperatorName("");
          setShowAddOperatorModal(false);
          return res;
        },
        {
          loadingMessage: "Adding operator...",
          successTitle: "Operator Added",
          successDetail: `"${newOperatorName.trim()}" registered`,
          errorTitle: "Failed to Add Operator",
        }
      );
    } catch (err) {
      console.error("Failed to create operator:", err);
      setQuickAddError(err instanceof Error ? err.message : "Error creating operator");
    } finally {
      setIsInlineSaving(false);
    }
  };

  // 2B. Create Item + Operation inline & assign to active draft
  const handleQuickCreateItem = async () => {
    if (!newItemName.trim() || !newItemCode.trim() || !newItemOperation.trim()) return;
    setIsInlineSaving(true);
    setQuickAddError(null);
    try {
      await runWithFeedback(
        async () => {
          const res = await upsertItemMaster({
            itemName: newItemName,
            itemCode: newItemCode,
            operation: newItemOperation,
          });
          if (onRefreshMasterData) await onRefreshMasterData();

          if (draft) {
            const ct = Number(draft.cycleTime) || 0;
            const shiftMins =
              Number(draft.shiftWorkingMinutes ?? draft.totalWorkingMinutes) ||
              shiftWorkingMinutes ||
              465;
            const std = ct > 0 ? Math.floor(shiftMins / ct) : draft.stdOutput;

            const updatedDraft = {
              ...draft,
              itemId: res.item.id,
              itemName: res.item.itemName,
              operation: res.item.operation,
              stdOutput: std,
            };
            setDraft(updatedDraft);

            if (onRowsChange) {
              const updated = rows.map((r) =>
                r.machineId === draft.machineId ? { ...r, ...updatedDraft } : r
              );
              onRowsChange(updated);
            }
          }
          setNewItemName("");
          setNewItemCode("");
          setNewItemOperation("");
          setShowAddItemModal(false);
          return res;
        },
        {
          loadingMessage: "Adding component item...",
          successTitle: "Item Added",
          successDetail: `"${newItemName.trim()}" registered`,
          errorTitle: "Failed to Add Item",
        }
      );
    } catch (err) {
      console.error("Failed to create item:", err);
      setQuickAddError(err instanceof Error ? err.message : "Error creating item");
    } finally {
      setIsInlineSaving(false);
    }
  };

  // 2C. Create/Add Operation inline for current item
  const handleQuickCreateOperation = async () => {
    const opName = newOperationName.trim();
    if (!opName || !draft?.itemId) return;

    setIsInlineSaving(true);
    setQuickAddError(null);
    try {
      await runWithFeedback(
        async () => {
          const currentItem = items.find((i) => i.id === draft.itemId);
          if (currentItem) {
            const existingOps = (currentItem.operation || "")
              .split(/[,/]/)
              .map((s) => s.trim())
              .filter(Boolean);
            if (!existingOps.includes(opName)) {
              const updatedOps =
                existingOps.length > 0 ? `${currentItem.operation}, ${opName}` : opName;
              await upsertItemMaster({
                ...currentItem,
                operation: updatedOps,
              });
            }
          }

          if (draft.machineId) {
            await upsertMachineItemCycleTime({
              machineId: draft.machineId,
              itemId: draft.itemId,
              operation: opName,
              cycleTime: draft.cycleTime || 0,
              stdOutput: draft.stdOutput || 0,
            });
          }

          if (onRefreshMasterData) await onRefreshMasterData();
          handleOperationSelect(opName);
          setShowAddOpInput(false);
          setNewOperationName("");
        },
        {
          loadingMessage: "Adding operation...",
          successTitle: "Operation Added",
          successDetail: `"${opName}" saved`,
          errorTitle: "Failed to Add Operation",
        }
      );
    } catch (err) {
      console.error("Failed to add operation:", err);
      setQuickAddError(err instanceof Error ? err.message : "Error adding operation");
    } finally {
      setIsInlineSaving(false);
    }
  };

  // 2D. Add New Machine to current line
  const handleQuickCreateMachine = async () => {
    if (!newMachineName.trim() || !newMachineCode.trim()) return;
    setIsInlineSaving(true);
    try {
      await runWithFeedback(
        async () => {
          const res = await upsertMachineMaster({
            name: newMachineName,
            code: newMachineCode,
            machineType: newMachineType,
            productionLine: selectedLine,
            sortOrder: lineMachines.length + 1,
          });
          if (onRefreshMasterData) await onRefreshMasterData();

          if (onRowsChange) {
            const newRow: MachineShiftRow = {
              id: `${selectedDate}_${selectedShift}_${selectedLine}_${res.machine.id}`,
              date: selectedDate,
              shift: selectedShift,
              productionLine: selectedLine,
              line: selectedLine,
              srNo: rows.length + 1,
              machineId: res.machine.id,
              machineCode: res.machine.code,
              machineName: res.machine.name,
              operatorName: "",
              itemId: "",
              itemName: "",
              operation: "",
              cycleTime: 0,
              totalWorkingMinutes: shiftWorkingMinutes || 465,
              stdOutput: 0,
              actualOutput: 0,
              rework: 0,
              breakdown: {
                noDisc: 0,
                change: 0,
                power: 0,
                operator: 0,
                machineBreakdown: 0,
                fixProgSettings: 0,
              },
              breakdownPct: {
                noDiscPct: 0,
                changePct: 0,
                powerPct: 0,
                operatorPct: 0,
                machineBreakdownPct: 0,
                fixProgSettingsPct: 0,
                totalBdMinutes: 0,
                totalBdPct: 0,
              },
              remarks: "",
            };
            onRowsChange([...rows, newRow]);
          }
          setNewMachineName("");
          setNewMachineCode("");
          setNewMachineType("CNC");
          setShowAddMachineBar(false);
          return res;
        },
        {
          loadingMessage: "Adding machine...",
          successTitle: "Machine Added",
          successDetail: `"${newMachineName.trim()}" added to ${selectedLine}`,
          errorTitle: "Failed to Add Machine",
        }
      );
    } catch (err) {
      console.error("Failed to create machine inline:", err);
    } finally {
      setIsInlineSaving(false);
    }
  };

  // 2E. Update Machine Name & Code inline
  const handleUpdateMachineDetails = async () => {
    if (!draft || !editMachineName.trim() || !editMachineCode.trim()) return;
    setIsInlineSaving(true);
    try {
      await runWithFeedback(
        async () => {
          const res = await upsertMachineMaster({
            id: draft.machineId,
            name: editMachineName.trim(),
            code: editMachineCode.trim(),
            machineType: editMachineType,
            productionLine: selectedLine,
          });
          if (onRefreshMasterData) await onRefreshMasterData();

          setDraft((prev) =>
            prev
              ? {
                  ...prev,
                  machineName: res.machine.name,
                  machineCode: res.machine.code,
                }
              : null
          );

          if (onRowsChange) {
            const updated = rows.map((r) =>
              r.machineId === draft.machineId
                ? { ...r, machineName: res.machine.name, machineCode: res.machine.code }
                : r
            );
            onRowsChange(updated);
          }

          setIsEditingMachine(false);
          return res;
        },
        {
          loadingMessage: "Saving machine...",
          successTitle: "Machine Updated",
          successDetail: `Updated ${editMachineName.trim()}`,
          errorTitle: "Failed to Update Machine",
        }
      );
    } catch (err) {
      console.error("Failed to update machine:", err);
      alert(err instanceof Error ? err.message : "Failed to update machine");
    } finally {
      setIsInlineSaving(false);
    }
  };

  const handleAdjustActual = (delta: number) => {
    if (isShiftLocked || !draft) return;
    setValidationError(null);
    const newVal = Math.max(0, (draft.actualOutput || 0) + delta);
    updateDraft({ actualOutput: newVal });
  };

  const handleAdjustRework = (delta: number) => {
    if (isShiftLocked || !draft) return;
    const newVal = Math.max(0, (draft.rework || 0) + delta);
    updateDraft({ rework: newVal });
  };

  const handleBreakdownStep = (
    field:
      | 'noDisc'
      | 'change'
      | 'power'
      | 'operator'
      | 'machineBreakdown'
      | 'fixProgSettings',
    delta: number
  ) => {
    if (isShiftLocked || !draft) return;
    setValidationError(null);
    const currentVal = Number(draft.breakdown?.[field]) || 0;
    const nextVal = Number(Math.max(0, currentVal + delta).toFixed(2));
    updateDraft({
      breakdown: {
        ...draft.breakdown,
        [field]: nextVal,
      },
    });
  };

  const handleFillUnaccountedToField = (
    field:
      | 'noDisc'
      | 'change'
      | 'power'
      | 'operator'
      | 'machineBreakdown'
      | 'fixProgSettings',
    unaccountedMins: number
  ) => {
    if (isShiftLocked || !draft || unaccountedMins <= 0) return;
    setValidationError(null);
    const currentVal = Number(draft.breakdown?.[field]) || 0;
    const nextVal = Number(Math.max(0, currentVal + unaccountedMins).toFixed(2));
    updateDraft({
      breakdown: {
        ...draft.breakdown,
        [field]: nextVal,
      },
    });
  };

  const handleQuickRemark = (chip: string) => {
    if (isShiftLocked || !draft) return;
    const existing = draft.remarks ? draft.remarks + '; ' : '';
    updateDraft({ remarks: existing + chip });
  };

  // Submission with strict Shift Time Balance validation across all runs of the machine
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isShiftLocked || !draft || !selectedMachineId) return;

    const allMachineRuns = rows
      .filter((r) => r.machineId === selectedMachineId)
      .map((r) => ((r.runNo || 1) === (draft.runNo || 1) ? draft : r));

    const runsToSave = allMachineRuns.length > 0 ? allMachineRuns : [draft];

    const hasAnyActivity = runsToSave.some(
      (r) =>
        !!r.itemId ||
        !!r.operatorName ||
        (r.actualOutput || 0) > 0 ||
        calculateTotalBreakdown(r.breakdown) > 0 ||
        (r.cycleTime || 0) > 0
    );

    if (hasAnyActivity) {
      for (const run of runsToSave) {
        const runHasActivity =
          (run.actualOutput || 0) > 0 ||
          calculateTotalBreakdown(run.breakdown) > 0 ||
          (run.cycleTime || 0) > 0;
        if (runHasActivity) {
          if (!run.operatorName) {
            setValidationError(
              runsToSave.length > 1
                ? `Please select an Operator for Run #${run.runNo || 1}.`
                : 'Please select the operator name for this machine.'
            );
            return;
          }
          if (!run.itemId) {
            setValidationError(
              runsToSave.length > 1
                ? `Please select an Item for Run #${run.runNo || 1}.`
                : 'Please select the item/component being machined.'
            );
            return;
          }
        }
      }

      const rowShiftMins = shiftWorkingMinutes || draft.totalWorkingMinutes;
      const balance = calculateMachineGroupTimeBalance(runsToSave, selectedMachineId, rowShiftMins);

      if (!balance.isBalanced) {
        if (balance.missingCycleTime) {
          setValidationError(
            `Cycle Time is 0! Actual output was entered on ${draft.machineName}, but Cycle Time is missing. Please enter Cycle Time or select a configured Item.`
          );
        } else if (balance.isProductionExceeded) {
          setValidationError(
            `Wrong Entry: Productive time (${balance.productionMinutes}m) exceeds total shift duration (${balance.shiftMinutes} mins)! Please reduce Actual Output or verify Cycle Time.`
          );
        } else if (balance.isOver) {
          setValidationError(
            `Wrong Entry: Productive time (${balance.productionMinutes}m) + Breakdown (${balance.loggedBreakdownMinutes}m) = ${balance.totalAccountedMinutes} mins, which exceeds shift duration (${balance.shiftMinutes} mins) by ${Math.abs(balance.unaccountedMinutes)} mins!`
          );
        } else {
          setValidationError(
            `Missing Breakdown Time: Shift is ${balance.shiftMinutes} mins. Productive time is ${balance.productionMinutes} mins, leaving ${balance.requiredBreakdownMinutes} mins of breakdown time. You have logged ${balance.loggedBreakdownMinutes} mins — please fill the remaining ${balance.unaccountedMinutes} mins in Breakdown.`
          );
        }
        return;
      }
    }

    setValidationError(null);

    if (onSaveMachineRuns) {
      onSaveMachineRuns(runsToSave);
    } else {
      onSaveMachine({
        ...draft,
        totalWorkingMinutes: shiftWorkingMinutes || draft.totalWorkingMinutes,
      });
    }

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

  const renderQuickAddModals = () => {
    if (!showAddOperatorModal && !showAddItemModal) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
        <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          {/* Header */}
          <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              {showAddOperatorModal ? (
                <UserPlus className="w-4 h-4 text-emerald-400" />
              ) : (
                <PackagePlus className="w-4 h-4 text-emerald-400" />
              )}
              <h3 className="text-sm font-bold tracking-tight">
                {showAddOperatorModal ? 'Add New Operator' : 'Add New Item & Operation'}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => {
                if (isInlineSaving) return;
                setShowAddOperatorModal(false);
                setShowAddItemModal(false);
                setNewOperatorName('');
                setNewItemCode('');
                setNewItemName('');
                setNewItemOperation('');
              }}
              className="text-slate-400 hover:text-white p-1 rounded transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Form Body */}
          {showAddOperatorModal ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleQuickCreateOperator();
              }}
              className="p-5 space-y-4"
            >
              {quickAddError && (
                <div className="p-2.5 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-md font-medium">
                  {quickAddError}
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Operator Full Name *
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  value={newOperatorName}
                  onChange={(e) => setNewOperatorName(e.target.value)}
                  placeholder="e.g. Ramesh Kumar"
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-md focus:border-slate-800 focus:outline-none"
                />
                {draft && (
                  <p className="mt-1.5 text-[11px] text-slate-500">
                    Will be assigned immediately to machine <strong>{draft.machineName}</strong>.
                  </p>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={isInlineSaving}
                  onClick={() => {
                    setShowAddOperatorModal(false);
                    setNewOperatorName('');
                  }}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isInlineSaving || !newOperatorName.trim()}
                  className="px-4 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 rounded-md shadow-xs transition-colors"
                >
                  {isInlineSaving ? 'Adding...' : 'Add & Assign'}
                </button>
              </div>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleQuickCreateItem();
              }}
              className="p-5 space-y-3.5"
            >
              {quickAddError && (
                <div className="p-2.5 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-md font-medium">
                  {quickAddError}
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Item Code / Part No. *
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  value={newItemCode}
                  onChange={(e) => setNewItemCode(e.target.value)}
                  placeholder="e.g. DRG-101"
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-md font-mono focus:border-slate-800 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Item / Component Name *
                </label>
                <input
                  type="text"
                  required
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  placeholder="e.g. Differential Housing"
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-md focus:border-slate-800 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Operation Description *
                </label>
                <input
                  type="text"
                  required
                  value={newItemOperation}
                  onChange={(e) => setNewItemOperation(e.target.value)}
                  placeholder="e.g. OP-10 Turning"
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-md focus:border-slate-800 focus:outline-none"
                />
                {draft && (
                  <p className="mt-1.5 text-[11px] text-slate-500">
                    Will be assigned immediately to machine <strong>{draft.machineName}</strong>.
                  </p>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={isInlineSaving}
                  onClick={() => {
                    setShowAddItemModal(false);
                    setNewItemCode('');
                    setNewItemName('');
                    setNewItemOperation('');
                  }}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    isInlineSaving ||
                    !newItemName.trim() ||
                    !newItemCode.trim() ||
                    !newItemOperation.trim()
                  }
                  className="px-4 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 rounded-md shadow-xs transition-colors"
                >
                  {isInlineSaving ? 'Adding...' : 'Add & Select'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    );
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
                {new Set(rows.filter((r) => r.stdOutput > 0 || r.actualOutput > 0).map((r) => r.machineId)).size}
              </strong>{' '}
              / {lineMachines.length}
            </span>
          </div>
        </div>

        {/* Top Quick Actions Bar for Machines, Operators & Items */}
        {!isShiftLocked && (
          <div className="flex flex-wrap items-center justify-between gap-2.5 p-2.5 bg-white border border-slate-200 rounded-lg shadow-2xs">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAddMachineBar((prev) => !prev)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-slate-900 text-white hover:bg-slate-800 shadow-2xs transition-colors"
              >
                <Plus className="w-3.5 h-3.5 text-emerald-400" />
                <span>Add Machine</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddOperatorModal(true);
                  setNewOperatorName('');
                  setQuickAddError(null);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 transition-colors"
              >
                <UserPlus className="w-3.5 h-3.5 text-emerald-600" />
                <span>Add Operator</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddItemModal(true);
                  setNewItemCode('');
                  setNewItemName('');
                  setNewItemOperation('OP-10 Turning');
                  setQuickAddError(null);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 transition-colors"
              >
                <PackagePlus className="w-3.5 h-3.5 text-emerald-600" />
                <span>Add Item</span>
              </button>
            </div>
            <span className="text-[11px] text-slate-500 font-medium hidden sm:inline">
              Instant Master Sync — New records auto-select on save
            </span>
          </div>
        )}

        {/* Inline Add Machine Bar */}
        {showAddMachineBar && !isShiftLocked && (
          <div className="flex flex-wrap items-center gap-2 p-3 bg-slate-50 border border-slate-300 rounded-lg shadow-2xs animate-in fade-in duration-150">
            <span className="text-xs font-bold text-slate-700">
              New Machine ({selectedLine}):
            </span>
            <input
              type="text"
              placeholder="Machine Name (e.g. MAKINO-130)"
              value={newMachineName}
              onChange={(e) => setNewMachineName(e.target.value)}
              className="px-2.5 py-1 text-xs border border-slate-300 rounded bg-white focus:outline-none focus:border-slate-800"
            />
            <input
              type="text"
              placeholder="Code (e.g. MC-130)"
              value={newMachineCode}
              onChange={(e) => setNewMachineCode(e.target.value)}
              className="px-2.5 py-1 text-xs border border-slate-300 rounded bg-white w-28 focus:outline-none focus:border-slate-800 font-mono"
            />
            <select
              value={newMachineType}
              onChange={(e) => setNewMachineType(e.target.value)}
              className="px-2 py-1 text-xs border border-slate-300 rounded bg-white text-slate-800"
            >
              <option value="CNC">CNC</option>
              <option value="VMC">VMC</option>
              <option value="SPM">SPM</option>
              <option value="LATHE">LATHE</option>
            </select>
            <button
              type="button"
              disabled={isInlineSaving || !newMachineName.trim() || !newMachineCode.trim()}
              onClick={handleQuickCreateMachine}
              className="px-3.5 py-1 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded transition-colors shadow-2xs"
            >
              {isInlineSaving ? 'Saving...' : 'Create Machine'}
            </button>
            <button
              type="button"
              onClick={() => setShowAddMachineBar(false)}
              className="px-2.5 py-1 text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Machine Visual Grid for current line */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 gap-2.5 sm:gap-4">
          {lineMachines.map((machine, index) => {
            const machRuns = rows.filter((r) => r.machineId === machine.id);
            const totalAct = machRuns.reduce((s, r) => s + (Number(r.actualOutput) || 0), 0);
            const totalStd = machRuns.reduce((s, r) => s + (Number(r.stdOutput) || 0), 0);
            const totalBd = Number(machRuns.reduce((s, r) => s + calculateTotalBreakdown(r.breakdown), 0).toFixed(2));
            const isRowActive = machRuns.some(
              (r) =>
                !!r.itemId ||
                !!r.operatorName ||
                (r.actualOutput || 0) > 0 ||
                calculateTotalBreakdown(r.breakdown) > 0 ||
                (r.cycleTime || 0) > 0
            );
            const isLogged = totalStd > 0 || totalAct > 0;
            const efficiency = totalStd > 0 ? calculateEfficiency(totalAct, totalStd) : 0;
            const rowShiftMins = shiftWorkingMinutes || machRuns[0]?.totalWorkingMinutes || 0;
            const balance = isRowActive
              ? calculateMachineGroupTimeBalance(rows, machine.id, rowShiftMins)
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
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-mono font-bold text-slate-600">
                        #{index + 1}
                      </span>
                      {machRuns.length > 1 && (
                        <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 text-[10px] font-bold border border-blue-200">
                          {machRuns.length} Runs
                        </span>
                      )}
                    </div>
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
                  {isRowActive && machRuns.length > 0 ? (
                    <div>
                      <div className="flex items-center justify-between text-slate-700 font-mono text-[11px]">
                        <span>Act / Std:</span>
                        <strong className="text-slate-900">
                          {totalAct} / {totalStd}
                        </strong>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 mt-0.5">
                        <span className="truncate max-w-22.5">
                          {machRuns.length === 1
                            ? machRuns[0].operatorName || '—'
                            : `${machRuns.length} runs`}
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
        {renderQuickAddModals()}
      </div>
    );
  }

  // ============================================================================
  // VIEW 2: SELECTED MACHINE STEP-BY-STEP FORM
  // ============================================================================
  const totalBreakdown = calculateTotalBreakdown(draft.breakdown);
  const efficiency =
    draft.stdOutput > 0
      ? calculateEfficiency(draft.actualOutput, draft.stdOutput)
      : 0;

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

  // Show live time-balance status once Actual Output is entered or the machine has activity
  const hasEnteredOutputOrBd =
    (draft.actualOutput || 0) > 0 ||
    totalBreakdown > 0 ||
    (!!draft.itemId && draft.cycleTime > 0) ||
    currentMachineRuns.some(
      (r) => (r.actualOutput || 0) > 0 || calculateTotalBreakdown(r.breakdown) > 0
    );
  const hasEntryError =
    hasEnteredOutputOrBd && !timeBalance.isBalanced;

  const pct = (mins: number) => calculateDowntimePct(mins, rowShiftMins);

  const BD_CARDS: {
    key:
      | 'noDisc'
      | 'change'
      | 'power'
      | 'operator'
      | 'machineBreakdown'
      | 'fixProgSettings';
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
    {
      key: 'machineBreakdown',
      title: 'BREAK DOWN',
      subtitle: 'Machine / mechanical fault',
      step1: 15,
      step2: 30,
      badgeClass: 'bg-orange-50 text-orange-800 border-orange-200',
    },
    {
      key: 'fixProgSettings',
      title: 'FIX/PROG SETTINGS',
      subtitle: 'Fixture / program setting',
      step1: 10,
      step2: 20,
      badgeClass: 'bg-indigo-50 text-indigo-800 border-indigo-200',
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
              {isEditingMachine ? (
                <div className="flex flex-wrap items-center gap-1.5 bg-slate-800 p-1.5 rounded border border-slate-700">
                  <input
                    type="text"
                    value={editMachineName}
                    onChange={(e) => setEditMachineName(e.target.value)}
                    className="px-2 py-1 text-xs bg-slate-900 border border-slate-600 rounded text-white font-bold"
                    placeholder="Machine Name"
                  />
                  <input
                    type="text"
                    value={editMachineCode}
                    onChange={(e) => setEditMachineCode(e.target.value)}
                    className="px-2 py-1 text-xs bg-slate-900 border border-slate-600 rounded text-white font-mono w-24"
                    placeholder="Code"
                  />
                  <select
                    value={editMachineType}
                    onChange={(e) => setEditMachineType(e.target.value)}
                    className="px-2 py-1 text-xs bg-slate-900 border border-slate-600 rounded text-white"
                  >
                    <option value="CNC">CNC</option>
                    <option value="VMC">VMC</option>
                    <option value="SPM">SPM</option>
                    <option value="LATHE">LATHE</option>
                  </select>
                  <button
                    type="button"
                    disabled={isInlineSaving}
                    onClick={handleUpdateMachineDetails}
                    className="p-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white"
                    title="Save machine changes"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditingMachine(false)}
                    className="p-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300"
                    title="Cancel"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-extrabold text-white tracking-tight">
                    {draft.machineName}
                  </h2>
                  {!isShiftLocked && (
                    <button
                      type="button"
                      onClick={() => {
                        const m = machines.find((mac) => mac.id === draft.machineId);
                        setEditMachineName(draft.machineName);
                        setEditMachineCode(m?.code || '');
                        setEditMachineType(m?.type || 'CNC');
                        setIsEditingMachine(true);
                      }}
                      className="p-1 text-slate-400 hover:text-emerald-400 transition-colors"
                      title="Edit machine details"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
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

      {/* Multi-Run Machine Selector Bar */}
      <div className="bg-white p-3 rounded-lg border border-slate-300 shadow-2xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
            <span>Runs:</span>
          </span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {currentMachineRuns.map((r, idx) => {
              const runNum = r.runNo || idx + 1;
              const isSelected = (draft.runNo || 1) === runNum;
              return (
                <button
                  key={r.id || runNum}
                  type="button"
                  onClick={() => handleSelectRun(runNum)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-md border transition-all flex items-center gap-1.5 cursor-pointer ${
                    isSelected
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs ring-2 ring-blue-200'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                  }`}
                >
                  <span>Run #{runNum}</span>
                  {r.itemName && (
                    <span
                      className={`text-[10px] font-normal truncate max-w-28 ${
                        isSelected ? 'text-blue-100' : 'text-slate-500'
                      }`}
                    >
                      ({r.itemName})
                    </span>
                  )}
                  {r.actualOutput > 0 && (
                    <span
                      className={`text-[10px] px-1 py-0.2 rounded font-mono ${
                        isSelected
                          ? 'bg-blue-700 text-white'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {r.actualOutput} pcs
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {!isShiftLocked && (
            <button
              type="button"
              onClick={handleAddSplitRun}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 transition-colors cursor-pointer"
              title="Split job / add another run for this machine during this shift"
            >
              <Plus className="w-3.5 h-3.5 text-emerald-600" />
              <span>+ Add Split Run</span>
            </button>
          )}
          {!isShiftLocked && (draft.runNo || 1) > 1 && (
            <button
              type="button"
              onClick={() => handleRemoveSplitRun(draft.runNo || 1)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-md bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 transition-colors cursor-pointer"
              title={`Remove Run #${draft.runNo}`}
            >
              <X className="w-3.5 h-3.5" />
              <span>Remove Run #{draft.runNo}</span>
            </button>
          )}
        </div>

        {/* Machine Group Balance Status & Run Subtotal */}
        <div className="flex items-center gap-3 text-xs font-mono flex-wrap">
          {currentMachineRuns.length > 1 && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-100 border border-slate-200 text-slate-700">
              <span className="font-bold text-slate-900">Run #{draft.runNo || 1}:</span>
              <span>
                {Number(((draft.actualOutput || 0) * (draft.cycleTime || 0)).toFixed(1))}m prod +{' '}
                {calculateTotalBreakdown(draft.breakdown)}m BD ={' '}
                <strong className="text-slate-900">
                  {Number((((draft.actualOutput || 0) * (draft.cycleTime || 0)) + calculateTotalBreakdown(draft.breakdown)).toFixed(1))}m
                </strong>
              </span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">Mach Total:</span>
            <strong className="text-slate-900">
              {timeBalance.totalAccountedMinutes}m / {timeBalance.shiftMinutes}m
            </strong>
          </div>
          {timeBalance.isBalanced ? (
            <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[11px] border border-emerald-300 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              <span>Balanced</span>
            </span>
          ) : timeBalance.unaccountedMinutes > 0 ? (
            <button
              type="button"
              onClick={() => handleFillUnaccountedToField('noDisc', timeBalance.unaccountedMinutes)}
              disabled={isShiftLocked}
              className="px-2 py-0.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold text-[11px] border border-amber-300 flex items-center gap-1 cursor-pointer"
              title={`Auto-fill remaining ${timeBalance.unaccountedMinutes}m into NO/DISC of current run`}
            >
              <AlertTriangle className="w-3 h-3 text-amber-600" />
              <span>Missing {timeBalance.unaccountedMinutes}m (+Fill)</span>
            </button>
          ) : (
            <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-900 font-bold text-[11px] border border-rose-300">
              ⚠️ Over (+{Math.abs(timeBalance.unaccountedMinutes)}m)
            </span>
          )}
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
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Name of Operator <span className="text-rose-600">*</span>
                </label>
                {!isShiftLocked && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddOperatorModal(true);
                      setNewOperatorName('');
                      setQuickAddError(null);
                    }}
                    className="text-xs text-emerald-700 hover:text-emerald-800 font-semibold flex items-center gap-1 hover:underline transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Add Operator</span>
                  </button>
                )}
              </div>
              <select
                value={draft.operatorName}
                disabled={isShiftLocked}
                onChange={(e) =>
                  updateDraft({ operatorName: e.target.value })
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
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Machining Item / Component <span className="text-rose-600">*</span>
                </label>
                {!isShiftLocked && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddItemModal(true);
                      setNewItemCode('');
                      setNewItemName('');
                      setNewItemOperation('OP-10 Turning');
                      setQuickAddError(null);
                    }}
                    className="text-xs text-emerald-700 hover:text-emerald-800 font-semibold flex items-center gap-1 hover:underline transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Add Item</span>
                  </button>
                )}
              </div>
              <select
                value={getCanonicalItemId(draft.itemId, items)}
                disabled={isShiftLocked}
                onChange={(e) => handleItemSelect(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-md px-3 py-2 text-sm text-slate-900 font-medium focus:bg-white focus:border-slate-800 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <option value="">— Select Item from Master —</option>
                {uniqueItems.map((it) => {
                  const label =
                    it.itemCode &&
                    it.itemCode.trim().toLowerCase() !==
                      it.itemName.trim().toLowerCase()
                      ? `${it.itemName} (${it.itemCode})`
                      : it.itemName;
                  return (
                    <option key={it.id} value={it.id}>
                      {label}
                    </option>
                  );
                })}
                {draft.itemId &&
                  !uniqueItems.some(
                    (u) => u.id === getCanonicalItemId(draft.itemId, items)
                  ) && (
                    <option value={draft.itemId}>
                      {draft.itemName || draft.itemId}
                    </option>
                  )}
              </select>
            </div>
          </div>

          {/* Operation, Cycle Time & Std Output (4-Column Grid) */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 pt-1">
            <div className="sm:col-span-2">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Operation Name
                </label>
                {!isShiftLocked && draft.itemId && !showAddOpInput && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddOpInput(true);
                      setNewOperationName('');
                      setQuickAddError(null);
                    }}
                    className="text-xs text-emerald-700 hover:text-emerald-800 font-semibold flex items-center gap-1 hover:underline transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Add Operation</span>
                  </button>
                )}
              </div>

              {showAddOpInput ? (
                <div className="p-2.5 bg-slate-100 border border-slate-300 rounded-md space-y-2 animate-in fade-in duration-100">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700">
                      New Operation for {draft.itemName}:
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowAddOpInput(false)}
                      className="text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <input
                    type="text"
                    autoFocus
                    placeholder="e.g. OP-20 Drilling & Tapping"
                    value={newOperationName}
                    onChange={(e) => setNewOperationName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleQuickCreateOperation();
                      }
                      if (e.key === 'Escape') setShowAddOpInput(false);
                    }}
                    className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded bg-white focus:outline-none focus:border-slate-800"
                  />
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShowAddOpInput(false)}
                      className="px-2.5 py-1 text-xs text-slate-600 bg-slate-200 hover:bg-slate-300 rounded transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={isInlineSaving || !newOperationName.trim()}
                      onClick={handleQuickCreateOperation}
                      className="px-3 py-1 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded transition-colors shadow-2xs"
                    >
                      {isInlineSaving ? 'Saving...' : 'Save & Select'}
                    </button>
                  </div>
                </div>
              ) : !draft.itemId ? (
                <div className="w-full bg-slate-100 border border-slate-200 rounded-md px-3 py-2 text-sm text-slate-400 italic">
                  — Select Item First —
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <select
                    value={draft.operation}
                    disabled={isShiftLocked}
                    onChange={(e) => {
                      if (e.target.value === '__ADD_NEW_OP__') {
                        setShowAddOpInput(true);
                        setNewOperationName('');
                        return;
                      }
                      handleOperationSelect(e.target.value);
                    }}
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
                    {!isShiftLocked && (
                      <option value="__ADD_NEW_OP__" className="font-semibold text-emerald-600">
                        + Add New Operation...
                      </option>
                    )}
                  </select>
                  {!isShiftLocked && (
                    <button
                      type="button"
                      title="Add new operation for this item"
                      onClick={() => {
                        setShowAddOpInput(true);
                        setNewOperationName('');
                      }}
                      className="p-2 border border-slate-300 rounded-md bg-slate-50 hover:bg-slate-100 text-slate-600 hover:text-emerald-600 transition-colors shrink-0"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  )}
                </div>
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
                    if (currentMachineRuns.length > 1) {
                      const suggestedStd = calculateSplitRowSuggestedStd(
                        rows,
                        draft.id,
                        newCt,
                        shiftWorkingMinutes || draft.totalWorkingMinutes
                      );
                      updateDraft({
                        cycleTime: newCt,
                        stdOutput: suggestedStd,
                      });
                    } else {
                      updateDraft({
                        cycleTime: newCt,
                        stdOutput:
                          newCt > 0
                            ? Math.floor(
                                (shiftWorkingMinutes || draft.totalWorkingMinutes) / newCt
                              )
                            : 0,
                      });
                    }
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

            {/* Std Output Target (Auto-calculated; Locked for Non-Admins unless machine is split) */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Std Output (Shift)
              </label>
              <div className="flex items-center">
                <input
                  type="number"
                  min="0"
                  disabled={isShiftLocked || (!isAdmin && currentMachineRuns.length <= 1)}
                  readOnly={isShiftLocked || (!isAdmin && currentMachineRuns.length <= 1)}
                  title={
                    isShiftLocked
                      ? 'Shift is locked'
                      : currentMachineRuns.length > 1
                      ? 'Split Run Std Output Target (editable)'
                      : !isAdmin
                      ? 'Std Output is auto-calculated from Cycle Time (Unit Head override required to edit manually)'
                      : undefined
                  }
                  value={draft.stdOutput || ''}
                  placeholder="0"
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    if (isShiftLocked || (!isAdmin && currentMachineRuns.length <= 1)) return;
                    updateDraft({
                      stdOutput: Math.max(0, parseInt(e.target.value, 10) || 0),
                    });
                  }}
                  className={`w-full rounded-md px-3 py-2 text-sm font-mono font-bold text-slate-900 text-center border focus:outline-none ${
                    isShiftLocked || (!isAdmin && currentMachineRuns.length <= 1)
                      ? 'bg-slate-50 border-slate-300 disabled:opacity-75 disabled:cursor-not-allowed'
                      : 'bg-white border-slate-300 focus:border-slate-800'
                  }`}
                />
                <span className="ml-2 text-xs font-medium text-slate-500">pcs</span>
              </div>
              {currentMachineRuns.length > 1 && draft.stdOutput > 0 && draft.cycleTime > 0 && (
                <div className="text-[10px] text-slate-400 font-mono mt-0.5 text-right">
                  Target: {Number((draft.stdOutput * draft.cycleTime).toFixed(1))}m
                </div>
              )}
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
                  value={draft.actualOutput > 0 ? draft.actualOutput : ''}
                  placeholder="0"
                  onFocus={(e) => e.target.select()}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                  onChange={(e) => {
                    setValidationError(null);
                    const raw = e.target.value;
                    const parsed = raw === '' ? 0 : parseInt(raw, 10);
                    updateDraft({
                      actualOutput: isNaN(parsed) ? 0 : Math.max(0, parsed),
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
                    !isShiftLocked && updateDraft({ actualOutput: draft.stdOutput })
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
                    updateDraft({
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
                    updateDraft({ actualOutput: draft.stdOutput + 5 })
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
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const parsed = raw === '' ? 0 : parseInt(raw, 10);
                    updateDraft({ rework: isNaN(parsed) ? 0 : Math.max(0, parsed) });
                  }}
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

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
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
                        step="0.01"
                        disabled={isShiftLocked}
                        readOnly={isShiftLocked}
                        value={
                          editingBdField === card.key
                            ? editingBdText
                            : val > 0
                            ? val
                            : ''
                        }
                        placeholder="0"
                        onFocus={(e) => {
                          e.target.select();
                          setEditingBdField(card.key);
                          setEditingBdText(val > 0 ? String(val) : '');
                        }}
                        onBlur={() => {
                          setEditingBdField(null);
                        }}
                        onClick={(e) => (e.target as HTMLInputElement).select()}
                        onChange={(e) => {
                          setValidationError(null);
                          const raw = e.target.value;
                          setEditingBdField(card.key);
                          setEditingBdText(raw);
                          const parsed = parseFloat(raw);
                          updateDraft({
                            breakdown: {
                              ...draft.breakdown,
                              [card.key]:
                                raw === '' || isNaN(parsed)
                                  ? 0
                                  : Number(Math.max(0, parsed).toFixed(2)),
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
            onChange={(e) => updateDraft({ remarks: e.target.value })}
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
      {renderQuickAddModals()}
    </div>
  );
}

export default OperatorKiosk;