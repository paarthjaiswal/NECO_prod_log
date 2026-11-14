"use client";
import React, { useState, useMemo } from "react";
import {
  Sliders,
  Plus,
  Trash2,
  RotateCcw,
  CheckCircle2,
  User,
  Factory,
  Package,
  Timer,
  Layers,
} from "lucide-react";
import {
  MasterDataState,
  MachineMaster,
  ItemMaster,
  ProductionLineMaster,
  ShiftMaster,
  MachineItemCycleTime,
  ShiftType,
} from "@/types";
import {
  upsertMachineMaster,
  disableMachineMaster,
  upsertItemMaster,
  deleteItemMaster,
  addOperatorMaster,
  removeOperatorMaster,
  upsertMachineItemCycleTime,
  deleteMachineItemCycleTime,
  upsertProductionLine,
  deleteProductionLine,
  upsertShiftMaster,
  deleteShiftMaster,
} from "@/actions/shiftActions";

interface MasterDataSettingsProps {
  masterData: MasterDataState;
  onRefreshMasterData: () => Promise<void> | void;
  onResetAllDemoData?: () => void;
  isAdmin?: boolean;
  isReadOnly?: boolean;
}

export const MasterDataSettings: React.FC<MasterDataSettingsProps> = ({
  masterData,
  onRefreshMasterData,
  onResetAllDemoData,
  isAdmin = false,
  isReadOnly: _isReadOnly = false,
}) => {
  const machines = masterData.machines.filter((m) => m.status !== "idle");
  const { operators, items } = masterData;

  const lineOptions: { id: string; name: string; description?: string | null }[] =
    masterData.lines && masterData.lines.length > 0
      ? masterData.lines
      : [
          { id: "line_1", name: "Line 1", description: "CNC Line" },
          { id: "line_2", name: "Line 2", description: "VMC Line" },
          { id: "line_3", name: "Line 3", description: "Heavy SPM" },
        ];

  const [subTab, setSubTab] = useState<
    "machines" | "operators" | "items" | "cycle_times" | "lines_shifts"
  >("machines");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const showFeedback = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 3500);
  };

  const triggerNotice = (msg: string) => {
    setSavedNotice(msg);
    setTimeout(() => setSavedNotice(null), 3000);
  };

  // ==========================================================================
  // SUB-TAB 1, 2, 3 STATE & HANDLERS (MACHINES, OPERATORS, ITEMS)
  // ==========================================================================
  const [newOperatorName, setNewOperatorName] = useState("");

  const [newMachineName, setNewMachineName] = useState("");
  const [newMachineCode, setNewMachineCode] = useState("");
  const [newMachineType, setNewMachineType] = useState("VMC / CNC");
  const [newMachineLine, setNewMachineLine] = useState("Line 1");
  const [machineLineFilter, setMachineLineFilter] = useState("all");

  const [newItemName, setNewItemName] = useState("");
  const [newItemCode, setNewItemCode] = useState("");
  const [newOperation, setNewOperation] = useState("");

  const handleAddMachine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMachineName.trim()) return;

    const nextNumber = masterData.machines.length + 1;
    const newMachine: MachineMaster = {
      id: `m${Date.now()}`,
      name: newMachineName.trim().toUpperCase(),
      code: newMachineCode.trim().toUpperCase() || `MC-${nextNumber}`,
      line: newMachineLine,
      type: newMachineType.trim(),
      status: "active",
    };

    try {
      await upsertMachineMaster(newMachine, nextNumber);
      await onRefreshMasterData();
      setNewMachineName("");
      setNewMachineCode("");
      triggerNotice(`Added machine "${newMachine.name}" to plant directory.`);
    } catch (err) {
      console.error("Failed to add machine:", err);
      alert("Failed to save machine to database.");
    }
  };

  const handleDeleteMachine = async (id: string, name: string) => {
    if (machines.length <= 1) {
      alert("At least one machine must remain in the factory matrix.");
      return;
    }
    if (window.confirm(`Delete machine "${name}" from master data?`)) {
      try {
        await disableMachineMaster(id);
        await onRefreshMasterData();
        triggerNotice(`Machine "${name}" removed.`);
      } catch (err) {
        console.error("Failed to disable machine:", err);
        alert("Failed to remove machine.");
      }
    }
  };

  const handleAddOperator = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newOperatorName.trim();
    if (!cleanName) return;
    if (operators.includes(cleanName)) {
      alert("This operator name already exists.");
      return;
    }

    try {
      await addOperatorMaster(cleanName);
      await onRefreshMasterData();
      setNewOperatorName("");
      triggerNotice(`Operator "${cleanName}" registered.`);
    } catch (err) {
      console.error("Failed to add operator:", err);
      alert("Failed to save operator to database.");
    }
  };

  const handleDeleteOperator = async (opName: string) => {
    if (operators.length <= 1) {
      alert("At least one operator must remain in master records.");
      return;
    }
    if (window.confirm(`Remove operator "${opName}"?`)) {
      try {
        await removeOperatorMaster(opName);
        await onRefreshMasterData();
        triggerNotice(`Operator "${opName}" deleted.`);
      } catch (err) {
        console.error("Failed to remove operator:", err);
        alert("Failed to remove operator.");
      }
    }
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim() || !newOperation.trim()) return;

    const newItem: ItemMaster = {
      id: `it_${Date.now()}`,
      itemCode: newItemCode.trim().toUpperCase() || `P-${items.length + 1}`,
      itemName: newItemName.trim(),
      operation: newOperation.trim(),
    };

    try {
      await upsertItemMaster(newItem);
      await onRefreshMasterData();
      setNewItemName("");
      setNewItemCode("");
      setNewOperation("");
      triggerNotice(`Component "${newItem.itemName}" registered.`);
    } catch (err) {
      console.error("Failed to add item:", err);
      alert("Failed to save component to database.");
    }
  };

  const handleDeleteItem = async (id: string, name: string) => {
    if (items.length <= 1) {
      alert("At least one item must remain in master directory.");
      return;
    }
    if (window.confirm(`Delete part item "${name}"?`)) {
      try {
        await deleteItemMaster(id);
        await onRefreshMasterData();
        triggerNotice(`Item "${name}" removed.`);
      } catch (err) {
        console.error("Failed to delete item:", err);
        alert("Failed to delete item.");
      }
    }
  };

  // ==========================================================================
  // SUB-TAB 4 HANDLERS: MACHINE x ITEM CYCLE TIMES
  // ==========================================================================
  const [ctMachineId, setCtMachineId] = useState<string>(machines[0]?.id ?? "");
  const [ctItemId, setCtItemId] = useState<string>("");
  const [ctOperation, setCtOperation] = useState<string>("");
  // Stored as string so typing '54' never becomes '054'
  const [ctCycleTime, setCtCycleTime] = useState<string>("");

  // Extract all operations for the selected item (supports comma-separated or multiple rows with same itemCode/itemName)
  const availableOperations = useMemo(() => {
    const selectedItem = masterData.items.find((i) => i.id === ctItemId);
    if (!selectedItem) return [];

    const matchingItems = masterData.items.filter(
      (i) =>
        i.id === selectedItem.id ||
        (i.itemCode && i.itemCode === selectedItem.itemCode) ||
        i.itemName.toLowerCase() === selectedItem.itemName.toLowerCase()
    );

    const opsSet = new Set<string>();
    matchingItems.forEach((item) => {
      item.operation
        .split(/[,/]/)
        .map((op) => op.trim())
        .filter(Boolean)
        .forEach((op) => opsSet.add(op));
    });

    return Array.from(opsSet);
  }, [ctItemId, masterData.items]);

  // Auto-fills Operation and existing Cycle Time when Machine, Item, or Operation changes
  const handleSelectCycleTimeTriple = (
    machineId: string,
    itemId: string,
    explicitOperation?: string
  ) => {
    setCtMachineId(machineId);
    setCtItemId(itemId);

    const selectedItem = masterData.items.find((i) => i.id === itemId);
    if (!selectedItem) {
      setCtOperation("");
      setCtCycleTime("");
      return;
    }

    // Determine operation list for this item
    const matchingItems = masterData.items.filter(
      (i) =>
        i.id === selectedItem.id ||
        (i.itemCode && i.itemCode === selectedItem.itemCode) ||
        i.itemName.toLowerCase() === selectedItem.itemName.toLowerCase()
    );
    const opsList: string[] = [];
    matchingItems.forEach((item) => {
      item.operation
        .split(/[,/]/)
        .map((op) => op.trim())
        .filter(Boolean)
        .forEach((op) => {
          if (!opsList.includes(op)) opsList.push(op);
        });
    });

    const chosenOp = explicitOperation ?? opsList[0] ?? selectedItem.operation ?? "";
    setCtOperation(chosenOp);

    const existingCt = (masterData.cycleTimes ?? []).find(
      (ct) =>
        ct.machineId === machineId &&
        ct.itemId === itemId &&
        ct.operation.toLowerCase() === chosenOp.toLowerCase()
    );

    if (existingCt && existingCt.cycleTime > 0) {
      setCtCycleTime(String(existingCt.cycleTime));
    } else {
      setCtCycleTime("");
    }
  };

  const handleSaveCycleTime = async (e: React.FormEvent) => {
    e.preventDefault();
    const numericCycleTime = parseFloat(ctCycleTime);
    if (!ctMachineId || !ctItemId || !ctOperation.trim() || isNaN(numericCycleTime) || numericCycleTime <= 0) {
      showFeedback("Error: Please enter a valid Cycle Time greater than 0.");
      return;
    }

    setIsSubmitting(true);
    try {
      await upsertMachineItemCycleTime({
        machineId: ctMachineId,
        itemId: ctItemId,
        operation: ctOperation.trim(),
        cycleTime: numericCycleTime,
      });
      await onRefreshMasterData();
      showFeedback("Saved Machine × Item cycle time.");
    } catch (err) {
      console.error("Failed to save cycle time:", err);
      showFeedback("Error saving cycle time.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteCycleTime = async (id?: number) => {
    if (typeof id !== "number") return;
    if (!window.confirm("Remove this cycle time entry?")) return;

    setIsSubmitting(true);
    try {
      await deleteMachineItemCycleTime(id);
      await onRefreshMasterData();
      showFeedback("Removed cycle time entry.");
    } catch (err) {
      console.error("Failed to delete cycle time:", err);
      showFeedback("Error deleting cycle time.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ==========================================================================
  // SUB-TAB 5 HANDLERS: LINES & SHIFTS
  // ==========================================================================
  const [newLineName, setNewLineName] = useState("");
  const [newLineDesc, setNewLineDesc] = useState("");
  const [newLineMinutes, setNewLineMinutes] = useState<string>("1305");

  // New Shift Form State
  const [newShiftCode, setNewShiftCode] = useState("");
  const [newShiftDisplay, setNewShiftDisplay] = useState("");
  const [newShiftStart, setNewShiftStart] = useState("07:00");
  const [newShiftEnd, setNewShiftEnd] = useState("15:30");
  const [newShiftMins, setNewShiftMins] = useState<string>("465");

  const [lineEdits, setLineEdits] = useState<Record<string, string>>({});
  const [shiftEdits, setShiftEdits] = useState<
    Record<
      string,
      {
        startTime: string;
        endTime: string;
        shiftWorkingMinutes: string;
      }
    >
  >({});

  const handleAddProductionLine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLineName.trim()) return;

    setIsSubmitting(true);
    try {
      const cleanName = newLineName.trim();
      const generatedId = cleanName.toLowerCase().replace(/\s+/g, "_");
      await upsertProductionLine({
        id: generatedId,
        name: cleanName,
        description: newLineDesc.trim(),
        dailyWorkingMinutes: parseFloat(newLineMinutes) || 1305,
        isActive: true,
        sortOrder: (masterData.lines?.length ?? 3) + 1,
      });
      setNewLineName("");
      setNewLineDesc("");
      setNewLineMinutes("1305");
      await onRefreshMasterData();
      showFeedback(`Added ${cleanName}.`);
    } catch (err) {
      console.error("Failed to add line:", err);
      showFeedback("Error adding production line.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateLineMinutes = async (line: ProductionLineMaster) => {
    const rawVal = lineEdits[line.id];
    const updatedMins = rawVal !== undefined ? parseFloat(rawVal) : line.dailyWorkingMinutes;

    setIsSubmitting(true);
    try {
      await upsertProductionLine({
        id: line.id,
        name: line.name,
        description: line.description ?? "",
        dailyWorkingMinutes: updatedMins || 1305,
        isActive: line.isActive,
        sortOrder: line.sortOrder,
      });
      await onRefreshMasterData();
      showFeedback(`Updated ${line.name} working time to ${updatedMins || 1305} mins.`);
    } catch (err) {
      console.error("Failed to update line:", err);
      showFeedback("Error updating line working minutes.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteLine = async (line: ProductionLineMaster) => {
    if ((masterData.lines?.length ?? 0) <= 1) {
      alert("At least one production line must remain active.");
      return;
    }
    if (!window.confirm(`Delete production line "${line.name}"?`)) return;

    setIsSubmitting(true);
    try {
      await deleteProductionLine(line.id);
      await onRefreshMasterData();
      showFeedback(`Deleted ${line.name}.`);
    } catch (err) {
      console.error("Failed to delete line:", err);
      showFeedback("Error deleting production line.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newShiftCode.trim()) return;

    const code = newShiftCode.trim();
    const display =
      newShiftDisplay.trim() || `${code} (${newShiftStart}-${newShiftEnd})`;
    const generatedId = code.toLowerCase().replace(/\s+/g, "_");

    setIsSubmitting(true);
    try {
      await upsertShiftMaster({
        id: generatedId,
        shiftCode: code,
        displayName: display as ShiftType,
        startTime: `${newShiftStart}:00`,
        endTime: `${newShiftEnd}:00`,
        restBreakMinutes: 30,
        cleaningBreakMinutes: 15,
        shiftWorkingMinutes: parseFloat(newShiftMins) || 465,
        totalWorkingMinutesRef: 1305,
        isActive: true,
        sortOrder: (masterData.shifts?.length ?? 3) + 1,
      });
      setNewShiftCode("");
      setNewShiftDisplay("");
      setNewShiftMins("465");
      await onRefreshMasterData();
      showFeedback(`Added shift "${display}".`);
    } catch (err) {
      console.error("Failed to add shift:", err);
      showFeedback("Error adding shift.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateShift = async (shift: ShiftMaster) => {
    const draft = shiftEdits[shift.id] ?? {
      startTime: shift.startTime,
      endTime: shift.endTime,
      shiftWorkingMinutes: String(shift.shiftWorkingMinutes),
    };

    setIsSubmitting(true);
    try {
      await upsertShiftMaster({
        id: shift.id,
        shiftCode: shift.shiftCode,
        displayName: shift.displayName as ShiftType,
        startTime: draft.startTime,
        endTime: draft.endTime,
        restBreakMinutes: shift.restBreakMinutes ?? 30,
        cleaningBreakMinutes: shift.cleaningBreakMinutes ?? 15,
        shiftWorkingMinutes: parseFloat(draft.shiftWorkingMinutes) || 465,
        totalWorkingMinutesRef: shift.totalWorkingMinutesRef ?? 1305,
        isActive: shift.isActive,
        sortOrder: shift.sortOrder,
      });
      await onRefreshMasterData();
      showFeedback(`Updated ${shift.displayName}.`);
    } catch (err) {
      console.error("Failed to update shift:", err);
      showFeedback("Error updating shift timing.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteShift = async (shift: ShiftMaster) => {
    if ((masterData.shifts?.length ?? 0) <= 1) {
      alert("At least one shift must remain active.");
      return;
    }
    if (!window.confirm(`Delete shift "${shift.displayName}"?`)) return;

    setIsSubmitting(true);
    try {
      await deleteShiftMaster(shift.id);
      await onRefreshMasterData();
      showFeedback(`Deleted ${shift.displayName}.`);
    } catch (err) {
      console.error("Failed to delete shift:", err);
      showFeedback("Error deleting shift.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Top Banner */}
      <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-2xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Sliders className="w-4 h-4 text-slate-700" />
            <span>Master Data & Factory Parameters</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage client machines, operators, components, machine cycle times, and shift timings.
          </p>
        </div>

        {onResetAllDemoData && (
          <button
            onClick={onResetAllDemoData}
            className="px-3 py-1.5 text-xs text-rose-700 hover:text-rose-900 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded font-semibold flex items-center gap-1.5 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset All Demo Data to Defaults</span>
          </button>
        )}
      </div>

      {/* Notifications */}
      {savedNotice && (
        <div className="bg-emerald-50 border border-emerald-300 text-emerald-900 px-4 py-2.5 rounded-lg text-xs font-semibold flex items-center gap-2 shadow-2xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>{savedNotice}</span>
        </div>
      )}

      {feedback && (
        <div
          className={`px-4 py-2.5 rounded-lg text-xs font-semibold flex items-center gap-2 shadow-2xs border ${
            feedback.startsWith("Error")
              ? "bg-rose-50 border-rose-300 text-rose-900"
              : "bg-emerald-50 border-emerald-300 text-emerald-900"
          }`}
        >
          <CheckCircle2
            className={`w-4 h-4 ${
              feedback.startsWith("Error") ? "text-rose-600" : "text-emerald-600"
            }`}
          />
          <span>{feedback}</span>
        </div>
      )}

      {/* Sub Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setSubTab("machines")}
          className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold transition-colors ${
            subTab === "machines"
              ? "bg-slate-900 text-white"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
          }`}
        >
          <Factory className="w-3.5 h-3.5" />
          <span>Machines Directory ({machines.length})</span>
        </button>

        <button
          onClick={() => setSubTab("operators")}
          className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold transition-colors ${
            subTab === "operators"
              ? "bg-slate-900 text-white"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
          }`}
        >
          <User className="w-3.5 h-3.5" />
          <span>Shift Operators ({operators.length})</span>
        </button>

        <button
          onClick={() => setSubTab("items")}
          className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold transition-colors ${
            subTab === "items"
              ? "bg-slate-900 text-white"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
          }`}
        >
          <Package className="w-3.5 h-3.5" />
          <span>Components & Operations ({items.length})</span>
        </button>

        <button
          onClick={() => setSubTab("cycle_times")}
          className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold transition-colors ${
            subTab === "cycle_times"
              ? "bg-slate-900 text-white"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
          }`}
        >
          <Timer className="w-3.5 h-3.5" />
          <span>Machine × Item Cycle Times ({(masterData.cycleTimes ?? []).length})</span>
        </button>

        <button
          onClick={() => setSubTab("lines_shifts")}
          className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold transition-colors ${
            subTab === "lines_shifts"
              ? "bg-slate-900 text-white"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Lines, Shifts & Working Time</span>
        </button>
      </div>

      {/* SUB-TAB 1: MACHINES */}
      {subTab === "machines" && (
        <div className="space-y-5">
          <form
            onSubmit={handleAddMachine}
            className="bg-white p-4 rounded-lg border border-slate-200 shadow-2xs space-y-3"
          >
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5 text-emerald-600" />
              <span>Add New Shop Floor Machine</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Machine Name (e.g. MAZAK-122) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. MAZAK-122"
                  value={newMachineName}
                  onChange={(e) => setNewMachineName(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:border-slate-800 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Production Line <span className="text-rose-500">*</span>
                </label>
                <select
                  value={newMachineLine}
                  onChange={(e) => setNewMachineLine(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:border-slate-800 focus:outline-none bg-white font-medium"
                >
                  {lineOptions.map((line) => (
                    <option key={line.id} value={line.name}>
                      {`${line.name}${line.description ? ` (${line.description})` : ""}`}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Machine Code
                </label>
                <input
                  type="text"
                  placeholder="e.g. MZ-122"
                  value={newMachineCode}
                  onChange={(e) => setNewMachineCode(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:border-slate-800 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Equipment Category
                </label>
                <input
                  type="text"
                  placeholder="e.g. CNC Turning, VMC"
                  value={newMachineType}
                  onChange={(e) => setNewMachineType(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:border-slate-800 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-bold flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5 text-emerald-400" />
                <span>Add Machine to Floor Matrix</span>
              </button>
            </div>
          </form>

          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-2xs">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3 text-xs">
              <span className="font-bold text-slate-800">
                Machines Directory (
                {
                  machines.filter(
                    (m) =>
                      machineLineFilter === "all" ||
                      (m.line || "Line 1") === machineLineFilter
                  ).length
                }{" "}
                shown)
              </span>

              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-medium">Filter by Line:</span>
                <select
                  value={machineLineFilter}
                  onChange={(e) => setMachineLineFilter(e.target.value)}
                  className="bg-white border border-slate-300 rounded px-2 py-1 text-xs font-medium text-slate-800 focus:outline-none focus:border-slate-800"
                >
                  <option value="all">All Lines</option>
                  {lineOptions.map((line) => (
                    <option key={line.id} value={line.name}>
                      {line.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <table className="w-full text-xs text-left">
              <thead className="bg-slate-900 text-slate-100 uppercase text-[11px] font-semibold">
                <tr>
                  <th className="px-3 py-2.5 text-center w-14">#</th>
                  <th className="px-3 py-2.5">Machine Label</th>
                  <th className="px-3 py-2.5">Production Line</th>
                  <th className="px-3 py-2.5">Asset Code</th>
                  <th className="px-3 py-2.5">Type</th>
                  <th className="px-3 py-2.5 text-center">Status</th>
                  <th className="px-3 py-2.5 text-right w-20">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {machines
                  .filter(
                    (m) =>
                      machineLineFilter === "all" ||
                      (m.line || "Line 1") === machineLineFilter
                  )
                  .map((m, idx) => (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-center font-mono font-bold text-slate-500">
                        {idx + 1}
                      </td>
                      <td className="px-3 py-2 font-bold text-slate-900">{m.name}</td>
                      <td className="px-3 py-2">
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-800 border border-slate-200">
                          {m.line || "Line 1"}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-600">{m.code}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {m.type || "CNC Machine"}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                          Operational
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {isAdmin && (
                          <button
                            onClick={() => handleDeleteMachine(m.id, m.name)}
                            className="p-1 text-slate-400 hover:text-rose-600 transition-colors"
                            title="Delete machine"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: OPERATORS */}
      {subTab === "operators" && (
        <div className="space-y-5">
          <form
            onSubmit={handleAddOperator}
            className="bg-white p-4 rounded-lg border border-slate-200 shadow-2xs space-y-3"
          >
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5 text-emerald-600" />
              <span>Register New Operator / Technician</span>
            </h3>

            <div className="flex items-center gap-3">
              <input
                type="text"
                placeholder="Full Name (e.g. Kailash Chand)"
                value={newOperatorName}
                onChange={(e) => setNewOperatorName(e.target.value)}
                className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded focus:border-slate-800 focus:outline-none"
                required
              />
              <button
                type="submit"
                className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-bold flex items-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5 text-emerald-400" />
                <span>Add Operator</span>
              </button>
            </div>
          </form>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {operators.map((op, idx) => (
              <div
                key={op}
                className="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs flex items-center justify-between"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded bg-slate-100 flex items-center justify-center font-bold text-slate-700 text-xs">
                    {op.charAt(0)}
                  </div>
                  <div>
                    <h4 className="font-bold text-xs text-slate-900">{op}</h4>
                    <span className="text-[10px] text-slate-500 font-mono">
                      Operator #{idx + 1}
                    </span>
                  </div>
                </div>

                {isAdmin && (
                  <button
                    onClick={() => handleDeleteOperator(op)}
                    className="p-1 text-slate-400 hover:text-rose-600 transition-colors"
                    title="Remove operator"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SUB-TAB 3: ITEMS & OPERATIONS (Std Output Removed) */}
      {subTab === "items" && (
        <div className="space-y-5">
          <form
            onSubmit={handleAddItem}
            className="bg-white p-4 rounded-lg border border-slate-200 shadow-2xs space-y-3"
          >
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5 text-emerald-600" />
              <span>Define New Machining Part & Operations</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Item / Part Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Pinion Gear PG-90"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:border-slate-800 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Part Code
                </label>
                <input
                  type="text"
                  placeholder="e.g. PG-90"
                  value={newItemCode}
                  onChange={(e) => setNewItemCode(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:border-slate-800 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Operation(s) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. OP-10 Turning (or OP-10, OP-20)"
                  value={newOperation}
                  onChange={(e) => setNewOperation(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:border-slate-800 focus:outline-none"
                  required
                />
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-bold flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5 text-emerald-400" />
                <span>Register Part</span>
              </button>
            </div>
          </form>

          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-2xs">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-900 text-slate-100 uppercase text-[11px] font-semibold">
                <tr>
                  <th className="px-3 py-2.5">Part Code</th>
                  <th className="px-3 py-2.5">Component / Item Name</th>
                  <th className="px-3 py-2.5">Operations</th>
                  <th className="px-3 py-2.5 text-right w-20">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {items.map((it) => (
                  <tr key={it.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono font-bold text-slate-700">
                      {it.itemCode}
                    </td>
                    <td className="px-3 py-2 font-bold text-slate-900">
                      {it.itemName}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{it.operation}</td>
                    <td className="px-3 py-2 text-right">
                      {isAdmin && (
                        <button
                          onClick={() => handleDeleteItem(it.id, it.itemName)}
                          className="p-1 text-slate-400 hover:text-rose-600 transition-colors"
                          title="Delete component"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-TAB 4: MACHINE x ITEM CYCLE TIMES */}
      {subTab === "cycle_times" && (
        <div className="space-y-6">
          <form
            onSubmit={handleSaveCycleTime}
            className="bg-white p-4 rounded border border-slate-200 shadow-sm space-y-4"
          >
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-sm font-bold text-slate-900">
                Assign Machine × Item Cycle Time
              </h3>
              <span className="text-xs text-slate-500">
                Standard output is auto-calculated from Cycle Time and operational shift minutes
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {/* 1. Machine Dropdown */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Machine
                </label>
                <select
                  value={ctMachineId}
                  onChange={(e) =>
                    handleSelectCycleTimeTriple(e.target.value, ctItemId)
                  }
                  className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm bg-white"
                  required
                >
                  <option value="">Select Machine...</option>
                  {machines.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.line})
                    </option>
                  ))}
                </select>
              </div>

              {/* 2. Part / Item Dropdown */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Part / Item
                </label>
                <select
                  value={ctItemId}
                  onChange={(e) =>
                    handleSelectCycleTimeTriple(ctMachineId, e.target.value)
                  }
                  className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm bg-white"
                  required
                >
                  <option value="">Select Item...</option>
                  {masterData.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.itemCode} — {item.itemName}
                    </option>
                  ))}
                </select>
              </div>

              {/* 3. Operation: Dropdown ONLY if multiple operations exist for this item */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Operation
                </label>
                {availableOperations.length > 1 ? (
                  <select
                    value={ctOperation}
                    onChange={(e) =>
                      handleSelectCycleTimeTriple(
                        ctMachineId,
                        ctItemId,
                        e.target.value
                      )
                    }
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm bg-white font-medium"
                    required
                  >
                    {availableOperations.map((op) => (
                      <option key={op} value={op}>
                        {op}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={ctOperation}
                    onChange={(e) => setCtOperation(e.target.value)}
                    placeholder="e.g. OP-10 Turning"
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm"
                    required
                  />
                )}
              </div>

              {/* 4. Cycle Time (Fixed sticky-0 bug) + Save Button */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Cycle Time
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="e.g. 54"
                    value={ctCycleTime}
                    onChange={(e) => setCtCycleTime(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm font-mono"
                    required
                  />
                  <button
                    type="submit"
                    disabled={
                      isSubmitting || !ctMachineId || !ctItemId || !ctCycleTime
                    }
                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white px-4 py-1.5 rounded text-xs font-semibold shrink-0"
                  >
                    {isSubmitting ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          </form>

          <div className="bg-white rounded border border-slate-200 shadow-sm overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 text-slate-700">
                  <th className="py-2.5 px-3 font-semibold">Machine</th>
                  <th className="py-2.5 px-3 font-semibold">Line</th>
                  <th className="py-2.5 px-3 font-semibold">Item Code & Name</th>
                  <th className="py-2.5 px-3 font-semibold">Operation</th>
                  <th className="py-2.5 px-3 font-semibold text-right">
                    Cycle Time
                  </th>
                  <th className="py-2.5 px-3 font-semibold text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(masterData.cycleTimes ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-slate-500">
                      No machine-specific cycle times configured yet. Use the form
                      above to add one.
                    </td>
                  </tr>
                ) : (
                  (masterData.cycleTimes ?? []).map((ct: MachineItemCycleTime) => {
                    const machineObj = masterData.machines.find(
                      (m) => m.id === ct.machineId
                    );
                    const itemObj = masterData.items.find(
                      (i) => i.id === ct.itemId
                    );

                    return (
                      <tr
                        key={
                          ct.id ??
                          `${ct.machineId}_${ct.itemId}_${ct.operation}`
                        }
                        className="hover:bg-slate-50"
                      >
                        <td className="py-2 px-3 font-medium text-slate-900">
                          {machineObj?.name ?? ct.machineId}
                        </td>
                        <td className="py-2 px-3 text-slate-600">
                          {machineObj?.line ?? "-"}
                        </td>
                        <td className="py-2 px-3 text-slate-800">
                          {itemObj
                            ? `${itemObj.itemCode} — ${itemObj.itemName}`
                            : ct.itemId}
                        </td>
                        <td className="py-2 px-3 text-slate-600">
                          {ct.operation}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-semibold text-blue-700">
                          {Number(ct.cycleTime).toFixed(2)}
                        </td>
                        <td className="py-2 px-3 text-right space-x-3">
                          <button
                            type="button"
                            onClick={() => {
                              setCtMachineId(ct.machineId);
                              setCtItemId(ct.itemId);
                              setCtOperation(ct.operation);
                              setCtCycleTime(String(ct.cycleTime));
                            }}
                            className="text-blue-600 hover:underline font-medium"
                          >
                            Edit
                          </button>
                          {isAdmin && (
                            <button
                              type="button"
                              disabled={isSubmitting}
                              onClick={() => handleDeleteCycleTime(ct.id)}
                              className="text-red-600 hover:underline font-medium disabled:opacity-50"
                            >
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-TAB 5: PRODUCTION LINES & SHIFTS */}
      {subTab === "lines_shifts" && (
        <div className="space-y-8">
          {/* Production Lines Section */}
          <div className="bg-white p-4 rounded border border-slate-200 shadow-sm space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Production Lines & Daily Working Minutes
              </h3>
              <p className="text-xs text-slate-500">
                Default factory schedule is 21.75 hours (1305 minutes — 24h minus 135m breaks). Updating
                working minutes applies to new shifts while keeping historical
                logs locked.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-slate-700">
                    <th className="py-2 px-3 font-semibold">Line ID</th>
                    <th className="py-2 px-3 font-semibold">Line Name</th>
                    <th className="py-2 px-3 font-semibold">
                      Daily Working Minutes (Default: 1305m)
                    </th>
                    <th className="py-2 px-3 font-semibold text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {(masterData.lines ?? []).map((line: ProductionLineMaster) => {
                    const currentMinsStr =
                      lineEdits[line.id] ?? String(line.dailyWorkingMinutes);
                    const numericMins = parseFloat(currentMinsStr) || 0;

                    return (
                      <tr key={line.id} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-mono text-slate-500">
                          {line.id}
                        </td>
                        <td className="py-2 px-3 font-semibold text-slate-900">
                          {line.name}
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="number"
                            min="1"
                            step="1"
                            disabled={!isAdmin}
                            value={currentMinsStr}
                            onChange={(e) =>
                              setLineEdits((prev) => ({
                                ...prev,
                                [line.id]: e.target.value,
                              }))
                            }
                            className={`w-28 border border-slate-300 rounded px-2 py-1 text-xs font-mono ${
                              !isAdmin ? "bg-slate-100 text-slate-500 cursor-not-allowed" : ""
                            }`}
                          />
                          <span className="ml-2 text-slate-500">
                            mins ({(numericMins / 60).toFixed(2)} hrs)
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right space-x-2">
                          {isAdmin && (
                            <>
                              <button
                                type="button"
                                disabled={isSubmitting}
                                onClick={() => handleUpdateLineMinutes(line)}
                                className="bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white px-3 py-1 rounded text-xs font-medium"
                              >
                                Update Line
                              </button>
                              <button
                                type="button"
                                disabled={isSubmitting}
                                onClick={() => handleDeleteLine(line)}
                                className="text-rose-600 hover:text-rose-800 px-2 py-1 rounded text-xs font-medium"
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <form
              onSubmit={handleAddProductionLine}
              className="pt-3 border-t border-slate-200 flex flex-wrap items-end gap-3"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  New Line Name
                </label>
                <input
                  type="text"
                  value={newLineName}
                  onChange={(e) => setNewLineName(e.target.value)}
                  placeholder="e.g. Line 4"
                  className="border border-slate-300 rounded px-2.5 py-1.5 text-xs"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Description (Optional)
                </label>
                <input
                  type="text"
                  value={newLineDesc}
                  onChange={(e) => setNewLineDesc(e.target.value)}
                  placeholder="Heavy CNC Bay"
                  className="border border-slate-300 rounded px-2.5 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Daily Working Minutes
                </label>
                <input
                  type="number"
                  value={newLineMinutes}
                  onChange={(e) => setNewLineMinutes(e.target.value)}
                  className="w-28 border border-slate-300 rounded px-2.5 py-1.5 text-xs font-mono"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={isSubmitting || !newLineName.trim()}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white px-4 py-1.5 rounded text-xs font-semibold"
              >
                + Add Production Line
              </button>
            </form>
          </div>

          {/* Shifts Section (Total Ref Mins Removed + Add/Delete Shift Added) */}
          <div className="bg-white p-4 rounded border border-slate-200 shadow-sm space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Shifts & Shift Working Minutes
              </h3>
              <p className="text-xs text-slate-500">
                Configure shift start/end timings and shift working minutes (e.g. 465m / 375m per shift).
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-slate-700">
                    <th className="py-2 px-3 font-semibold">Code</th>
                    <th className="py-2 px-3 font-semibold">Display Name</th>
                    <th className="py-2 px-3 font-semibold">Start Time</th>
                    <th className="py-2 px-3 font-semibold">End Time</th>
                    <th className="py-2 px-3 font-semibold">Shift Working Mins</th>
                    <th className="py-2 px-3 font-semibold text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {(masterData.shifts ?? []).map((shift: ShiftMaster) => {
                    const current = shiftEdits[shift.id] ?? {
                      startTime: shift.startTime,
                      endTime: shift.endTime,
                      shiftWorkingMinutes: String(shift.shiftWorkingMinutes),
                    };

                    const updateDraft = (patch: Partial<typeof current>) => {
                      setShiftEdits((prev) => ({
                        ...prev,
                        [shift.id]: { ...current, ...patch },
                      }));
                    };

                    return (
                      <tr key={shift.id} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-semibold text-slate-900">
                          {shift.shiftCode}
                        </td>
                        <td className="py-2 px-3 text-slate-800">
                          {shift.displayName}
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="time"
                            disabled={!isAdmin}
                            value={current.startTime.slice(0, 5)}
                            onChange={(e) =>
                              updateDraft({ startTime: `${e.target.value}:00` })
                            }
                            className={`border border-slate-300 rounded px-2 py-1 text-xs font-mono ${
                              !isAdmin ? "bg-slate-100 text-slate-500 cursor-not-allowed" : ""
                            }`}
                          />
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="time"
                            disabled={!isAdmin}
                            value={current.endTime.slice(0, 5)}
                            onChange={(e) =>
                              updateDraft({ endTime: `${e.target.value}:00` })
                            }
                            className={`border border-slate-300 rounded px-2 py-1 text-xs font-mono ${
                              !isAdmin ? "bg-slate-100 text-slate-500 cursor-not-allowed" : ""
                            }`}
                          />
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="number"
                            disabled={!isAdmin}
                            value={current.shiftWorkingMinutes}
                            onChange={(e) =>
                              updateDraft({
                                shiftWorkingMinutes: e.target.value,
                              })
                            }
                            className={`w-24 border border-slate-300 rounded px-2 py-1 text-xs font-mono ${
                              !isAdmin ? "bg-slate-100 text-slate-500 cursor-not-allowed" : ""
                            }`}
                          />
                          <span className="ml-1.5 text-slate-500">mins</span>
                        </td>
                        <td className="py-2 px-3 text-right space-x-2">
                          {isAdmin && (
                            <>
                              <button
                                type="button"
                                disabled={isSubmitting}
                                onClick={() => handleUpdateShift(shift)}
                                className="bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white px-3 py-1 rounded text-xs font-medium"
                              >
                                Save Shift
                              </button>
                              <button
                                type="button"
                                disabled={isSubmitting}
                                onClick={() => handleDeleteShift(shift)}
                                className="text-rose-600 hover:text-rose-800 px-2 py-1 rounded text-xs font-medium"
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Add New Shift Form */}
            {isAdmin && (
              <form
                onSubmit={handleAddShift}
                className="pt-3 border-t border-slate-200 flex flex-wrap items-end gap-3"
              >
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Shift Code
                  </label>
                  <input
                    type="text"
                    value={newShiftCode}
                    onChange={(e) => setNewShiftCode(e.target.value)}
                    placeholder="e.g. Shift D"
                    className="w-28 border border-slate-300 rounded px-2.5 py-1.5 text-xs"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Display Name (Optional)
                  </label>
                  <input
                    type="text"
                    value={newShiftDisplay}
                    onChange={(e) => setNewShiftDisplay(e.target.value)}
                    placeholder="e.g. Shift D (General)"
                    className="w-44 border border-slate-300 rounded px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Start Time
                  </label>
                  <input
                    type="time"
                    value={newShiftStart}
                    onChange={(e) => setNewShiftStart(e.target.value)}
                    className="border border-slate-300 rounded px-2.5 py-1.5 text-xs font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    End Time
                  </label>
                  <input
                    type="time"
                    value={newShiftEnd}
                    onChange={(e) => setNewShiftEnd(e.target.value)}
                    className="border border-slate-300 rounded px-2.5 py-1.5 text-xs font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Shift Working Mins
                  </label>
                  <input
                    type="number"
                    value={newShiftMins}
                    onChange={(e) => setNewShiftMins(e.target.value)}
                    className="w-24 border border-slate-300 rounded px-2.5 py-1.5 text-xs font-mono"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting || !newShiftCode.trim()}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white px-4 py-1.5 rounded text-xs font-semibold"
                >
                  + Add Shift
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MasterDataSettings;