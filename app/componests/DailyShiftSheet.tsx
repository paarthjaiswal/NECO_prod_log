"use client"
import React, { useCallback,useState, useEffect } from 'react';
import {
  Download,
  Save,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  ExternalLink,
  Info,
} from 'lucide-react';
import { ItemMaster, MachineShiftRow, ShiftType } from '../types';
import { calculateEfficiency, calculateTotalBreakdown } from '../../services/storageService';


const DRAFT_STORAGE_KEY = "shopfloor_unsaved_draft";

interface ShiftDraftPayload {
  date: string;
  shift: string;
  line: string;
  rows: MachineShiftRow[];
  updatedAt: string;
}


interface DailyShiftSheetProps {
  rows: MachineShiftRow[];
  onUpdateRow: (index: number, updatedFields: Partial<MachineShiftRow>) => void;
  operators: string[];
  items: ItemMaster[];
  onSave: () => void;
  onExportExcel: () => void;
  hasUnsavedChanges: boolean;
  onOpenMachineInKiosk: (machineId: string) => void;
  selectedDate: string;
  selectedShift: ShiftType;
  selectedLine: string;
  productionLines?: string[];
  onSelectLine?: (line: string) => void;
}

export const DailyShiftSheet: React.FC<DailyShiftSheetProps> = ({
  rows,
  onUpdateRow,
  operators,
  items,
  onSave,
  onExportExcel,
  hasUnsavedChanges,
  onOpenMachineInKiosk,
  selectedDate,
  selectedShift,
  selectedLine,
  productionLines,
  onSelectLine,
}) => {
  // Handle Item Selection which auto-populates Operation and Std Output
  const handleItemChange = useCallback(
    (index: number, itemId: string) => {
      const selected = items.find((item) => item.id === itemId);
      if (selected) {
        onUpdateRow(index, {
          itemId: selected.id,
          itemName: selected.itemName,
          operation: selected.operation,
          stdOutput: selected.stdOutput,
        });
      } else {
        onUpdateRow(index, {
          itemId: '',
          itemName: '',
          operation: '',
          stdOutput: 0,
        });
      }
    },
    [items, onUpdateRow]
  );

  // Handle Breakdown Sub-column update
  const handleBreakdownChange = useCallback(
    (index: number, field: 'noDisc' | 'change' | 'power' | 'operator', val: number) => {
      const current = rows[index].breakdown || { noDisc: 0, change: 0, power: 0, operator: 0 };
      const safeVal = isNaN(val) ? 0 : Math.max(0, val);
      onUpdateRow(index, {
        breakdown: {
          ...current,
          [field]: safeVal,
        },
      });
    },
    [rows, onUpdateRow]
  );

  // Quick fill remaining unassigned machines with sensible defaults
  const handleQuickFillEmpty = () => {
    rows.forEach((row, idx) => {
      if (!row.operatorName || !row.itemId) {
        const op = operators[idx % operators.length];
        const it = items[idx % items.length];
        onUpdateRow(idx, {
          operatorName: op,
          itemId: it.id,
          itemName: it.itemName,
          operation: it.operation,
          stdOutput: it.stdOutput,
          actualOutput: it.stdOutput - 4,
          rework: 1,
          breakdown: { noDisc: 0, change: 10, power: 0, operator: 0 },
          remarks: 'Standard production cycle logged',
        });
      }
    });
  };

  // Reset current shift sheet to blank rows
  const handleClearSheet = () => {
    if (window.confirm('Clear all inputs on this shift sheet?')) {
      rows.forEach((_, idx) => {
        onUpdateRow(idx, {
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
      });
    }
  };

  // Calculations for summary footer row
  const totalStd = rows.reduce((acc, r) => acc + (Number(r.stdOutput) || 0), 0);
  const totalAct = rows.reduce((acc, r) => acc + (Number(r.actualOutput) || 0), 0);
  const totalRework = rows.reduce((acc, r) => acc + (Number(r.rework) || 0), 0);
  const totalNoDisc = rows.reduce((acc, r) => acc + (Number(r.breakdown.noDisc) || 0), 0);
  const totalChange = rows.reduce((acc, r) => acc + (Number(r.breakdown.change) || 0), 0);
  const totalPower = rows.reduce((acc, r) => acc + (Number(r.breakdown.power) || 0), 0);
  const totalOperator = rows.reduce((acc, r) => acc + (Number(r.breakdown.operator) || 0), 0);
  const grandBreakdown = totalNoDisc + totalChange + totalPower + totalOperator;
  const overallEfficiency = totalStd > 0 ? Math.round((totalAct / totalStd) * 100) : 0;
  const activeMachineCount = rows.filter((r) => (Number(r.stdOutput) || 0) > 0).length;

  return (
    <div className="w-full space-y-3">
      {/* Top Action Bar matching factory paper log instructions */}
      <div className="bg-white rounded-lg border border-slate-200 p-3 sm:p-4 shadow-2xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-slate-900 text-white px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-2">
            <span className="text-emerald-400 font-bold uppercase">{selectedLine}</span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-400">SHIFT:</span>
            <span>{selectedShift}</span>
          </div>
          <div className="text-xs text-slate-600 hidden md:flex items-center gap-2">
            <span>Date: <strong className="text-slate-900">{selectedDate}</strong></span>
            <span>·</span>
            <span>Active Machines: <strong className="text-emerald-700">{activeMachineCount} / {rows.length}</strong></span>
            <span>·</span>
            <span>Line Target: <strong className="text-slate-900">{totalStd} pcs</strong></span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleQuickFillEmpty}
            className="px-2.5 py-1.5 text-xs text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded font-medium flex items-center gap-1.5 transition-colors"
            title="Auto-fill empty machine rows with standard sample jobs"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-600" />
            <span className="hidden sm:inline">Fill Remaining</span>
          </button>

          <button
            onClick={handleClearSheet}
            className="px-2.5 py-1.5 text-xs text-rose-700 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded font-medium flex items-center gap-1 transition-colors"
            title="Clear all rows for this shift"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Clear Sheet</span>
          </button>

          <button
            onClick={onExportExcel}
            className="px-3 py-1.5 text-xs font-semibold text-slate-800 hover:text-slate-950 bg-emerald-100 hover:bg-emerald-200/80 border border-emerald-300 rounded flex items-center gap-1.5 transition-colors shadow-2xs"
          >
            <Download className="w-3.5 h-3.5 text-emerald-700" />
            <span>Export to Excel (.xlsx)</span>
          </button>

          <button
            onClick={onSave}
            className={`px-4 py-1.5 text-xs font-bold rounded flex items-center gap-1.5 transition-colors shadow-xs ${
              hasUnsavedChanges
                ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 ring-2 ring-amber-300 ring-offset-1'
                : 'bg-slate-900 hover:bg-slate-800 text-white'
            }`}
          >
            {hasUnsavedChanges ? (
              <>
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Save Shift Log *</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Save Shift Log</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Interactive Paper Log Sheet (Grouped Table) */}
      <div className="bg-white rounded-lg border border-slate-300 shadow-xs overflow-hidden">
        <div className="overflow-x-auto max-w-full">
          <table className="w-full text-xs text-left border-collapse select-none min-w-[1240px]">
            {/* Exact Grouped Table Header */}
            <thead>
              <tr className="bg-slate-900 text-slate-100 border-b border-slate-800 text-[11px] uppercase tracking-wider font-semibold">
                <th rowSpan={2} className="px-2.5 py-2.5 border-r border-slate-800 text-center w-12">
                  SR. NO
                </th>
                <th rowSpan={2} className="px-3 py-2.5 border-r border-slate-800 min-w-[140px]">
                  MACHINE
                </th>
                <th rowSpan={2} className="px-2.5 py-2.5 border-r border-slate-800 min-w-[150px]">
                  NAME OF OPERATOR
                </th>
                <th rowSpan={2} className="px-2.5 py-2.5 border-r border-slate-800 min-w-[170px]">
                  ITEM
                </th>
                <th rowSpan={2} className="px-2.5 py-2.5 border-r border-slate-800 min-w-[170px]">
                  OPERATION
                </th>
                <th rowSpan={2} className="px-2 py-2.5 border-r border-slate-800 text-center w-20">
                  STD O/PUT
                </th>
                <th rowSpan={2} className="px-2 py-2.5 border-r border-slate-800 text-center w-20 bg-slate-850">
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
                <th rowSpan={2} className="px-2 py-2.5 border-r border-slate-800 text-center w-18 bg-slate-800 text-amber-200">
                  TOTAL BD
                </th>
                <th rowSpan={2} className="px-2.5 py-2.5 border-r border-slate-800 min-w-[170px]">
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
                const totalBd = calculateTotalBreakdown(row.breakdown);
                const hasTarget = row.stdOutput > 0;
                const efficiency = hasTarget ? calculateEfficiency(row.actualOutput, row.stdOutput) : 0;
                const isUnderperforming = hasTarget && row.actualOutput < row.stdOutput;
                const isRowConfigured = !!row.operatorName && !!row.itemName;

                return (
                  <tr
                    key={row.id || index}
                    className={`transition-colors hover:bg-slate-50/80 ${
                      index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'
                    } ${isUnderperforming ? 'border-l-2 border-l-amber-500' : ''}`}
                  >
                    {/* 1. SR. NO */}
                    <td className="px-2 py-2 text-center font-mono font-semibold text-slate-600 border-r border-slate-200">
                      {row.srNo}
                    </td>

                    {/* 2. MACHINE */}
                    <td className="px-3 py-2 font-semibold text-slate-900 border-r border-slate-200 whitespace-nowrap">
                      <div className="flex items-center justify-between gap-1.5">
                        <span>{row.machineName}</span>
                        {isRowConfigured && (
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="Configured" />
                        )}
                      </div>
                    </td>

                    {/* 3. NAME OF OPERATOR */}
                    <td className="px-1.5 py-1 border-r border-slate-200">
                      <select
                        value={row.operatorName}
                        onChange={(e) => onUpdateRow(index, { operatorName: e.target.value })}
                        className="w-full bg-transparent px-1.5 py-1 rounded border border-transparent hover:border-slate-300 focus:border-slate-800 focus:bg-white text-xs font-medium text-slate-900 focus:outline-none"
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
                        onChange={(e) => handleItemChange(index, e.target.value)}
                        className="w-full bg-transparent px-1.5 py-1 rounded border border-transparent hover:border-slate-300 focus:border-slate-800 focus:bg-white text-xs text-slate-900 font-medium focus:outline-none"
                      >
                        <option value="">— Select Item —</option>
                        {items.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.itemName} ({item.itemCode})
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* 5. OPERATION */}
                    <td className="px-1.5 py-1 border-r border-slate-200">
                      <input
                        type="text"
                        value={row.operation}
                        onChange={(e) => onUpdateRow(index, { operation: e.target.value })}
                        placeholder="e.g. OP-10 Turning"
                        className="w-full bg-transparent px-2 py-1 rounded border border-transparent hover:border-slate-300 focus:border-slate-800 focus:bg-white text-xs text-slate-800 focus:outline-none"
                      />
                    </td>

                    {/* 6. STD O/PUT */}
                    <td className="px-1 py-1 border-r border-slate-200 text-center">
                      <input
                        type="number"
                        min="0"
                        value={row.stdOutput || ''}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => onUpdateRow(index, { stdOutput: Number(e.target.value) || 0 })}
                        className="w-16 mx-auto text-center font-mono font-semibold text-slate-700 bg-transparent px-1 py-1 rounded border border-transparent hover:border-slate-300 focus:border-slate-800 focus:bg-white focus:outline-none"
                      />
                    </td>

                    {/* 7. ACT. O/PUT */}
                    <td className="px-1 py-1 border-r border-slate-200 text-center bg-slate-50/80">
                      <input
                        type="number"
                        min="0"
                        value={row.actualOutput || (row.actualOutput === 0 && hasTarget ? 0 : '')}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => onUpdateRow(index, { actualOutput: Number(e.target.value) || 0 })}
                        className={`w-16 mx-auto text-center font-mono font-bold px-1 py-1 rounded border ${
                          isUnderperforming
                            ? 'bg-amber-50 text-amber-900 border-amber-300'
                            : efficiency >= 90 && hasTarget
                            ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                            : 'bg-white text-slate-900 border-slate-200'
                        } focus:border-slate-800 focus:outline-none`}
                      />
                    </td>

                    {/* 8. RE-WORK */}
                    <td className="px-1 py-1 border-r border-slate-200 text-center">
                      <input
                        type="number"
                        min="0"
                        value={row.rework || (row.rework === 0 ? 0 : '')}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => onUpdateRow(index, { rework: Number(e.target.value) || 0 })}
                        className={`w-14 mx-auto text-center font-mono px-1 py-1 rounded border ${
                          row.rework > 0 ? 'bg-rose-50 text-rose-800 border-rose-200 font-bold' : 'text-slate-600 border-transparent hover:border-slate-300'
                        } focus:border-slate-800 focus:bg-white focus:outline-none`}
                      />
                    </td>

                    {/* 9. BREAKDOWN SUB-COLUMNS (MINUTES) */}
                    {/* NO/DISC */}
                    <td className="px-1 py-1 border-r border-slate-200 text-center">
                      <input
                        type="number"
                        min="0"
                        value={row.breakdown.noDisc || (row.breakdown.noDisc === 0 ? '' : 0)}
                        placeholder="0"
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => handleBreakdownChange(index, 'noDisc', Number(e.target.value))}
                        className={`w-13 mx-auto text-center font-mono text-xs px-1 py-1 rounded border ${
                          row.breakdown.noDisc > 0 ? 'bg-amber-50 text-amber-900 font-semibold border-amber-300' : 'text-slate-500 border-transparent hover:border-slate-300'
                        } focus:border-slate-800 focus:bg-white focus:outline-none`}
                      />
                    </td>

                    {/* CHANGE */}
                    <td className="px-1 py-1 border-r border-slate-200 text-center">
                      <input
                        type="number"
                        min="0"
                        value={row.breakdown.change || (row.breakdown.change === 0 ? '' : 0)}
                        placeholder="0"
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => handleBreakdownChange(index, 'change', Number(e.target.value))}
                        className={`w-13 mx-auto text-center font-mono text-xs px-1 py-1 rounded border ${
                          row.breakdown.change > 0 ? 'bg-amber-50 text-amber-900 font-semibold border-amber-300' : 'text-slate-500 border-transparent hover:border-slate-300'
                        } focus:border-slate-800 focus:bg-white focus:outline-none`}
                      />
                    </td>

                    {/* POWER */}
                    <td className="px-1 py-1 border-r border-slate-200 text-center">
                      <input
                        type="number"
                        min="0"
                        value={row.breakdown.power || (row.breakdown.power === 0 ? '' : 0)}
                        placeholder="0"
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => handleBreakdownChange(index, 'power', Number(e.target.value))}
                        className={`w-13 mx-auto text-center font-mono text-xs px-1 py-1 rounded border ${
                          row.breakdown.power > 0 ? 'bg-rose-50 text-rose-900 font-semibold border-rose-300' : 'text-slate-500 border-transparent hover:border-slate-300'
                        } focus:border-slate-800 focus:bg-white focus:outline-none`}
                      />
                    </td>

                    {/* OPERATOR */}
                    <td className="px-1 py-1 border-r border-slate-200 text-center">
                      <input
                        type="number"
                        min="0"
                        value={row.breakdown.operator || (row.breakdown.operator === 0 ? '' : 0)}
                        placeholder="0"
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => handleBreakdownChange(index, 'operator', Number(e.target.value))}
                        className={`w-13 mx-auto text-center font-mono text-xs px-1 py-1 rounded border ${
                          row.breakdown.operator > 0 ? 'bg-amber-50 text-amber-900 font-semibold border-amber-300' : 'text-slate-500 border-transparent hover:border-slate-300'
                        } focus:border-slate-800 focus:bg-white focus:outline-none`}
                      />
                    </td>

                    {/* TOTAL BD */}
                    <td className="px-2 py-1 border-r border-slate-200 text-center bg-slate-50/60 font-mono font-bold text-slate-800">
                      {totalBd > 0 ? (
                        <span className={totalBd > 30 ? 'text-rose-700' : 'text-amber-700'}>
                          {totalBd}m
                        </span>
                      ) : (
                        <span className="text-slate-400 font-normal">0</span>
                      )}
                    </td>

                    {/* 10. REMARKS */}
                    <td className="px-2 py-1 border-r border-slate-200">
                      <input
                        type="text"
                        value={row.remarks}
                        onChange={(e) => onUpdateRow(index, { remarks: e.target.value })}
                        placeholder="Notes / tool issues..."
                        className="w-full bg-transparent px-2 py-1 rounded border border-transparent hover:border-slate-300 focus:border-slate-800 focus:bg-white text-xs text-slate-800 focus:outline-none"
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
                        onClick={() => onOpenMachineInKiosk(row.machineId)}
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
                </td>
                <td className="px-1 py-3 border-r border-slate-800 text-center font-mono text-amber-300">
                  {totalChange}m
                </td>
                <td className="px-1 py-3 border-r border-slate-800 text-center font-mono text-rose-300">
                  {totalPower}m
                </td>
                <td className="px-1 py-3 border-r border-slate-800 text-center font-mono text-amber-300">
                  {totalOperator}m
                </td>
                <td className="px-2 py-3 border-r border-slate-800 text-center font-mono text-amber-400 bg-slate-800">
                  {grandBreakdown}m
                </td>
                <td className="px-2 py-3 border-r border-slate-800 text-xs text-slate-300">
                  Variance: {totalAct - totalStd >= 0 ? `+${totalAct - totalStd}` : `${totalAct - totalStd}`} pcs
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
            * TAB/Enter moves focus. Changes auto-cached and stored locally.
          </div>
        </div>
      </div>
    </div>
  );
};
