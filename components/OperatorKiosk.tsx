"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  CheckCircle2,
  AlertTriangle,
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
  Search,
} from "lucide-react";
import {
  MachineShiftRow,
  MasterDataState,
  ShiftType,
  ShiftLockInfo,
  MachineMaster,
} from "@/types";
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
  resolveMachineItemTarget,
} from "@/services/storageService";
import {
  addOperatorMaster,
  upsertItemMaster,
  upsertMachineMaster,
  upsertMachineItemCycleTime,
} from "@/actions/shiftActions";
import { useFeedback } from "@/context/FeedbackContext";

export interface OperatorKioskProps {
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
  onSelectMachine?: (machineId: string | null) => void;
  onSelectMachineId?: (machineId: string | null) => void;
  returnTab?: string | null;
  onReturnBack?: () => void;
  isAdmin?: boolean;
  isReadOnly?: boolean;
  isShiftLocked?: boolean;
  shiftLock?: ShiftLockInfo;
}

type BreakdownKey =
  | "noDisc"
  | "change"
  | "power"
  | "operator"
  | "machineBreakdown"
  | "fixProgSettings"
  | "miscellaneous";

interface BreakdownMeta {
  key: BreakdownKey;
  label: string;
  sublabel: string;
  step1: number;
  step2: number;
  badgeBg: string;
  cardBorder: string;
}

const BD_CONFIG: BreakdownMeta[] = [
  {
    key: "noDisc",
    label: "NO/DISC",
    sublabel: "Material/Disc shortage",
    step1: 5,
    step2: 15,
    badgeBg: "bg-amber-100 text-amber-800 border-amber-200",
    cardBorder: "border-amber-200/80 hover:border-amber-400",
  },
  {
    key: "change",
    label: "CHANGE",
    sublabel: "Tool insert/Job setup",
    step1: 10,
    step2: 20,
    badgeBg: "bg-sky-100 text-sky-800 border-sky-200",
    cardBorder: "border-sky-200/80 hover:border-sky-400",
  },
  {
    key: "power",
    label: "POWER",
    sublabel: "Power outage/Trip",
    step1: 15,
    step2: 30,
    badgeBg: "bg-rose-100 text-rose-800 border-rose-200",
    cardBorder: "border-rose-200/80 hover:border-rose-400",
  },
  {
    key: "operator",
    label: "OPERATOR",
    sublabel: "Unattended/Delay",
    step1: 5,
    step2: 15,
    badgeBg: "bg-purple-100 text-purple-800 border-purple-200",
    cardBorder: "border-purple-200/80 hover:border-purple-400",
  },
  {
    key: "machineBreakdown",
    label: "BREAK DOWN",
    sublabel: "Machine/Mech fault",
    step1: 15,
    step2: 30,
    badgeBg: "bg-orange-100 text-orange-800 border-orange-200",
    cardBorder: "border-orange-200/80 hover:border-orange-400",
  },
  {
    key: "fixProgSettings",
    label: "FIX/PROG",
    sublabel: "Fixture/Program setting",
    step1: 5,
    step2: 15,
    badgeBg: "bg-indigo-100 text-indigo-800 border-indigo-200",
    cardBorder: "border-indigo-200/80 hover:border-indigo-400",
  },
  {
    key: "miscellaneous",
    label: "MISC.",
    sublabel: "Other/Misc downtime",
    step1: 5,
    step2: 15,
    badgeBg: "bg-teal-100 text-teal-800 border-teal-200",
    cardBorder: "border-teal-200/80 hover:border-teal-400",
  },
];

