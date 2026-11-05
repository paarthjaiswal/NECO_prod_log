"use client";
import React, { useState } from 'react';
import {
  Sliders,
  Plus,
  Trash2,
  Edit2,
  Save,
  RotateCcw,
  CheckCircle2,
  User,
  Factory,
  Package,
  Layers,
} from 'lucide-react';
import { ItemMaster, MachineMaster, MasterDataState } from '@/types';
import {
  upsertMachineMaster,
  disableMachineMaster,
  upsertItemMaster,
  deleteItemMaster,
  addOperatorMaster,
  removeOperatorMaster,
} from '@/actions/shiftActions';

interface MasterDataSettingsProps {
  masterData: MasterDataState;
  onRefreshMasterData: () => Promise<void> | void;
  onResetAllDemoData?: () => void;
}

export const MasterDataSettings: React.FC<MasterDataSettingsProps> = ({
  masterData,
  onRefreshMasterData,
  onResetAllDemoData,
}) => {
  // Unpack masterData so all existing JSX tables below work untouched
  const machines = masterData.machines.filter((m) => m.status !== 'idle');
  const { operators, items } = masterData;

  const [subTab, setSubTab] = useState<'machines' | 'operators' | 'items'>('machines');
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  // New Operator Form State
  const [newOperatorName, setNewOperatorName] = useState('');

  // New Machine Form State
  const [newMachineName, setNewMachineName] = useState('');
  const [newMachineCode, setNewMachineCode] = useState('');
  const [newMachineType, setNewMachineType] = useState('VMC / CNC');
  const [newMachineLine, setNewMachineLine] = useState('Line 1');
  const [machineLineFilter, setMachineLineFilter] = useState('all');

  // New Item Form State
  const [newItemName, setNewItemName] = useState('');
  const [newItemCode, setNewItemCode] = useState('');
  const [newOperation, setNewOperation] = useState('');
  const [newStdOutput, setNewStdOutput] = useState<number>(100);

  // Editing state
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  const triggerNotice = (msg: string) => {
    setSavedNotice(msg);
    setTimeout(() => setSavedNotice(null), 3000);
  };

  // --- Machine Handlers (Backed by Supabase) ---
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
      status: 'active',
    };

    try {
      await upsertMachineMaster(newMachine, nextNumber);
      await onRefreshMasterData();
      setNewMachineName('');
      setNewMachineCode('');
      triggerNotice(`Added machine "${newMachine.name}" to plant directory.`);
    } catch (err) {
      console.error('Failed to add machine:', err);
      alert('Failed to save machine to database.');
    }
  };

  const handleDeleteMachine = async (id: string, name: string) => {
    if (machines.length <= 1) {
      alert('At least one machine must remain in the factory matrix.');
      return;
    }
    if (window.confirm(`Delete machine "${name}" from master data?`)) {
      try {
        await disableMachineMaster(id);
        await onRefreshMasterData();
        triggerNotice(`Machine "${name}" removed.`);
      } catch (err) {
        console.error('Failed to disable machine:', err);
        alert('Failed to remove machine.');
      }
    }
  };

  // --- Operator Handlers (Backed by Supabase) ---
  const handleAddOperator = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newOperatorName.trim();
    if (!cleanName) return;
    if (operators.includes(cleanName)) {
      alert('This operator name already exists.');
      return;
    }

    try {
      await addOperatorMaster(cleanName);
      await onRefreshMasterData();
      setNewOperatorName('');
      triggerNotice(`Operator "${cleanName}" registered.`);
    } catch (err) {
      console.error('Failed to add operator:', err);
      alert('Failed to save operator to database.');
    }
  };

  const handleDeleteOperator = async (opName: string) => {
    if (operators.length <= 1) {
      alert('At least one operator must remain in master records.');
      return;
    }
    if (window.confirm(`Remove operator "${opName}"?`)) {
      try {
        await removeOperatorMaster(opName);
        await onRefreshMasterData();
        triggerNotice(`Operator "${opName}" deleted.`);
      } catch (err) {
        console.error('Failed to remove operator:', err);
        alert('Failed to remove operator.');
      }
    }
  };

  // --- Item & Operation Handlers (Backed by Supabase) ---
  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim() || !newOperation.trim()) return;

    const newItem: ItemMaster = {
      id: `it_${Date.now()}`,
      itemCode: newItemCode.trim().toUpperCase() || `P-${items.length + 1}`,
      itemName: newItemName.trim(),
      operation: newOperation.trim(),
      stdOutput: Number(newStdOutput) || 50,
    };

    try {
      await upsertItemMaster(newItem);
      await onRefreshMasterData();
      setNewItemName('');
      setNewItemCode('');
      setNewOperation('');
      setNewStdOutput(100);
      triggerNotice(`Component "${newItem.itemName}" registered.`);
    } catch (err) {
      console.error('Failed to add item:', err);
      alert('Failed to save component to database.');
    }
  };

  const handleUpdateItemStd = async (id: string, stdOutput: number) => {
    const existingItem = items.find((it) => it.id === id);
    if (!existingItem || existingItem.stdOutput === stdOutput) return;

    try {
      await upsertItemMaster({ ...existingItem, stdOutput });
      await onRefreshMasterData();
      triggerNotice('Standard output quota updated.');
    } catch (err) {
      console.error('Failed to update item quota:', err);
      alert('Failed to update standard output.');
    }
  };

  const handleDeleteItem = async (id: string, name: string) => {
    if (items.length <= 1) {
      alert('At least one item must remain in master directory.');
      return;
    }
    if (window.confirm(`Delete part item "${name}"?`)) {
      try {
        await deleteItemMaster(id);
        await onRefreshMasterData();
        triggerNotice(`Item "${name}" removed.`);
      } catch (err) {
        console.error('Failed to delete item:', err);
        alert('Failed to delete item.');
      }
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
            Manage client machines, machine shop operators, components, and target standard output quotas.
          </p>
        </div>

        {/* Reset Demo Data Button (only when a handler is provided) */}
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

      {/* Save Notification */}
      {savedNotice && (
        <div className="bg-emerald-50 border border-emerald-300 text-emerald-900 px-4 py-2.5 rounded-lg text-xs font-semibold flex items-center gap-2 shadow-2xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>{savedNotice}</span>
        </div>
      )}

      {/* Sub Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setSubTab('machines')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold transition-colors ${
            subTab === 'machines'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Factory className="w-3.5 h-3.5" />
          <span>Machines Directory ({machines.length})</span>
        </button>

        <button
          onClick={() => setSubTab('operators')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold transition-colors ${
            subTab === 'operators'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <User className="w-3.5 h-3.5" />
          <span>Shift Operators ({operators.length})</span>
        </button>

        <button
          onClick={() => setSubTab('items')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold transition-colors ${
            subTab === 'items'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Package className="w-3.5 h-3.5" />
          <span>Components & Standard Outputs ({items.length})</span>
        </button>
      </div>

      {/* Sub Tab 1: Machines */}
      {subTab === 'machines' && (
        <div className="space-y-5">
          {/* Add Machine Form */}
          <form onSubmit={handleAddMachine} className="bg-white p-4 rounded-lg border border-slate-200 shadow-2xs space-y-3">
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
                  <option value="Line 1">Line 1 (CNC Line)</option>
                  <option value="Line 2">Line 2 (VMC Line)</option>
                  <option value="Line 3">Line 3 (Heavy SPM)</option>
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

          {/* Machine List with Line Filter */}
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-2xs">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3 text-xs">
              <span className="font-bold text-slate-800">
                Machines Directory ({machines.filter((m) => machineLineFilter === 'all' || (m.line || 'Line 1') === machineLineFilter).length} shown)
              </span>

              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-medium">Filter by Line:</span>
                <select
                  value={machineLineFilter}
                  onChange={(e) => setMachineLineFilter(e.target.value)}
                  className="bg-white border border-slate-300 rounded px-2 py-1 text-xs font-medium text-slate-800 focus:outline-none focus:border-slate-800"
                >
                  <option value="all">All Lines</option>
                  <option value="Line 1">Line 1</option>
                  <option value="Line 2">Line 2</option>
                  <option value="Line 3">Line 3</option>
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
                  .filter((m) => machineLineFilter === 'all' || (m.line || 'Line 1') === machineLineFilter)
                  .map((m, idx) => (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-center font-mono font-bold text-slate-500">
                        {idx + 1}
                      </td>
                      <td className="px-3 py-2 font-bold text-slate-900">{m.name}</td>
                      <td className="px-3 py-2">
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-800 border border-slate-200">
                          {m.line || 'Line 1'}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-600">{m.code}</td>
                      <td className="px-3 py-2 text-slate-600">{m.type || 'CNC Machine'}</td>
                      <td className="px-3 py-2 text-center">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                          Operational
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => handleDeleteMachine(m.id, m.name)}
                          className="p-1 text-slate-400 hover:text-rose-600 transition-colors"
                          title="Delete machine"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sub Tab 2: Operators */}
      {subTab === 'operators' && (
        <div className="space-y-5">
          {/* Add Operator Form */}
          <form onSubmit={handleAddOperator} className="bg-white p-4 rounded-lg border border-slate-200 shadow-2xs space-y-3">
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

          {/* Operator Grid */}
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
                    <span className="text-[10px] text-slate-500 font-mono">Operator #{idx + 1}</span>
                  </div>
                </div>

                <button
                  onClick={() => handleDeleteOperator(op)}
                  className="p-1 text-slate-400 hover:text-rose-600 transition-colors"
                  title="Remove operator"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sub Tab 3: Items & Operations */}
      {subTab === 'items' && (
        <div className="space-y-5">
          {/* Add Item Form */}
          <form onSubmit={handleAddItem} className="bg-white p-4 rounded-lg border border-slate-200 shadow-2xs space-y-3">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5 text-emerald-600" />
              <span>Define New Machining Part & Standard Quota</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
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
                  Operation Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. OP-10 Turning"
                  value={newOperation}
                  onChange={(e) => setNewOperation(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:border-slate-800 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Std Output Quota (Shift)
                </label>
                <input
                  type="number"
                  min="1"
                  value={newStdOutput}
                  onChange={(e) => setNewStdOutput(Number(e.target.value) || 1)}
                  className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded focus:border-slate-800 focus:outline-none text-center"
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
                <span>Register Part & Target</span>
              </button>
            </div>
          </form>

          {/* Items Table */}
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-2xs">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-900 text-slate-100 uppercase text-[11px] font-semibold">
                <tr>
                  <th className="px-3 py-2.5">Part Code</th>
                  <th className="px-3 py-2.5">Component / Item Name</th>
                  <th className="px-3 py-2.5">Standard Operation</th>
                  <th className="px-3 py-2.5 text-center">Std Output / Shift</th>
                  <th className="px-3 py-2.5 text-right w-20">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {items.map((it) => (
                  <tr key={it.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono font-bold text-slate-700">{it.itemCode}</td>
                    <td className="px-3 py-2 font-bold text-slate-900">{it.itemName}</td>
                    <td className="px-3 py-2 text-slate-600">{it.operation}</td>
                    <td className="px-3 py-2 text-center">
                      <div className="inline-flex items-center gap-1">
                        <input
                          type="number"
                          min="1"
                          defaultValue={it.stdOutput}
                          onBlur={(e) => handleUpdateItemStd(it.id, Number(e.target.value) || 1)}
                          className="w-16 px-1.5 py-0.5 text-center font-mono font-bold bg-slate-50 border border-slate-300 rounded text-xs focus:bg-white focus:border-slate-800 focus:outline-none"
                        />
                        <span className="text-slate-500 font-mono text-[11px]">pcs</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => handleDeleteItem(it.id, it.itemName)}
                        className="p-1 text-slate-400 hover:text-rose-600 transition-colors"
                        title="Delete component"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default MasterDataSettings;