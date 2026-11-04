"use client"
import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  User,
  Package,
  Wrench,
  ArrowLeft,
  ArrowRight,
  Flame,
  Plus,
  Minus,
  Sparkles,
  Info,
} from 'lucide-react';
import { ItemMaster, MachineMaster, MachineShiftRow, ShiftType } from '../types';
import { calculateEfficiency, calculateTotalBreakdown } from '../../services/storageService';

interface OperatorKioskProps {
  machines: MachineMaster[];
  operators: string[];
  items: ItemMaster[];
  rows: MachineShiftRow[];
  selectedMachineId: string | null;
  onSelectMachineId: (id: string | null) => void;
  onSubmitMachineRow: (updatedRow: MachineShiftRow) => void;
  selectedDate: string;
  selectedShift: ShiftType;
  selectedLine: string;
  productionLines?: string[];
  onSelectLine?: (line: string) => void;
}

export const OperatorKiosk: React.FC<OperatorKioskProps> = ({
  machines,
  operators,
  items,
  rows,
  selectedMachineId,
  onSelectMachineId,
  onSubmitMachineRow,
  selectedDate,
  selectedShift,
  selectedLine,
  productionLines,
  onSelectLine,
}) => {
  // Current working machine row draft
  const [draft, setDraft] = useState<MachineShiftRow | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState(false);

  // Filter machines for current production line
  const lineMachines = machines.filter((m) => (m.line || 'Line 1') === selectedLine);

  // Sync draft when selectedMachineId changes
  useEffect(() => {
    if (!selectedMachineId) {
      setDraft(null);
      setValidationError(null);
      return;
    }

    const existingRow = rows.find((r) => r.machineId === selectedMachineId);
    const machine = machines.find((m) => m.id === selectedMachineId);

    if (existingRow) {
      setDraft({ ...existingRow, line: selectedLine });
    } else if (machine) {
      setDraft({
        id: `${selectedDate}_${selectedShift}_${selectedLine}_${machine.id}`,
        date: selectedDate,
        shift: selectedShift,
        line: selectedLine,
        srNo: lineMachines.findIndex((m) => m.id === machine.id) + 1,
        machineId: machine.id,
        machineName: machine.name,
        operatorName: '',
        itemId: '',
        itemName: '',
        operation: '',
        stdOutput: 0,
        actualOutput: 0,
        rework: 0,
        breakdown: { noDisc: 0, change: 0, power: 0, operator: 0 },
        remarks: '',
      });
    }
    setValidationError(null);
  }, [selectedMachineId, rows, machines, lineMachines, selectedDate, selectedShift, selectedLine]);

  // When Item changes in draft, auto-set Operation and Std Output
  const handleItemSelect = (itemId: string) => {
    if (!draft) return;
    const item = items.find((it) => it.id === itemId);
    if (item) {
      setDraft({
        ...draft,
        itemId: item.id,
        itemName: item.itemName,
        operation: item.operation,
        stdOutput: item.stdOutput,
        // If actual is 0 and stdOutput is set, default actual to stdOutput for faster adjustment
        actualOutput: draft.actualOutput === 0 ? item.stdOutput : draft.actualOutput,
      });
    } else {
      setDraft({
        ...draft,
        itemId: '',
        itemName: '',
        operation: '',
        stdOutput: 0,
      });
    }
  };

  const handleAdjustActual = (delta: number) => {
    if (!draft) return;
    const newVal = Math.max(0, (draft.actualOutput || 0) + delta);
    setDraft({ ...draft, actualOutput: newVal });
  };

  const handleAdjustRework = (delta: number) => {
    if (!draft) return;
    const newVal = Math.max(0, (draft.rework || 0) + delta);
    setDraft({ ...draft, rework: newVal });
  };

  const handleBreakdownStep = (field: 'noDisc' | 'change' | 'power' | 'operator', delta: number) => {
    if (!draft) return;
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

  const handleQuickRemark = (chip: string) => {
    if (!draft) return;
    const existing = draft.remarks ? draft.remarks + '; ' : '';
    setDraft({ ...draft, remarks: existing + chip });
  };

  // Submission with validation rule
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;

    if (!draft.operatorName) {
      setValidationError('Please select the operator name for this machine.');
      return;
    }

    if (!draft.itemId) {
      setValidationError('Please select the item/component being machined.');
      return;
    }

    // Validation rule: If Actual Output is less than Std Output,
    // prompt the worker to log breakdown minutes or a remark before submitting.
    const totalBd = calculateTotalBreakdown(draft.breakdown);
    const isUnderperforming = draft.stdOutput > 0 && draft.actualOutput < draft.stdOutput;

    if (isUnderperforming && totalBd === 0 && !draft.remarks.trim()) {
      setValidationError(
        `Actual output (${draft.actualOutput}) is below target (${draft.stdOutput}). Please record breakdown minutes (NO/DISC, CHANGE, POWER, or OPERATOR) or provide an explanation in remarks.`
      );
      return;
    }

    setValidationError(null);
    onSubmitMachineRow(draft);
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

  // If no machine selected, show the visual grid for the selected line
  if (!selectedMachineId || !draft) {
    return (
      <div className="space-y-6">
        {/* Kiosk Mode Banner */}
        <div className="bg-slate-900 text-white p-4 rounded-lg border border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>Operator Touch Kiosk — {selectedLine}</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Select your assigned machine card below to log output, scrap, and downtime minutes for{' '}
              <span className="text-emerald-400 font-medium">{selectedLine} · {selectedShift}</span> ({selectedDate}).
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono">
            <span className="text-slate-400">
              Completed: <strong className="text-emerald-400">{rows.filter((r) => r.stdOutput > 0).length}</strong> / {lineMachines.length}
            </span>
          </div>
        </div>

        {/* Machine Visual Grid for current line */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 gap-3 sm:gap-4">
          {lineMachines.map((machine, index) => {
            const row = rows.find((r) => r.machineId === machine.id);
            const isLogged = !!row && row.stdOutput > 0;
            const efficiency = isLogged ? calculateEfficiency(row.actualOutput, row.stdOutput) : 0;
            const totalBd = isLogged ? calculateTotalBreakdown(row.breakdown) : 0;
            const hasShortfall = isLogged && row.actualOutput < row.stdOutput;

            return (
              <button
                key={machine.id}
                onClick={() => onSelectMachineId(machine.id)}
                className={`relative text-left p-4 rounded-lg border transition-all text-slate-900 flex flex-col justify-between h-40 group ${
                  isLogged
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
                    {isLogged ? (
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
                  <p className="text-xs text-slate-600 font-mono mt-0.5">{machine.code} · {machine.type}</p>
                </div>

                <div className="pt-2 border-t border-slate-100 text-xs">
                  {isLogged ? (
                    <div>
                      <div className="flex items-center justify-between text-slate-700 font-mono text-[11px]">
                        <span>Act / Std:</span>
                        <strong className="text-slate-900">{row.actualOutput} / {row.stdOutput}</strong>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 mt-0.5">
                        <span className="truncate max-w-[90px]">{row.operatorName || '—'}</span>
                        {totalBd > 0 && (
                          <span className="text-amber-700 font-medium">BD: {totalBd}m</span>
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

  // Selected Machine Step-by-Step Form View
  const totalBreakdown = calculateTotalBreakdown(draft.breakdown);
  const efficiency = draft.stdOutput > 0 ? calculateEfficiency(draft.actualOutput, draft.stdOutput) : 0;
  const isShortfall = draft.stdOutput > 0 && draft.actualOutput < draft.stdOutput;

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Top Machine Nav & Header */}
      <div className="bg-slate-900 text-white rounded-lg p-4 flex items-center justify-between border border-slate-800 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onSelectMachineId(null)}
            className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
            title="Return to 16-machine grid"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold text-emerald-400">
                {selectedLine} · MACHINE #{currentIdx + 1} OF {lineMachines.length}
              </span>
              <span className="text-slate-500">·</span>
              <span className="text-xs text-slate-300">{draft.date} ({draft.shift.split(' ')[0]})</span>
            </div>
            <h2 className="text-xl font-extrabold text-white tracking-tight">{draft.machineName}</h2>
          </div>
        </div>

        {/* Machine Switcher Buttons */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handlePrevMachine}
            disabled={currentIdx === 0}
            className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-medium flex items-center gap-1 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Prev Machine</span>
          </button>
          <button
            onClick={handleNextMachine}
            disabled={currentIdx === lineMachines.length - 1}
            className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-medium flex items-center gap-1 transition-colors"
          >
            <span className="hidden sm:inline">Next Machine</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Validation Alert */}
      {validationError && (
        <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded-lg p-3 text-xs flex items-start gap-2.5 shadow-2xs">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <strong className="font-bold">Attention Required:</strong> {validationError}
          </div>
        </div>
      )}

      {/* Save Success Alert */}
      {saveSuccessMsg && (
        <div className="bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-lg p-3 text-xs flex items-center gap-2 shadow-2xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span className="font-bold">Shift entry for {draft.machineName} saved successfully!</span>
        </div>
      )}

      {/* Main Kiosk Form */}
      <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-slate-300 shadow-xs divide-y divide-slate-200">
        {/* Step 1: Assignment (Operator, Item, Operation) */}
        <div className="p-4 sm:p-5 space-y-4">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <User className="w-4 h-4 text-slate-700" />
            <span>1. Worker & Component Details</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Operator Selection */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Name of Operator <span className="text-rose-600">*</span>
              </label>
              <select
                value={draft.operatorName}
                onChange={(e) => setDraft({ ...draft, operatorName: e.target.value })}
                className="w-full bg-slate-50 border border-slate-300 rounded-md px-3 py-2 text-sm text-slate-900 font-medium focus:bg-white focus:border-slate-800 focus:outline-none"
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
                onChange={(e) => handleItemSelect(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-md px-3 py-2 text-sm text-slate-900 font-medium focus:bg-white focus:border-slate-800 focus:outline-none"
              >
                <option value="">— Select Item from Master —</option>
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.itemName} ({it.itemCode}) — Std: {it.stdOutput} pcs
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Operation & Std Output */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Operation Name
              </label>
              <input
                type="text"
                value={draft.operation}
                onChange={(e) => setDraft({ ...draft, operation: e.target.value })}
                placeholder="e.g. OP-10 Rough Turning"
                className="w-full bg-slate-50 border border-slate-300 rounded-md px-3 py-2 text-sm text-slate-900 focus:bg-white focus:border-slate-800 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Std Output Target (Shift)
              </label>
              <div className="flex items-center">
                <input
                  type="number"
                  min="0"
                  value={draft.stdOutput || ''}
                  onChange={(e) => setDraft({ ...draft, stdOutput: Number(e.target.value) || 0 })}
                  className="w-full bg-slate-50 border border-slate-300 rounded-md px-3 py-2 text-sm font-mono font-bold text-slate-900 text-center focus:bg-white focus:border-slate-800 focus:outline-none"
                />
                <span className="ml-2 text-xs font-medium text-slate-500">pcs</span>
              </div>
            </div>
          </div>
        </div>

        {/* Step 2: Production Outputs (Actual Output & Rework) */}
        <div className="p-4 sm:p-5 space-y-4 bg-slate-50/50">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Package className="w-4 h-4 text-slate-700" />
              <span>2. Shift Output & Quality Inspection</span>
            </h3>

            {draft.stdOutput > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-mono">Efficiency:</span>
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
            <div className="bg-white p-4 rounded-lg border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Actual Output (Pieces) <span className="text-rose-600">*</span>
                </label>
                <span className="text-xs font-mono text-slate-500">
                  Target: {draft.stdOutput} pcs
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleAdjustActual(-5)}
                  className="w-10 h-10 rounded bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 font-bold flex items-center justify-center text-sm"
                >
                  -5
                </button>
                <button
                  type="button"
                  onClick={() => handleAdjustActual(-1)}
                  className="w-10 h-10 rounded bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 font-bold flex items-center justify-center"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <input
                  type="number"
                  min="0"
                  value={draft.actualOutput || (draft.actualOutput === 0 && draft.stdOutput > 0 ? 0 : '')}
                  onChange={(e) => setDraft({ ...draft, actualOutput: Number(e.target.value) || 0 })}
                  className="flex-1 text-center font-mono text-2xl font-black py-1.5 bg-slate-50 border border-slate-300 rounded focus:bg-white focus:border-slate-800 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleAdjustActual(1)}
                  className="w-10 h-10 rounded bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 font-bold flex items-center justify-center"
                >
                  <Plus className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleAdjustActual(5)}
                  className="w-10 h-10 rounded bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 font-bold flex items-center justify-center text-sm"
                >
                  +5
                </button>
              </div>

              {/* Quick Preset Buttons */}
              <div className="flex items-center gap-1.5 justify-center pt-1">
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, actualOutput: draft.stdOutput })}
                  className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded"
                >
                  Exact Target ({draft.stdOutput})
                </button>
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, actualOutput: Math.max(0, draft.stdOutput - 5) })}
                  className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 px-2 py-0.5 rounded"
                >
                  -5 Pcs
                </button>
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, actualOutput: draft.stdOutput + 5 })}
                  className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 px-2 py-0.5 rounded"
                >
                  +5 Pcs
                </button>
              </div>
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
                  onClick={() => handleAdjustRework(-1)}
                  className="w-10 h-10 rounded bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 font-bold flex items-center justify-center"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <input
                  type="number"
                  min="0"
                  value={draft.rework || (draft.rework === 0 ? 0 : '')}
                  onChange={(e) => setDraft({ ...draft, rework: Number(e.target.value) || 0 })}
                  className="flex-1 text-center font-mono text-2xl font-black py-1.5 bg-slate-50 border border-slate-300 rounded focus:bg-white focus:border-slate-800 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleAdjustRework(1)}
                  className="w-10 h-10 rounded bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 font-bold flex items-center justify-center"
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

        {/* Step 3: Breakdown Downtime (Exact 4 sub-columns) */}
        {/* Validation rule: If Actual < Std Output, highlight in amber and prompt worker */}
        <div
          className={`p-4 sm:p-5 space-y-4 transition-colors ${
            isShortfall ? 'bg-amber-50/70 border-y-2 border-y-amber-400' : 'bg-white'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Wrench className="w-4 h-4 text-amber-600" />
                <span>3. Breakdown & Downtime Log (Minutes)</span>
              </h3>
              {isShortfall && (
                <p className="text-xs text-amber-800 font-medium mt-0.5 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                  <span>
                    Shortfall: {draft.stdOutput - draft.actualOutput} pcs under target. Please record downtime minutes or shift remark.
                  </span>
                </p>
              )}
            </div>

            <div className="text-xs font-mono font-bold bg-slate-900 text-amber-300 px-3 py-1 rounded">
              Total Downtime: {totalBreakdown} mins
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* 1. NO/DISC */}
            <div className="bg-white p-3 rounded border border-slate-300 shadow-2xs space-y-2">
              <span className="block text-[11px] font-bold text-slate-800 uppercase" title="Disc / Casting shortage">
                NO / DISC
              </span>
              <p className="text-[10px] text-slate-500 leading-tight">Material / Disc shortage</p>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="0"
                  value={draft.breakdown.noDisc || (draft.breakdown.noDisc === 0 ? '' : 0)}
                  placeholder="0"
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      breakdown: { ...draft.breakdown, noDisc: Number(e.target.value) || 0 },
                    })
                  }
                  className="w-full text-center font-mono text-base font-bold bg-slate-50 border border-slate-300 rounded py-1"
                />
                <span className="text-xs text-slate-500">m</span>
              </div>
              <div className="flex items-center gap-1 pt-1">
                <button
                  type="button"
                  onClick={() => handleBreakdownStep('noDisc', 10)}
                  className="text-[10px] flex-1 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                >
                  +10m
                </button>
                <button
                  type="button"
                  onClick={() => handleBreakdownStep('noDisc', 20)}
                  className="text-[10px] flex-1 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                >
                  +20m
                </button>
              </div>
            </div>

            {/* 2. CHANGE */}
            <div className="bg-white p-3 rounded border border-slate-300 shadow-2xs space-y-2">
              <span className="block text-[11px] font-bold text-slate-800 uppercase" title="Tool / insert change">
                CHANGE
              </span>
              <p className="text-[10px] text-slate-500 leading-tight">Tool insert / job setup</p>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="0"
                  value={draft.breakdown.change || (draft.breakdown.change === 0 ? '' : 0)}
                  placeholder="0"
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      breakdown: { ...draft.breakdown, change: Number(e.target.value) || 0 },
                    })
                  }
                  className="w-full text-center font-mono text-base font-bold bg-slate-50 border border-slate-300 rounded py-1"
                />
                <span className="text-xs text-slate-500">m</span>
              </div>
              <div className="flex items-center gap-1 pt-1">
                <button
                  type="button"
                  onClick={() => handleBreakdownStep('change', 10)}
                  className="text-[10px] flex-1 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                >
                  +10m
                </button>
                <button
                  type="button"
                  onClick={() => handleBreakdownStep('change', 15)}
                  className="text-[10px] flex-1 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                >
                  +15m
                </button>
              </div>
            </div>

            {/* 3. POWER */}
            <div className="bg-white p-3 rounded border border-slate-300 shadow-2xs space-y-2">
              <span className="block text-[11px] font-bold text-slate-800 uppercase" title="Electrical failure / trip">
                POWER
              </span>
              <p className="text-[10px] text-slate-500 leading-tight">Feeder trip / power outage</p>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="0"
                  value={draft.breakdown.power || (draft.breakdown.power === 0 ? '' : 0)}
                  placeholder="0"
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      breakdown: { ...draft.breakdown, power: Number(e.target.value) || 0 },
                    })
                  }
                  className="w-full text-center font-mono text-base font-bold bg-slate-50 border border-slate-300 rounded py-1"
                />
                <span className="text-xs text-slate-500">m</span>
              </div>
              <div className="flex items-center gap-1 pt-1">
                <button
                  type="button"
                  onClick={() => handleBreakdownStep('power', 15)}
                  className="text-[10px] flex-1 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                >
                  +15m
                </button>
                <button
                  type="button"
                  onClick={() => handleBreakdownStep('power', 30)}
                  className="text-[10px] flex-1 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                >
                  +30m
                </button>
              </div>
            </div>

            {/* 4. OPERATOR */}
            <div className="bg-white p-3 rounded border border-slate-300 shadow-2xs space-y-2">
              <span className="block text-[11px] font-bold text-slate-800 uppercase" title="Operator delay">
                OPERATOR
              </span>
              <p className="text-[10px] text-slate-500 leading-tight">Unattended / delay</p>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="0"
                  value={draft.breakdown.operator || (draft.breakdown.operator === 0 ? '' : 0)}
                  placeholder="0"
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      breakdown: { ...draft.breakdown, operator: Number(e.target.value) || 0 },
                    })
                  }
                  className="w-full text-center font-mono text-base font-bold bg-slate-50 border border-slate-300 rounded py-1"
                />
                <span className="text-xs text-slate-500">m</span>
              </div>
              <div className="flex items-center gap-1 pt-1">
                <button
                  type="button"
                  onClick={() => handleBreakdownStep('operator', 10)}
                  className="text-[10px] flex-1 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                >
                  +10m
                </button>
                <button
                  type="button"
                  onClick={() => handleBreakdownStep('operator', 20)}
                  className="text-[10px] flex-1 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                >
                  +20m
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Step 4: Remarks & Quick Reason Chips */}
        <div className="p-4 sm:p-5 space-y-3">
          <label className="block text-xs font-semibold text-slate-700">
            Shift Remarks & Delay Notes
          </label>
          <input
            type="text"
            value={draft.remarks}
            onChange={(e) => setDraft({ ...draft, remarks: e.target.value })}
            placeholder="Type notes or tap quick chips below..."
            className="w-full bg-slate-50 border border-slate-300 rounded-md px-3 py-2 text-sm text-slate-900 focus:bg-white focus:border-slate-800 focus:outline-none"
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
                onClick={() => handleQuickRemark(chip)}
                className="text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 px-2 py-0.5 rounded transition-colors"
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
            <button
              type="submit"
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider rounded-md shadow-xs flex items-center gap-2 transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Submit & Save Machine Entry</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