const REMARKS_CHIPS = [
  "Tool wear insert changed",
  "Setup / program delay",
  "Feeder / power trip",
  "Operator tea / lunch break",
  "Disc shortage / waiting material",
  "Maintenance checked spindle",
];

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
  onSelectMachine: externalOnSelectMachine,
  onSelectMachineId: externalOnSelectMachineId,
  returnTab,
  onReturnBack,
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

  // Master quick-add modals
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

  const [showAddTempMachineBar, setShowAddTempMachineBar] = useState(false);
  const [tempMachineName, setTempMachineName] = useState("");
  const [tempMachineCode, setTempMachineCode] = useState("");

  // Inline Machine Edit state (in single-machine view header)
  const [isEditingMachine, setIsEditingMachine] = useState(false);
  const [editMachineName, setEditMachineName] = useState("");
  const [editMachineCode, setEditMachineCode] = useState("");
  const [editMachineType, setEditMachineType] = useState("CNC");

  const [isInlineSaving, setIsInlineSaving] = useState(false);
  const [quickAddError, setQuickAddError] = useState<string | null>(null);

  // Controlled/uncontrolled machine selection
  const [internalMachineId, setInternalMachineId] = useState<string | null>(null);
  const [activeRunNo, setActiveRunNo] = useState<number>(1);

  const selectedMachineId =
    externalMachineId !== undefined ? externalMachineId : internalMachineId;

  const onSelectMachineHandler = externalOnSelectMachine || externalOnSelectMachineId;

  const onSelectMachineId = useCallback(
    (machineId: string | null) => {
      setActiveRunNo(1);
      if (onSelectMachineHandler) {
        onSelectMachineHandler(machineId);
      } else {
        setInternalMachineId(machineId);
      }
    },
    [onSelectMachineHandler]
  );

  const returnTabLabel = useMemo(() => {
    if (returnTab === "sheet") return "Daily Shift Sheet";
    if (returnTab === "analytics") return "Analytics & Power BI";
    if (returnTab === "settings" || returnTab === "master") return "Master Data";
    return "Previous View";
  }, [returnTab]);

  // Draft state & validation
  const [draft, setDraft] = useState<MachineShiftRow | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState(false);

  // Active breakdown field editing state (to prevent text jump on decimal typing)
  const [editingBdField, setEditingBdField] = useState<BreakdownKey | null>(null);
  const [editingBdText, setEditingBdText] = useState<string>("");

  // Active cycle time input editing state
  const [editingCtText, setEditingCtText] = useState<string | null>(null);

  // Grid view search & filter state
  const [gridSearchQuery, setGridSearchQuery] = useState("");
  const [gridStatusFilter, setGridStatusFilter] = useState<"all" | "active" | "pending" | "mismatch">("all");

  // Fetched shift minutes
  const activeShiftObj = masterData.shifts?.find(
    (s) => s.displayName === selectedShift || s.shiftCode === selectedShift
  );
  const shiftWorkingMinutes =
    activeShiftObj?.shiftWorkingMinutes ??
    rows[0]?.totalWorkingMinutes ??
    0;

  // Filter machines for current production line (including temporary machines for this shift)
  const lineMachines = useMemo(() => {
    const targetLine = (selectedLine || "Line 1").trim().toLowerCase();
    const perms = machines.filter(
      (m) =>
        (m.line || "Line 1").trim().toLowerCase() === targetLine &&
        (m.status || "").trim().toLowerCase() !== "disabled"
    );

    const tempMachines: MachineMaster[] = [];
    const seenTempIds = new Set<string>();

    for (const r of rows) {
      if ((r.line || "Line 1").trim().toLowerCase() !== targetLine) continue;
      const isTemp =
        Boolean(r.isTempMachine) === true &&
        String(r.machineId || "").startsWith("temp_");

      if (isTemp && !seenTempIds.has(r.machineId)) {
        seenTempIds.add(r.machineId);
        tempMachines.push({
          id: r.machineId,
          name: r.machineName || "Temp Machine",
          code: r.machineCode || "",
          line: r.line || selectedLine,
          type: "TEMP",
          status: "active",
        });
      }
    }

    return [...perms, ...tempMachines];
  }, [machines, rows, selectedLine]);

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
    const machine =
      lineMachines.find((m) => m.id === selectedMachineId) ||
      machines.find((m) => m.id === selectedMachineId) ||
      (matchingRows[0]
        ? {
            id: matchingRows[0].machineId,
            name: matchingRows[0].machineName || "Temp Machine",
            code: matchingRows[0].machineCode || "TEMP",
            line: matchingRows[0].line || selectedLine,
            type: "TEMP",
            status: "active",
          }
        : undefined);

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
          isTempMachine: machine.type === "TEMP" || machine.id.startsWith("temp_"),
          machineId: machine.id,
          machineCode: machine.code || undefined,
          machineName: machine.name,
          operatorName: "",
          itemId: "",
          itemName: "",
          operation: "",
          cycleTime: 0,
          totalWorkingMinutes: shiftWorkingMinutes || 1305,
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
            miscellaneous: 0,
          },
          remarks: "",
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

  // Active machine's run list
  const currentMachineRuns = useMemo(() => {
    if (!selectedMachineId) return [];
    const matched = rows.filter((r) => r.machineId === selectedMachineId);
    if (!draft) return matched;
    if (!matched.some((r) => (r.runNo || 1) === (draft.runNo || 1))) {
      return [...matched, draft];
    }
    return matched.map((r) => ((r.runNo || 1) === (draft.runNo || 1) ? draft : r));
  }, [rows, selectedMachineId, draft]);

  // Overall time balance across all runs of this machine
  const timeBalance = useMemo(() => {
    if (!selectedMachineId) {
      return calculateShiftTimeBalance(draft || ({} as MachineShiftRow), rowShiftMins);
    }
    return calculateMachineGroupTimeBalance(currentMachineRuns, selectedMachineId, rowShiftMins);
  }, [currentMachineRuns, selectedMachineId, draft, rowShiftMins]);

  // Update current active run draft, sync to rows, and recalculate proportional stdOutput
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

      // If single run, recalculate stdOutput. If multi-run and user explicitly changed stdOutput, preserve manual entry
      const balanced = recalculateMachineGroupStdOutputs(
        syncedRows,
        selectedMachineId,
        shiftWorkingMinutes || draft.totalWorkingMinutes
      );

      const refreshedDraft = balanced.find(
        (r) => r.machineId === selectedMachineId && (r.runNo || 1) === (draft.runNo || 1)
      );
      if (refreshedDraft && refreshedDraft.stdOutput !== updatedDraft.stdOutput && currentMachineRuns.length === 1) {
        setDraft(refreshedDraft);
      }
      if (onRowsChange) {
        onRowsChange(balanced);
      }
    }
  };

  // Add a split run to this machine
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
      isTempMachine: Boolean(baseRun.isTempMachine || baseRun.machineId?.startsWith("temp_")),
      machineId: selectedMachineId,
      machineName: baseRun.machineName,
      machineCode: baseRun.machineCode,
      operatorName: baseRun.operatorName || "",
      itemId: "",
      itemName: "",
      operation: "",
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
        miscellaneous: 0,
      },
      remarks: "",
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

  // Remove a split run
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

  // Switch active split run tab
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

  // Item dropdown selection
  const handleItemSelect = (itemId: string) => {
    if (isShiftLocked || !draft) return;
    setValidationError(null);

    if (!itemId) {
      updateDraft({
        itemId: "",
        itemName: "",
        operation: "",
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

  // Operation dropdown selection
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

  // Stepper helpers
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

  // Breakdown step adjustment (+5, +15, etc.)
  const handleBreakdownStep = (field: BreakdownKey, delta: number) => {
    if (isShiftLocked || !draft) return;
    setValidationError(null);
    if (editingBdField === field) {
      setEditingBdField(null);
      setEditingBdText("");
    }
    const currentVal = Number(draft.breakdown?.[field]) || 0;
    const nextVal = Number(Math.max(0, currentVal + delta).toFixed(2));
    updateDraft({
      breakdown: {
        ...draft.breakdown,
        [field]: nextVal,
      },
    });
  };

  // 1-Tap Fill remaining unaccounted minutes
  const handleFillUnaccountedToField = (field: BreakdownKey, unaccountedMins: number) => {
    if (isShiftLocked || !draft || unaccountedMins <= 0) return;
    setValidationError(null);
    if (editingBdField === field) {
      setEditingBdField(null);
      setEditingBdText("");
    }
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
    const existing = draft.remarks ? draft.remarks + "; " : "";
    updateDraft({ remarks: existing + chip });
  };

  // Create temporary machine
  const handleAddTempMachine = useCallback(() => {
    if (isShiftLocked) return;
    const trimmedName = tempMachineName.trim();
    if (!trimmedName) {
      alert("Please enter a Temporary Machine Name");
      return;
    }

    const lineSlug = selectedLine.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const tempId = `temp_${lineSlug}_${Date.now()}`;
    const maxSrNo = rows.reduce((max, r) => Math.max(max, Number(r.srNo) || 0), 0);
    const rowShiftMins = shiftWorkingMinutes || rows[0]?.totalWorkingMinutes || 1305;

    const newRow: MachineShiftRow = {
      id: `${selectedDate}_${selectedShift}_${selectedLine}_${tempId}`,
      date: selectedDate,
      shift: selectedShift,
      line: selectedLine,
      productionLine: selectedLine,
      srNo: maxSrNo + 1,
      runNo: 1,
      isTempMachine: true,
      machineId: tempId,
      machineCode: tempMachineCode.trim() || undefined,
      machineName: trimmedName,
      operatorName: "",
      itemId: "",
      itemName: "",
      operation: "",
      cycleTime: 0,
      totalWorkingMinutes: rowShiftMins,
      shiftWorkingMinutes: rowShiftMins,
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
        miscellaneous: 0,
      },
      breakdownPct: {
        noDiscPct: 0,
        changePct: 0,
        powerPct: 0,
        operatorPct: 0,
        machineBreakdownPct: 0,
        fixProgSettingsPct: 0,
        miscellaneousPct: 0,
        totalBdMinutes: 0,
        totalBdPct: 0,
      },
      remarks: "",
    };

    if (onRowsChange) {
      onRowsChange([...rows, newRow]);
    }
    setTempMachineName("");
    setTempMachineCode("");
    setShowAddTempMachineBar(false);
    onSelectMachineId(tempId);
  }, [
    isShiftLocked,
    tempMachineName,
    tempMachineCode,
    selectedLine,
    selectedDate,
    selectedShift,
    rows,
    shiftWorkingMinutes,
    onRowsChange,
    onSelectMachineId,
  ]);

  // Master Data Quick Creates
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

          if (
            draft.machineId &&
            !draft.machineId.startsWith("temp_") &&
            !draft.isTempMachine &&
            draft.itemId &&
            (draft.cycleTime || 0) > 0
          ) {
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
                miscellaneous: 0,
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

  // Submit entry with full validation
  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
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
                : "Please select the operator name for this machine."
            );
            return;
          }
          if (!run.itemId) {
            setValidationError(
              runsToSave.length > 1
                ? `Please select an Item for Run #${run.runNo || 1}.`
                : "Please select the item/component being machined."
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

  // Prev / Next Machine Navigation
  const allNavigableMachines = useMemo(() => {
    if (
      draft &&
      selectedMachineId &&
      !lineMachines.some((m) => m.id === selectedMachineId)
    ) {
      return [
        ...lineMachines,
        {
          id: draft.machineId,
          name: draft.machineName || "Temp Machine",
          code: draft.machineCode || "",
          line: draft.line || selectedLine,
          type: "TEMP",
          status: "active",
        },
      ];
    }
    return lineMachines;
  }, [lineMachines, draft, selectedMachineId, selectedLine]);

  const currentIdx = allNavigableMachines.findIndex((m) => m.id === selectedMachineId);
  const prevMachine = currentIdx > 0 ? allNavigableMachines[currentIdx - 1] : null;
  const nextMachine =
    currentIdx >= 0 && currentIdx < allNavigableMachines.length - 1
      ? allNavigableMachines[currentIdx + 1]
      : null;

  const handlePrevMachine = useCallback(() => {
    if (prevMachine) {
      onSelectMachineId(prevMachine.id);
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "instant" });
      }
    }
  }, [prevMachine, onSelectMachineId]);

  const handleNextMachine = useCallback(() => {
    if (nextMachine) {
      onSelectMachineId(nextMachine.id);
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "instant" });
      }
    }
  }, [nextMachine, onSelectMachineId]);

  // Render quick add modals
  const renderQuickAddModals = () => {
    if (!showAddOperatorModal && !showAddItemModal) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-2xs">
        <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden">
          <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              {showAddOperatorModal ? (
                <UserPlus className="w-4 h-4 text-emerald-400" />
              ) : (
                <PackagePlus className="w-4 h-4 text-emerald-400" />
              )}
              <h3 className="text-sm font-bold tracking-tight">
                {showAddOperatorModal ? "Add New Operator" : "Add New Item & Operation"}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => {
                if (isInlineSaving) return;
                setShowAddOperatorModal(false);
                setShowAddItemModal(false);
                setNewOperatorName("");
                setNewItemCode("");
                setNewItemName("");
                setNewItemOperation("");
              }}
              className="text-slate-400 hover:text-white p-1 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {showAddOperatorModal ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleQuickCreateOperator();
              }}
              className="p-4 space-y-3.5"
            >
              {quickAddError && (
                <div className="p-2 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded font-medium">
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
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-md focus:border-slate-800 focus:outline-none"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={isInlineSaving}
                  onClick={() => {
                    setShowAddOperatorModal(false);
                    setNewOperatorName("");
                  }}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isInlineSaving || !newOperatorName.trim()}
                  className="px-4 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 rounded shadow-xs transition-colors"
                >
                  {isInlineSaving ? "Adding..." : "Add & Assign"}
                </button>
              </div>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleQuickCreateItem();
              }}
              className="p-4 space-y-3"
            >
              {quickAddError && (
                <div className="p-2 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded font-medium">
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
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded font-mono focus:border-slate-800 focus:outline-none"
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
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded focus:border-slate-800 focus:outline-none"
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
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded focus:border-slate-800 focus:outline-none"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={isInlineSaving}
                  onClick={() => {
                    setShowAddItemModal(false);
                    setNewItemCode("");
                    setNewItemName("");
                    setNewItemOperation("");
                  }}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
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
                  className="px-4 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 rounded shadow-xs transition-colors"
                >
                  {isInlineSaving ? "Adding..." : "Add & Select"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  };

  // ============================================================================
  // PART 1: HIGH-DENSITY MACHINE PICKER GRID (when no machine is selected)
  // ============================================================================
  if (!selectedMachineId || !draft) {
    // Filter machine list by search query & status pill
    const filteredMachines = lineMachines.filter((machine) => {
      const machRuns = rows.filter((r) => r.machineId === machine.id);
      const isRowActive = machRuns.some(
        (r) =>
          !!r.itemId ||
          !!r.operatorName ||
          (r.actualOutput || 0) > 0 ||
          calculateTotalBreakdown(r.breakdown) > 0 ||
          (r.cycleTime || 0) > 0
      );
      const rowShiftMins = shiftWorkingMinutes || machRuns[0]?.totalWorkingMinutes || 0;
      const balance = isRowActive
        ? calculateMachineGroupTimeBalance(rows, machine.id, rowShiftMins)
        : null;
      const hasTimeMismatch = isRowActive && balance && !balance.isBalanced;

      if (gridStatusFilter === "active" && !isRowActive) return false;
      if (gridStatusFilter === "pending" && isRowActive) return false;
      if (gridStatusFilter === "mismatch" && !hasTimeMismatch) return false;

      if (gridSearchQuery.trim()) {
        const q = gridSearchQuery.toLowerCase();
        const matchesName = (machine.name || "").toLowerCase().includes(q);
        const matchesCode = (machine.code || "").toLowerCase().includes(q);
        const matchesItem = machRuns.some((r) => (r.itemName || "").toLowerCase().includes(q));
        const matchesOp = machRuns.some((r) => (r.operatorName || "").toLowerCase().includes(q));
        if (!matchesName && !matchesCode && !matchesItem && !matchesOp) return false;
      }
      return true;
    });

    // Counts for filter pills
    let countActive = 0;
    let countPending = 0;
    let countMismatch = 0;

    for (const machine of lineMachines) {
      const machRuns = rows.filter((r) => r.machineId === machine.id);
      const isRowActive = machRuns.some(
        (r) =>
          !!r.itemId ||
          !!r.operatorName ||
          (r.actualOutput || 0) > 0 ||
          calculateTotalBreakdown(r.breakdown) > 0 ||
          (r.cycleTime || 0) > 0
      );
      const rowShiftMins = shiftWorkingMinutes || machRuns[0]?.totalWorkingMinutes || 0;
      const balance = isRowActive
        ? calculateMachineGroupTimeBalance(rows, machine.id, rowShiftMins)
        : null;
      const hasTimeMismatch = isRowActive && balance && !balance.isBalanced;

      if (hasTimeMismatch) countMismatch++;
      if (isRowActive) countActive++;
      else countPending++;
    }

    return (
      <div className="space-y-3">
        {/* Shift Lock Banner */}
        {isShiftLocked && (
          <div className="bg-rose-950 border border-rose-500/60 rounded-lg p-2.5 sm:p-3 text-rose-100 flex flex-wrap items-center justify-between gap-2 shadow-xs text-xs font-semibold">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{shiftLock?.reason || "Shift Locked — 30-minute grace window expired."}</span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider bg-rose-900 text-rose-200 px-2 py-0.5 rounded border border-rose-700">
              Read-Only
            </span>
          </div>
        )}

        {/* Grace Period Banner */}
        {!isShiftLocked && shiftLock?.status === "grace_period" && (
          <div className="bg-amber-950 border border-amber-500/60 rounded-lg p-2.5 sm:p-3 text-amber-100 flex flex-wrap items-center justify-between gap-2 shadow-xs text-xs font-semibold">
            <div className="flex items-center gap-2">
              <span className="text-sm animate-pulse">⏳</span>
              <span>
                Shift ended — <strong>{shiftLock.remainingMinutes} mins left</strong> to complete logging.
              </span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-800 text-amber-100 px-2 py-0.5 rounded border border-amber-600">
              Grace Active
            </span>
          </div>
        )}

        {/* Top Control Strip */}
        <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs flex flex-wrap items-center justify-between gap-2">
          {/* Left: Search input */}
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Filter machine, part, operator..."
              value={gridSearchQuery}
              onChange={(e) => setGridSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-slate-800 focus:outline-none"
            />
          </div>

          {/* Center: Status filter pills */}
          <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-md">
            <button
              type="button"
              onClick={() => setGridStatusFilter("all")}
              className={`px-2.5 py-1 text-[11px] font-bold rounded transition-colors ${
                gridStatusFilter === "all"
                  ? "bg-white text-slate-900 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              All ({lineMachines.length})
            </button>
            <button
              type="button"
              onClick={() => setGridStatusFilter("active")}
              className={`px-2.5 py-1 text-[11px] font-bold rounded transition-colors ${
                gridStatusFilter === "active"
                  ? "bg-emerald-600 text-white shadow-2xs"
                  : "text-emerald-800 hover:bg-emerald-50"
              }`}
            >
              Active ({countActive})
            </button>
            <button
              type="button"
              onClick={() => setGridStatusFilter("pending")}
              className={`px-2.5 py-1 text-[11px] font-bold rounded transition-colors ${
                gridStatusFilter === "pending"
                  ? "bg-slate-700 text-white shadow-2xs"
                  : "text-slate-600 hover:bg-slate-200"
              }`}
            >
              Pending ({countPending})
            </button>
            {countMismatch > 0 && (
              <button
                type="button"
                onClick={() => setGridStatusFilter("mismatch")}
                className={`px-2.5 py-1 text-[11px] font-bold rounded transition-colors ${
                  gridStatusFilter === "mismatch"
                    ? "bg-rose-600 text-white shadow-2xs"
                    : "text-rose-700 hover:bg-rose-50"
                }`}
              >
                Mismatch ({countMismatch})
              </button>
            )}
          </div>

          {/* Right: + Add Temp Machine & Quick Action buttons */}
          {!isShiftLocked && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setShowAddTempMachineBar((prev) => !prev)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded bg-amber-600 hover:bg-amber-500 text-white shadow-2xs transition-colors cursor-pointer"
                title="Add temporary machine to this shift (not saved to Master Data)"
              >
                <Plus className="w-3 h-3" />
                <span>+ Temp Machine</span>
              </button>
              <button
                type="button"
                onClick={() => setShowAddMachineBar((prev) => !prev)}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded bg-slate-900 hover:bg-slate-800 text-white shadow-2xs transition-colors cursor-pointer"
              >
                <Plus className="w-3 h-3 text-emerald-400" />
                <span>Machine</span>
              </button>
              <button
                type="button"
                onClick={() => setShowAddOperatorModal(true)}
                className="hidden sm:inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 transition-colors"
              >
                <UserPlus className="w-3 h-3 text-emerald-600" />
                <span>Operator</span>
              </button>
              <button
                type="button"
                onClick={() => setShowAddItemModal(true)}
                className="hidden sm:inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 transition-colors"
              >
                <PackagePlus className="w-3 h-3 text-emerald-600" />
                <span>Item</span>
              </button>
            </div>
          )}
        </div>

        {/* Inline Add Machine Strip */}
        {showAddMachineBar && !isShiftLocked && (
          <div className="flex flex-wrap items-center gap-2 p-2.5 bg-slate-50 border border-slate-300 rounded-lg shadow-2xs">
            <span className="text-xs font-bold text-slate-700">
              New Permanent Machine ({selectedLine}):
            </span>
            <input
              type="text"
              placeholder="Machine Name (e.g. MAKINO-130)"
              value={newMachineName}
              onChange={(e) => setNewMachineName(e.target.value)}
              className="px-2 py-1 text-xs border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:border-slate-800"
            />
            <input
              type="text"
              placeholder="Code (e.g. MC-130)"
              value={newMachineCode}
              onChange={(e) => setNewMachineCode(e.target.value)}
              className="px-2 py-1 text-xs border border-slate-300 rounded bg-white text-slate-900 w-24 font-mono focus:outline-none focus:border-slate-800"
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
              className="px-3 py-1 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded shadow-2xs transition-colors"
            >
              {isInlineSaving ? "Saving..." : "Create Machine"}
            </button>
            <button
              type="button"
              onClick={() => setShowAddMachineBar(false)}
              className="px-2 py-1 text-xs text-slate-600 hover:text-slate-800"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Inline Add Temp Machine Strip */}
        {showAddTempMachineBar && !isShiftLocked && (
          <div className="flex flex-wrap items-center gap-2 p-2.5 bg-amber-50 border border-amber-300 rounded-lg shadow-2xs">
            <span className="text-xs font-bold text-amber-900 flex items-center gap-1">
              <span className="px-1.5 py-0.2 rounded text-[9px] bg-amber-500 text-slate-950 font-black tracking-wider uppercase">
                TEMP
              </span>
              <span>Temporary Machine:</span>
            </span>
            <input
              type="text"
              placeholder="Machine Name * (e.g. EXTRA-CNC-01)"
              value={tempMachineName}
              onChange={(e) => setTempMachineName(e.target.value)}
              className="px-2 py-1 text-xs border border-amber-300 rounded bg-white text-slate-900 font-medium placeholder-slate-400 focus:outline-none focus:border-amber-600"
            />
            <input
              type="text"
              placeholder="Code (Optional)"
              value={tempMachineCode}
              onChange={(e) => setTempMachineCode(e.target.value)}
              className="px-2 py-1 text-xs border border-amber-300 rounded bg-white text-slate-900 font-mono placeholder-slate-400 w-28 focus:outline-none focus:border-amber-600"
            />
            <button
              type="button"
              onClick={handleAddTempMachine}
              className="px-3 py-1 text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white rounded transition-colors cursor-pointer"
            >
              Add & Open
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddTempMachineBar(false);
                setTempMachineName("");
                setTempMachineCode("");
              }}
              className="px-2 py-1 text-xs text-slate-600 hover:text-slate-800"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Responsive High-Density Machine Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 sm:gap-2.5">
          {filteredMachines.map((machine, index) => {
            const machRuns = rows.filter((r) => r.machineId === machine.id);
            const totalAct = machRuns.reduce((s, r) => s + (Number(r.actualOutput) || 0), 0);
            const totalStd = machRuns.reduce((s, r) => s + (Number(r.stdOutput) || 0), 0);
            const totalBd = Number(
              machRuns.reduce((s, r) => s + calculateTotalBreakdown(r.breakdown), 0).toFixed(2)
            );
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

            // Border color: Emerald = Balanced & Logged, Rose/Amber = Mismatch, Slate = Idle
            const cardBorderClass = hasTimeMismatch
              ? balance.missingCycleTime || balance.isProductionExceeded || balance.isOver
                ? "border-l-4 border-l-rose-500 bg-rose-50/25 border-slate-200 hover:border-rose-400"
                : "border-l-4 border-l-amber-500 bg-amber-50/25 border-slate-200 hover:border-amber-400"
              : isRowActive && balance?.isBalanced
              ? "border-l-4 border-l-emerald-500 bg-white border-slate-200 hover:border-emerald-400"
              : "border-l-4 border-l-slate-300 bg-white border-slate-200 hover:border-slate-400";

            return (
              <button
                key={machine.id}
                type="button"
                onClick={() => onSelectMachineId(machine.id)}
                className={`relative text-left p-2.5 sm:p-3 rounded-lg border shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between min-h-[118px] group cursor-pointer ${cardBorderClass}`}
              >
                <div>
                  {/* Card Header: Sr/Index + Badges */}
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-[10px] font-mono font-bold text-slate-500">
                        #{index + 1}
                      </span>
                      {machRuns.length > 1 && (
                        <span className="px-1 py-0.2 rounded bg-blue-100 text-blue-800 text-[9px] font-bold">
                          {machRuns.length} runs
                        </span>
                      )}
                      {(machine.type === "TEMP" ||
                        machRuns.some((r) => r.isTempMachine || r.machineId?.startsWith("temp_"))) && (
                        <span className="px-1 py-0.2 rounded bg-amber-100 text-amber-900 text-[8px] font-black uppercase tracking-wider">
                          TEMP
                        </span>
                      )}
                    </div>

                    {/* Right status badge */}
                    {hasTimeMismatch ? (
                      <span className="text-[9px] font-bold text-rose-700 bg-rose-100 px-1.5 py-0.2 rounded flex items-center gap-0.5">
                        <AlertTriangle className="w-2.5 h-2.5 shrink-0 text-rose-600" />
                        <span>
                          {balance.missingCycleTime
                            ? "No CT"
                            : balance.isProductionExceeded || balance.isOver
                            ? "Over"
                            : `+${balance.unaccountedMinutes}m`}
                        </span>
                      </span>
                    ) : isLogged ? (
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                          efficiency >= 90
                            ? "bg-emerald-100 text-emerald-800"
                            : efficiency >= 75
                            ? "bg-amber-100 text-amber-800"
                            : "bg-rose-100 text-rose-800"
                        }`}
                      >
                        {efficiency}%
                      </span>
                    ) : (
                      <span className="text-[9px] font-medium text-slate-400 bg-slate-100 px-1 py-0.2 rounded">
                        Idle
                      </span>
                    )}
                  </div>

                  {/* Machine Name & Code */}
                  <h3 className="font-bold text-xs sm:text-sm text-slate-900 leading-tight group-hover:text-blue-700 transition-colors line-clamp-1">
                    {machine.name}
                  </h3>
                  <p className="text-[10px] text-slate-500 font-mono truncate mt-0.5">
                    {machRuns[0]?.itemName || machRuns[0]?.itemId || "No Item Assigned"}
                  </p>
                </div>

                {/* Card Footer: Metrics & Time */}
                <div className="pt-1.5 border-t border-slate-100 text-[10px] flex items-center justify-between text-slate-600 font-mono">
                  {isRowActive ? (
                    <>
                      <span>
                        <strong className="text-slate-900">{totalAct}</strong> / {totalStd}
                      </span>
                      <span>
                        {balance?.isBalanced ? (
                          <span className="text-emerald-700 font-bold">
                            ✓ {balance.isFullTargetBalanced && (balance.cycleRemainderMinutes ?? 0) > 0 ? `${balance.cycleRemainderMinutes}m rem.` : `${balance.shiftMinutes}m`}
                          </span>
                        ) : (
                          <span className="text-amber-700 font-semibold">{totalBd}m BD</span>
                        )}
                      </span>
                    </>
                  ) : (
                    <span className="text-slate-400 flex items-center justify-between w-full">
                      <span>Click to log</span>
                      <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </span>
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
  // PART 2: ZERO-SCROLL DESKTOP COCKPIT & MOBILE HANDHELD WORKSPACE
  // ============================================================================
  const totalBreakdown = calculateTotalBreakdown(draft.breakdown);
  const efficiency =
    draft.stdOutput > 0
      ? calculateEfficiency(draft.actualOutput, draft.stdOutput)
      : 0;

  // Active run productive minutes and total accounted
  const runProdMins = Number(
    ((Number(draft.actualOutput) || 0) * (Number(draft.cycleTime) || 0)).toFixed(1)
  );
  const runTotalMins = Number((runProdMins + totalBreakdown).toFixed(1));

  // Machine total output and efficiency across all runs
  const totalMachAct = currentMachineRuns.reduce((sum, r) => sum + (Number(r.actualOutput) || 0), 0);
  const totalMachStd = currentMachineRuns.reduce((sum, r) => sum + (Number(r.stdOutput) || 0), 0);
  const machEfficiency = totalMachStd > 0 ? calculateEfficiency(totalMachAct, totalMachStd) : efficiency;

  // Operations list for active item
  const draftOperations = draft.itemId
    ? getOperationsForItem(
        draft.itemId,
        items,
        cycleTimes,
        draft.machineId,
        draft.machineName
      )
    : [];

  const hasEnteredOutputOrBd =
    (draft.actualOutput || 0) > 0 ||
    totalBreakdown > 0 ||
    (!!draft.itemId && draft.cycleTime > 0) ||
    currentMachineRuns.some(
      (r) => (r.actualOutput || 0) > 0 || calculateTotalBreakdown(r.breakdown) > 0
    );

  const hasEntryError = hasEnteredOutputOrBd && !timeBalance.isBalanced;

  // Shift progress bar percentages
  const prodPct =
    rowShiftMins > 0
      ? Math.min(100, Math.round((timeBalance.productionMinutes / rowShiftMins) * 100))
      : 0;
  const bdPct =
    rowShiftMins > 0
      ? Math.min(100 - prodPct, Math.round((timeBalance.loggedBreakdownMinutes / rowShiftMins) * 100))
      : 0;

  return (
    <div className="space-y-2">
      {/* Shift Lock Banner (Compact) */}
      {isShiftLocked && (
        <div className="bg-rose-950 border border-rose-500/60 rounded-md p-2 text-rose-100 flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 font-semibold">
            <Lock className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            <span>{shiftLock?.reason || "Shift Locked (Read-Only)"}</span>
          </div>
          <span className="text-[10px] font-bold uppercase bg-rose-900 text-rose-200 px-1.5 py-0.2 rounded border border-rose-700">
            Read-Only
          </span>
        </div>
      )}

      {/* Validation Alert */}
      {validationError && (
        <div className="bg-rose-50 border border-rose-300 rounded-md p-2 text-rose-900 text-xs flex items-center justify-between gap-2 shadow-2xs animate-in fade-in">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="font-medium">{validationError}</span>
          </div>
          <button
            type="button"
            onClick={() => setValidationError(null)}
            className="text-rose-500 hover:text-rose-800 p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Success Notification */}
      {saveSuccessMsg && (
        <div className="bg-emerald-50 border border-emerald-300 rounded-md p-2 text-emerald-900 text-xs flex items-center gap-1.5 shadow-2xs animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="font-semibold">Machine entry saved successfully!</span>
        </div>
      )}

      {/* 1. Compact Sticky Top Header */}
      <div className="bg-slate-900 text-white rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2 shadow-2xs">
        {/* Left: Navigation & Machine Identification */}
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <button
            type="button"
            onClick={() => onSelectMachineId(null)}
            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1 transition-colors shrink-0"
            title="Return to machines grid"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Machines</span>
          </button>

          {returnTab && onReturnBack && (
            <button
              type="button"
              onClick={onReturnBack}
              className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1 transition-colors shrink-0 shadow-2xs"
              title={`Return back to ${returnTabLabel}`}
            >
              <ArrowLeft className="w-3 h-3" />
              <span>Back to {returnTabLabel}</span>
            </button>
          )}

          {/* Machine Name & Badges */}
          {isEditingMachine ? (
            <div className="flex items-center gap-1 bg-slate-800 p-1 rounded border border-slate-700">
              <input
                type="text"
                value={editMachineName}
                onChange={(e) => setEditMachineName(e.target.value)}
                className="px-1.5 py-0.5 text-xs bg-slate-900 border border-slate-600 rounded text-white font-bold w-28"
                placeholder="Name"
              />
              <input
                type="text"
                value={editMachineCode}
                onChange={(e) => setEditMachineCode(e.target.value)}
                className="px-1.5 py-0.5 text-xs bg-slate-900 border border-slate-600 rounded text-white font-mono w-16"
                placeholder="Code"
              />
              <select
                value={editMachineType}
                onChange={(e) => setEditMachineType(e.target.value)}
                className="px-1 py-0.5 text-xs bg-slate-900 border border-slate-600 rounded text-white"
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
                title="Save changes"
              >
                <Check className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => setIsEditingMachine(false)}
                className="p-1 rounded bg-slate-700 text-slate-300"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              <h2 className="text-sm sm:text-base font-extrabold text-white tracking-tight">
                {draft.machineName}
              </h2>
              {(draft.isTempMachine || draft.machineId?.startsWith("temp_")) && (
                <span className="px-1.5 py-0.2 rounded text-[9px] bg-amber-500 text-slate-950 font-black tracking-wider uppercase">
                  TEMP
                </span>
              )}
              {!isShiftLocked && !(draft.isTempMachine || draft.machineId?.startsWith("temp_")) && (
                <button
                  type="button"
                  onClick={() => {
                    const m = machines.find((mac) => mac.id === draft.machineId);
                    setEditMachineName(draft.machineName);
                    setEditMachineCode(m?.code || "");
                    setEditMachineType(m?.type || "CNC");
                    setIsEditingMachine(true);
                  }}
                  className="p-1 text-slate-400 hover:text-emerald-400 transition-colors"
                  title="Edit machine details"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              )}
              <span className="text-[11px] text-slate-400 font-mono">
                {selectedLine} · {draft.date} ({draft.shift.split(" ")[0]})
              </span>
            </div>
          )}

          {/* Prev/Next arrows */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handlePrevMachine}
              disabled={!prevMachine}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300"
              title={prevMachine ? `Previous machine: ${prevMachine.name}` : "First machine"}
            >
              <ArrowLeft className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={handleNextMachine}
              disabled={!nextMachine}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300"
              title={nextMachine ? `Next machine: ${nextMachine.name}` : "Last machine"}
            >
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Center/Right: Desktop Shift Time Balance Meter & Primary Save Button (Zero-Scroll PC) */}
        <div className="hidden lg:flex items-center gap-3">
          {/* Shift Time Balance Meter */}
          <div className="flex items-center gap-2 bg-slate-950/80 px-2.5 py-1 rounded border border-slate-800 text-xs font-mono">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between text-[10px] text-slate-400 gap-3">
                <span>
                  Prod: <strong className="text-emerald-400">{timeBalance.productionMinutes}m</strong>
                </span>
                <span>
                  BD: <strong className="text-amber-400">{timeBalance.loggedBreakdownMinutes}m</strong>
                </span>
                <span>
                  Total:{" "}
                  <strong
                    className={
                      timeBalance.isBalanced
                        ? "text-emerald-400"
                        : timeBalance.isOver
                        ? "text-rose-400"
                        : "text-amber-400"
                    }
                  >
                    {timeBalance.totalAccountedMinutes} / {rowShiftMins}m
                  </strong>
                </span>
              </div>
              {/* Slim CSS Progress Bar */}
              <div className="w-44 h-1.5 bg-slate-800 rounded-full overflow-hidden flex border border-slate-700">
                <div
                  style={{ width: `${prodPct}%` }}
                  className="bg-emerald-400 h-full"
                  title={`Production: ${timeBalance.productionMinutes}m`}
                />
                <div
                  style={{ width: `${bdPct}%` }}
                  className="bg-amber-400 h-full"
                  title={`Breakdown: ${timeBalance.loggedBreakdownMinutes}m`}
                />
              </div>
            </div>

            {/* Status Icon */}
            {timeBalance.isBalanced ? (
              <span className="text-emerald-400 flex items-center gap-0.5 text-[11px] font-bold">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>OK</span>
              </span>
            ) : (
              <span className="text-amber-400 flex items-center gap-0.5 text-[11px] font-bold">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>
                  {timeBalance.isProductionExceeded
                    ? "Exceeds"
                    : timeBalance.isOver
                    ? `+${Math.abs(timeBalance.unaccountedMinutes)}m`
                    : `+${timeBalance.unaccountedMinutes}m`}
                </span>
              </span>
            )}
          </div>

          {/* Desktop Primary Save Button */}
          <button
            type="button"
            disabled={isSaving || isShiftLocked}
            onClick={() => handleSubmit()}
            className={`px-3 py-1.5 rounded-md font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 transition-colors shadow-xs ${
              isShiftLocked
                ? "bg-slate-700 text-slate-400 cursor-not-allowed"
                : hasEntryError
                ? "bg-amber-500 hover:bg-amber-600 text-slate-950 font-black animate-pulse"
                : "bg-emerald-600 hover:bg-emerald-500 text-white"
            }`}
            title={
              isShiftLocked
                ? "Shift is locked"
                : hasEntryError
                ? "Shift time balance mismatch — please verify production and breakdown minutes"
                : "Save machine entry"
            }
          >
            <Check className="w-3.5 h-3.5" />
            <span>{isSaving ? "Saving..." : "Save Entry"}</span>
          </button>
        </div>
      </div>

      {/* 2. Split-Run Tab Bar (Horizontal Scrollable Strip, Zero Vertical Stacking) */}
      <div className="bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 shadow-2xs flex items-center justify-between gap-2 overflow-x-auto">
        <div className="flex items-center gap-1.5 min-w-0 flex-nowrap">
          <span className="text-[11px] font-bold text-slate-600 shrink-0 flex items-center gap-1">
            <span>Runs:</span>
          </span>

          {currentMachineRuns.map((r, idx) => {
            const runNum = r.runNo || idx + 1;
            const isSelected = (draft.runNo || 1) === runNum;
            const rProd = (Number(r.actualOutput) || 0) * (Number(r.cycleTime) || 0);
            const rBd = calculateTotalBreakdown(r.breakdown);
            const rTotalMins = Math.round(rProd + rBd);

            return (
              <div
                key={r.id || runNum}
                className={`inline-flex items-center rounded-md border text-xs font-semibold transition-all shrink-0 ${
                  isSelected
                    ? "bg-blue-600 text-white border-blue-700 shadow-2xs"
                    : "bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200"
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleSelectRun(runNum)}
                  className="px-2.5 py-1 flex items-center gap-1 cursor-pointer"
                >
                  <span>Run #{runNum}</span>
                  <span
                    className={`text-[10px] font-mono ${
                      isSelected ? "text-blue-100" : "text-slate-500"
                    }`}
                  >
                    ({rTotalMins}m)
                  </span>
                </button>

                {/* Remove button for split runs (run > 1) */}
                {!isShiftLocked && runNum > 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveSplitRun(runNum);
                    }}
                    className={`pr-1.5 pl-0.5 hover:text-rose-300 cursor-pointer ${
                      isSelected ? "text-blue-200" : "text-slate-400 hover:text-rose-600"
                    }`}
                    title={`Delete Run #${runNum}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}

          {/* + Split Run Button */}
          {!isShiftLocked && (
            <button
              type="button"
              onClick={handleAddSplitRun}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-md bg-slate-900 hover:bg-slate-800 text-white shadow-2xs transition-colors shrink-0 cursor-pointer"
              title="Add another split run to this machine"
            >
              <Plus className="w-3 h-3 text-emerald-400" />
              <span>+ Split Run</span>
            </button>
          )}
        </div>

        {/* Combined Machine Status Badge */}
        {currentMachineRuns.length > 1 && (
          <div className="text-[10px] text-slate-500 font-mono shrink-0 hidden sm:block">
            Machine Total: <strong>{totalMachAct}</strong> / {totalMachStd} pcs ({machEfficiency}%)
          </div>
        )}
      </div>

      {/* 3. Main Workspace Grid (Left Column 5 cols + Right Column 7 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 pb-32 lg:pb-1">
        {/* ==================================================================== */}
        {/* LEFT COLUMN (Job Details, Production Output & Remarks) */}
        {/* ==================================================================== */}
        <div className="lg:col-span-5 flex flex-col gap-2.5">
          {/* CARD A: Job & Component Setup */}
          <div className="bg-white p-2.5 sm:p-3 rounded-lg border border-slate-200 shadow-2xs space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-slate-800 border-b border-slate-100 pb-1.5">
              <span className="flex items-center gap-1.5">
                <Wrench className="w-3.5 h-3.5 text-blue-600" />
                <span>Job & Cycle Setup</span>
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                Run #{draft.runNo || 1}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {/* Operator Dropdown */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                  Operator *
                </label>
                <div className="flex gap-1">
                  <select
                    disabled={isShiftLocked}
                    value={draft.operatorName || ""}
                    onChange={(e) => updateDraft({ operatorName: e.target.value })}
                    className="w-full min-h-[44px] lg:min-h-[34px] text-base lg:text-xs px-2 py-1 bg-white border border-slate-300 rounded-md focus:border-slate-800 focus:outline-none disabled:bg-slate-100"
                  >
                    <option value="">— Select Operator —</option>
                    {operators.map((op) => (
                      <option key={op} value={op}>
                        {op}
                      </option>
                    ))}
                  </select>
                  {!isShiftLocked && (
                    <button
                      type="button"
                      onClick={() => setShowAddOperatorModal(true)}
                      className="p-1.5 rounded border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-600 shrink-0"
                      title="Add Operator"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Item Dropdown */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                  Part / Component *
                </label>
                <div className="flex gap-1">
                  <select
                    disabled={isShiftLocked}
                    value={draft.itemId || ""}
                    onChange={(e) => handleItemSelect(e.target.value)}
                    className="w-full min-h-[44px] lg:min-h-[34px] text-base lg:text-xs px-2 py-1 bg-white border border-slate-300 rounded-md focus:border-slate-800 focus:outline-none disabled:bg-slate-100"
                  >
                    <option value="">— Select Item —</option>
                    {uniqueItems.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.itemCode} — {it.itemName}
                      </option>
                    ))}
                  </select>
                  {!isShiftLocked && (
                    <button
                      type="button"
                      onClick={() => setShowAddItemModal(true)}
                      className="p-1.5 rounded border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-600 shrink-0"
                      title="Add Item"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Operation Dropdown */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                  Operation
                </label>
                <div className="flex gap-1">
                  {draftOperations.length > 0 ? (
                    <select
                      disabled={isShiftLocked}
                      value={draft.operation || ""}
                      onChange={(e) => handleOperationSelect(e.target.value)}
                      className="w-full min-h-[44px] lg:min-h-[34px] text-base lg:text-xs px-2 py-1 bg-white border border-slate-300 rounded-md focus:border-slate-800 focus:outline-none disabled:bg-slate-100"
                    >
                      <option value="">— Select Operation —</option>
                      {draftOperations.map((op) => (
                        <option key={op} value={op}>
                          {op}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      disabled={isShiftLocked}
                      placeholder="e.g. OP-10"
                      value={draft.operation || ""}
                      onChange={(e) => updateDraft({ operation: e.target.value })}
                      className="w-full min-h-[44px] lg:min-h-[34px] text-base lg:text-xs px-2 py-1 bg-white border border-slate-300 rounded-md focus:border-slate-800 focus:outline-none disabled:bg-slate-100"
                    />
                  )}
                  {!isShiftLocked && (
                    <button
                      type="button"
                      onClick={() => setShowAddOpInput(true)}
                      className="p-1.5 rounded border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-600 shrink-0"
                      title="Add Operation"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Cycle Time (min) */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                  Cycle Time (min) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  disabled={isShiftLocked}
                  value={
                    editingCtText !== null
                      ? editingCtText
                      : draft.cycleTime > 0
                      ? draft.cycleTime
                      : ""
                  }
                  onFocus={() => setEditingCtText(draft.cycleTime > 0 ? String(draft.cycleTime) : "")}
                  onChange={(e) => {
                    setEditingCtText(e.target.value);
                    const ctVal = parseFloat(e.target.value);
                    if (!isNaN(ctVal) && ctVal >= 0) {
                      const isSplit = currentMachineRuns.length > 1;
                      const shiftMins = shiftWorkingMinutes || draft.totalWorkingMinutes || 1305;
                      const newStd = isSplit
                        ? draft.stdOutput
                        : ctVal > 0
                        ? Math.floor(shiftMins / ctVal)
                        : 0;
                      updateDraft({
                        cycleTime: Number(ctVal.toFixed(2)),
                        stdOutput: newStd,
                      });
                    }
                  }}
                  onBlur={() => setEditingCtText(null)}
                  placeholder="e.g. 1.25"
                  className="w-full min-h-[44px] lg:min-h-[34px] text-base lg:text-xs px-2 py-1 font-mono font-semibold bg-white border border-slate-300 rounded-md focus:border-slate-800 focus:outline-none disabled:bg-slate-100"
                />
              </div>
            </div>

            {/* Inline Add Operation sub-bar */}
            {showAddOpInput && !isShiftLocked && (
              <div className="flex items-center gap-1.5 pt-1.5 border-t border-slate-100">
                <input
                  type="text"
                  placeholder="New Operation (e.g. OP-20 Milling)"
                  value={newOperationName}
                  onChange={(e) => setNewOperationName(e.target.value)}
                  className="flex-1 text-xs px-2 py-1 border border-slate-300 rounded focus:border-slate-800 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={isInlineSaving || !newOperationName.trim()}
                  onClick={handleQuickCreateOperation}
                  className="px-2.5 py-1 text-xs font-bold bg-slate-900 text-white rounded hover:bg-slate-800 disabled:opacity-40"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddOpInput(false)}
                  className="text-xs text-slate-500 hover:text-slate-800 px-1"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* CARD B: Production Output & Efficiency */}
          <div className="bg-white p-2.5 sm:p-3 rounded-lg border border-slate-200 shadow-2xs space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-slate-800 border-b border-slate-100 pb-1.5">
              <span>Production & Output</span>
              <div className="flex items-center gap-2 text-[10px] font-mono">
                <span className="text-slate-500">Run Eff:</span>
                <span
                  className={`font-bold px-1.5 py-0.2 rounded ${
                    efficiency >= 90
                      ? "bg-emerald-100 text-emerald-800"
                      : efficiency >= 75
                      ? "bg-amber-100 text-amber-800"
                      : "bg-rose-100 text-rose-800"
                  }`}
                >
                  {efficiency}%
                </span>
              </div>
            </div>

            {/* 3-Column Input Grid */}
            <div className="grid grid-cols-3 gap-2 text-xs">
              {/* Std Output */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                  Std Target {currentMachineRuns.length > 1 && "(Split)"}
                </label>
                {currentMachineRuns.length === 1 && !isAdmin ? (
                  <div className="w-full min-h-[44px] lg:min-h-[34px] px-2 py-1 bg-slate-50 border border-slate-200 rounded-md text-slate-700 font-mono font-bold flex items-center justify-center text-sm lg:text-xs">
                    {draft.stdOutput} pcs
                  </div>
                ) : (
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    disabled={isShiftLocked}
                    value={draft.stdOutput || ""}
                    onChange={(e) =>
                      updateDraft({
                        stdOutput: Math.max(0, parseInt(e.target.value, 10) || 0),
                      })
                    }
                    placeholder="0"
                    className="w-full min-h-[44px] lg:min-h-[34px] text-base lg:text-xs text-center font-mono font-bold bg-blue-50/40 border border-blue-300 rounded-md focus:border-blue-600 focus:outline-none"
                  />
                )}
                {currentMachineRuns.length > 1 && draft.stdOutput > 0 && draft.cycleTime > 0 && (
                  <div className="text-[9px] font-mono text-slate-500 text-center mt-0.5 truncate">
                    ~{Number((draft.stdOutput * draft.cycleTime).toFixed(1))}m
                  </div>
                )}
              </div>

              {/* Actual Output */}
              <div>
                <label className="block text-[11px] font-bold text-slate-900 mb-0.5">
                  Actual Output *
                </label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={isShiftLocked || (draft.actualOutput || 0) <= 0}
                    onClick={() => handleAdjustActual(-1)}
                    className="lg:hidden min-h-[44px] px-2 bg-slate-100 active:bg-slate-200 rounded text-slate-700 font-bold"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    disabled={isShiftLocked}
                    value={draft.actualOutput > 0 ? draft.actualOutput : draft.actualOutput === 0 ? "" : ""}
                    onChange={(e) =>
                      updateDraft({
                        actualOutput: Math.max(0, parseInt(e.target.value, 10) || 0),
                      })
                    }
                    placeholder="0"
                    className="w-full min-h-[44px] lg:min-h-[34px] text-base lg:text-sm text-center font-mono font-black text-slate-900 bg-white border-2 border-slate-300 rounded-md focus:border-emerald-600 focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={isShiftLocked}
                    onClick={() => handleAdjustActual(1)}
                    className="lg:hidden min-h-[44px] px-2 bg-slate-100 active:bg-slate-200 rounded text-slate-700 font-bold"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Rework */}
              <div>
                <label className="block text-[11px] font-semibold text-rose-700 mb-0.5">
                  Rework (pcs)
                </label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={isShiftLocked || (draft.rework || 0) <= 0}
                    onClick={() => handleAdjustRework(-1)}
                    className="lg:hidden min-h-[44px] px-2 bg-slate-100 active:bg-slate-200 rounded text-slate-700 font-bold"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    disabled={isShiftLocked}
                    value={draft.rework > 0 ? draft.rework : ""}
                    onChange={(e) =>
                      updateDraft({
                        rework: Math.max(0, parseInt(e.target.value, 10) || 0),
                      })
                    }
                    placeholder="0"
                    className="w-full min-h-[44px] lg:min-h-[34px] text-base lg:text-xs text-center font-mono font-semibold text-rose-700 bg-white border border-slate-300 rounded-md focus:border-rose-600 focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={isShiftLocked}
                    onClick={() => handleAdjustRework(1)}
                    className="lg:hidden min-h-[44px] px-2 bg-slate-100 active:bg-slate-200 rounded text-slate-700 font-bold"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Inline Metrics Strip */}
            <div className="bg-slate-50 p-1.5 rounded border border-slate-200 text-[11px] font-mono flex items-center justify-between text-slate-600">
              <span>
                Prod: <strong className="text-slate-900">{runProdMins}m</strong>
              </span>
              <span>
                BD: <strong className="text-amber-800">{totalBreakdown}m</strong>
              </span>
              <span>
                Run Total: <strong className="text-slate-900">{runTotalMins}m</strong>
              </span>
            </div>
          </div>

          {/* CARD C: Remarks & Quick Chips */}
          <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs space-y-1.5">
            <label className="block text-[11px] font-semibold text-slate-700">
              Shift Remarks / Problem Description
            </label>
            <input
              type="text"
              disabled={isShiftLocked}
              placeholder="e.g. Insert changed at 11am; disc variation"
              value={draft.remarks || ""}
              onChange={(e) => updateDraft({ remarks: e.target.value })}
              className="w-full min-h-[40px] lg:min-h-[32px] text-base lg:text-xs px-2.5 py-1 bg-white border border-slate-300 rounded-md focus:border-slate-800 focus:outline-none"
            />
            {/* Quick Chips */}
            {!isShiftLocked && (
              <div className="flex flex-wrap gap-1 pt-0.5">
                {REMARKS_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => handleQuickRemark(chip)}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 transition-colors"
                  >
                    + {chip}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ==================================================================== */}
        {/* RIGHT COLUMN (7-Category Breakdown Matrix) */}
        {/* ==================================================================== */}
        <div className="lg:col-span-7 flex flex-col gap-2">
          <div className="bg-white p-2.5 sm:p-3 rounded-lg border border-slate-200 shadow-2xs space-y-2">
            {/* Header Strip with Unaccounted Time status */}
            <div className="flex items-center justify-between text-xs font-bold text-slate-800 border-b border-slate-100 pb-1.5 flex-wrap gap-1">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <span>Breakdown & Downtime Minutes</span>
              </span>

              <div className="flex items-center gap-2 font-mono text-[11px]">
                <span className="text-slate-500">
                  Run BD: <strong className="text-amber-800">{totalBreakdown}m</strong>
                </span>

                {timeBalance.isBalanced ? (
                  <span className="text-emerald-700 bg-emerald-100 border border-emerald-300 px-1.5 py-0.2 rounded font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    <span>
                      {timeBalance.isFullTargetBalanced && (timeBalance.cycleRemainderMinutes ?? 0) > 0
                        ? `Balanced ✓ (100% Target · ${timeBalance.cycleRemainderMinutes}m rem.)`
                        : "Balanced"}
                    </span>
                  </span>
                ) : (
                  <span
                    className={`px-1.5 py-0.2 rounded font-bold flex items-center gap-1 ${
                      timeBalance.isProductionExceeded || timeBalance.isOver
                        ? "bg-rose-100 text-rose-800 border border-rose-300"
                        : "bg-amber-100 text-amber-900 border border-amber-300"
                    }`}
                  >
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    <span>
                      {timeBalance.isProductionExceeded
                        ? "Exceeds Shift"
                        : timeBalance.isOver
                        ? `Over +${Math.abs(timeBalance.unaccountedMinutes)}m`
                        : `Fill +${timeBalance.unaccountedMinutes}m`}
                    </span>
                  </span>
                )}
              </div>
            </div>

            {/* 7 Breakdown Cards in tight responsive grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-2">
              {BD_CONFIG.map((cfg) => {
                const val = Number(draft.breakdown?.[cfg.key]) || 0;
                const catDowntimePct = calculateDowntimePct(val, rowShiftMins);

                return (
                  <div
                    key={cfg.key}
                    className={`p-2 rounded-lg border bg-slate-50/50 hover:bg-slate-50 transition-colors flex flex-col justify-between ${cfg.cardBorder}`}
                  >
                    {/* Top Row: Label & % Pill */}
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="text-[11px] font-bold text-slate-800 truncate" title={cfg.sublabel}>
                        {cfg.label}
                      </span>
                      <span
                        className={`text-[9px] font-bold font-mono px-1 py-0.2 rounded border ${cfg.badgeBg}`}
                      >
                        {catDowntimePct}%
                      </span>
                    </div>

                    {/* Middle: Decimal Input */}
                    <div className="my-1">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        inputMode="decimal"
                        disabled={isShiftLocked}
                        value={
                          editingBdField === cfg.key
                            ? editingBdText
                            : val > 0
                            ? val
                            : ""
                        }
                        onFocus={() => {
                          setEditingBdField(cfg.key);
                          setEditingBdText(val > 0 ? String(val) : "");
                        }}
                        onChange={(e) => {
                          setEditingBdText(e.target.value);
                          const parsed = parseFloat(e.target.value);
                          if (!isNaN(parsed) && parsed >= 0) {
                            updateDraft({
                              breakdown: {
                                ...draft.breakdown,
                                [cfg.key]: Number(parsed.toFixed(2)),
                              },
                            });
                          } else if (e.target.value === "") {
                            updateDraft({
                              breakdown: {
                                ...draft.breakdown,
                                [cfg.key]: 0,
                              },
                            });
                          }
                        }}
                        onBlur={() => {
                          setEditingBdField(null);
                          setEditingBdText("");
                        }}
                        placeholder="0"
                        className="w-full min-h-[40px] lg:min-h-[32px] text-base lg:text-sm font-semibold font-mono text-center bg-white border border-slate-300 rounded-md focus:border-slate-800 focus:outline-none"
                      />
                    </div>

                    {/* Bottom Action Row: Quick add chips & 1-tap Fill */}
                    <div className="flex items-center justify-between gap-1 mt-0.5 pt-1 border-t border-slate-200/60">
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          disabled={isShiftLocked}
                          onClick={() => handleBreakdownStep(cfg.key, cfg.step1)}
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white hover:bg-slate-200 text-slate-700 border border-slate-200 transition-colors"
                        >
                          +{cfg.step1}
                        </button>
                        <button
                          type="button"
                          disabled={isShiftLocked}
                          onClick={() => handleBreakdownStep(cfg.key, cfg.step2)}
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white hover:bg-slate-200 text-slate-700 border border-slate-200 transition-colors"
                        >
                          +{cfg.step2}
                        </button>
                      </div>

                      {/* 1-Tap Fill Button (Shown when unaccounted minutes remain) */}
                      {!isShiftLocked && !timeBalance.isFullTargetBalanced && timeBalance.unaccountedMinutes > 0.01 && (
                        <button
                          type="button"
                          onClick={() =>
                            handleFillUnaccountedToField(cfg.key, timeBalance.unaccountedMinutes)
                          }
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs transition-colors shrink-0 cursor-pointer"
                          title={`Assign remaining ${timeBalance.unaccountedMinutes} mins to ${cfg.label}`}
                        >
                          Fill {timeBalance.unaccountedMinutes}m
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Desktop Bottom Navigation Strip (hidden lg:flex - Keep Zero-Scroll Compact) */}
      <div className="hidden lg:flex items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-200">
        <button
          type="button"
          onClick={handlePrevMachine}
          disabled={!prevMachine}
          className="h-8 px-3 text-xs font-medium rounded-md border border-slate-300 bg-white hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 text-slate-700 flex items-center gap-1.5 transition-colors max-w-[280px] cursor-pointer disabled:cursor-not-allowed"
          title={prevMachine ? `Go to ${prevMachine.name}` : "First machine on this line"}
        >
          <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">
            {prevMachine ? `Prev: ${prevMachine.name}` : "First Machine"}
          </span>
        </button>

        <div className="text-xs font-mono font-medium text-slate-500">
          Machine {currentIdx >= 0 ? currentIdx + 1 : 1} of {allNavigableMachines.length}
        </div>

        <button
          type="button"
          onClick={handleNextMachine}
          disabled={!nextMachine}
          className="h-8 px-3 text-xs font-medium rounded-md border border-slate-300 bg-white hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 text-slate-700 flex items-center gap-1.5 transition-colors max-w-[280px] cursor-pointer disabled:cursor-not-allowed"
          title={nextMachine ? `Go to ${nextMachine.name}` : "Last machine on this line"}
        >
          <span className="truncate">
            {nextMachine ? `Next: ${nextMachine.name}` : "Last Machine"}
          </span>
          <ArrowRight className="w-3.5 h-3.5 shrink-0" />
        </button>
      </div>

      {/* 4. Mobile Sticky Bottom Action Bar (< 1024px) */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-xs border-t border-slate-200 px-3 py-2 shadow-lg space-y-2">
        {/* Mobile Machine Navigation Row */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handlePrevMachine}
            disabled={!prevMachine}
            className="min-h-[38px] px-2.5 rounded-md border border-slate-300 bg-white active:bg-slate-100 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 text-xs font-semibold text-slate-800 flex items-center gap-1 truncate max-w-[40%] shadow-2xs transition-colors cursor-pointer disabled:cursor-not-allowed"
            title={prevMachine ? `Go to ${prevMachine.name}` : "First machine"}
          >
            <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{prevMachine ? prevMachine.name : "Prev"}</span>
          </button>

          <span className="text-[11px] font-mono font-medium text-slate-500 shrink-0">
            {currentIdx >= 0 ? currentIdx + 1 : 1} / {allNavigableMachines.length}
          </span>

          <button
            type="button"
            onClick={handleNextMachine}
            disabled={!nextMachine}
            className="min-h-[38px] px-2.5 rounded-md border border-slate-300 bg-white active:bg-slate-100 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 text-xs font-semibold text-slate-800 flex items-center justify-end gap-1 truncate max-w-[40%] shadow-2xs transition-colors cursor-pointer disabled:cursor-not-allowed"
            title={nextMachine ? `Go to ${nextMachine.name}` : "Last machine"}
          >
            <span className="truncate">{nextMachine ? nextMachine.name : "Next"}</span>
            <ArrowRight className="w-3.5 h-3.5 shrink-0" />
          </button>
        </div>

        {/* Balance & Save Entry Row */}
        <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-100">
          <div className="min-w-0 flex items-center gap-1.5">
            {timeBalance.isBalanced ? (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 font-mono">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  {timeBalance.isFullTargetBalanced && (timeBalance.cycleRemainderMinutes ?? 0) > 0
                    ? `Balanced ✓ (100% Target · ${timeBalance.cycleRemainderMinutes}m rem.)`
                    : `Balanced ${timeBalance.shiftMinutes}m ✓`}
                </span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-700 font-mono">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span className="truncate">
                  {timeBalance.isProductionExceeded
                    ? "Exceeds Shift"
                    : timeBalance.isOver
                    ? `Over +${Math.abs(timeBalance.unaccountedMinutes)}m`
                    : `Fill +${timeBalance.unaccountedMinutes}m BD`}
                </span>
              </span>
            )}
          </div>

          <button
            type="button"
            disabled={isSaving || isShiftLocked}
            onClick={() => handleSubmit()}
            className={`min-h-[44px] px-5 rounded-lg font-bold text-sm text-white flex items-center justify-center gap-1.5 shadow-md shrink-0 transition-colors ${
              isShiftLocked
                ? "bg-slate-400 cursor-not-allowed"
                : hasEntryError
                ? "bg-amber-600 hover:bg-amber-700"
                : "bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800"
            }`}
          >
            <Check className="w-4 h-4" />
            <span>{isSaving ? "Saving..." : "Save Entry"}</span>
          </button>
        </div>
      </div>

      {renderQuickAddModals()}
    </div>
  );
}
