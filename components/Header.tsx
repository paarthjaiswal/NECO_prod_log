"use client";
import React, { useState, useRef } from 'react';
import {
  TableProperties,
  Monitor,
  BarChart3,
  Sliders,
  RotateCcw,
  Download,
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Layers,
  LogOut,
} from 'lucide-react';
import { ActiveTab, ShiftType, ShiftLockInfo } from '@/types';
import { SHIFTS } from '@/data/initialData';
import { logoutUnitHead } from '@/actions/authActions';

interface HeaderProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  selectedShift: ShiftType;
  setSelectedShift: (shift: ShiftType) => void;
  selectedLine: string;
  setSelectedLine: (line: string) => void;
  productionLines: string[];
  shifts?: ShiftType[];
  hasUnsavedChanges: boolean;
  onSaveShiftLog: () => void;
  onExportExcel: () => void;
  onResetDemo?: () => void;
  isSaving?: boolean;
  isAdmin?: boolean;
  isShiftLocked?: boolean;
  shiftLock?: ShiftLockInfo;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  selectedDate,
  setSelectedDate,
  selectedShift,
  setSelectedShift,
  selectedLine,
  setSelectedLine,
  productionLines,
  shifts,
  onResetDemo,
  onExportExcel,
  hasUnsavedChanges,
  onSaveShiftLog,
  isSaving = false,
  isAdmin = false,
  isShiftLocked = false,
  shiftLock,
}) => {
  const availableShifts = shifts && shifts.length > 0 ? shifts : (SHIFTS as ShiftType[]);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const dateInputRef = useRef<HTMLInputElement>(null);

  const handleOpenDatePicker = () => {
    const input = dateInputRef.current;
    if (!input) return;
    try {
      if (typeof input.showPicker === 'function') {
        input.showPicker();
      } else {
        input.focus();
        input.click();
      }
    } catch {
      input.focus();
      input.click();
    }
  };

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      await logoutUnitHead();
      window.location.reload();
    } catch (err) {
      console.error("Logout error:", err);
      window.location.reload();
    }
  };

  return (
    <header className="bg-slate-900 border-b border-slate-800 text-white md:sticky md:top-0 z-40 shadow-sm">
      {/* Primary Top Bar */}
      <div className={`transition-all ${activeTab === 'sheet' ? 'w-full px-2 sm:px-3' : 'max-w-7xl mx-auto px-3 sm:px-6 lg:px-8'}`}>
        <div className="flex flex-wrap items-center justify-between gap-2.5 py-2.5 lg:py-0 lg:min-h-16 lg:gap-4">
          {/* Zone 1: Wordmark */}
          <div className="flex items-center gap-2.5 sm:gap-3 shrink-0 order-1 min-w-0">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded bg-red-950/50 border border-red-500/40 flex items-center justify-center p-1 shadow-2xs shrink-0">
              <svg
                viewBox="0 0 36 36"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="w-5 h-5 sm:w-6 sm:h-6"
              >
                <path
                  d="M6 30V6H12.8L23.2 21.2V6H30V30H23.2L12.8 14.8V30H6Z"
                  fill="#EF4444"
                />
                <polygon points="23.2,6 30,6 23.2,14" fill="#F97316" />
                <polygon points="6,22 12.8,30 6,30" fill="#DC2626" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <span className="font-black tracking-tight text-base sm:text-xl text-slate-100 whitespace-nowrap">
                  NECO
                </span>
                <span className="text-[10px] sm:text-xs uppercase tracking-wider font-bold text-amber-400 bg-amber-950/60 border border-amber-500/40 px-1.5 py-0.5 rounded whitespace-nowrap">
                  NECO AMD log
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-normal leading-none hidden sm:block">
                Automotive & Machining Division · Shift Production Matrix
              </p>
            </div>
          </div>

          {/* Zone 2: Navigation Tabs (Wraps cleanly onto full-width row on mobile) */}
          <nav className="order-3 lg:order-2 w-full lg:w-auto flex flex-wrap items-center justify-center lg:justify-start gap-1 bg-slate-950/70 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setActiveTab('sheet')}
              className={`flex items-center justify-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded text-[11px] sm:text-xs font-semibold whitespace-nowrap transition-colors grow sm:grow-0 ${
                activeTab === 'sheet'
                  ? 'bg-slate-800 text-emerald-400 shadow-xs border border-slate-700/80'
                  : 'text-slate-300 hover:text-white hover:bg-slate-900'
              }`}
            >
              <TableProperties className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              <span>Daily Shift Sheet</span>
            </button>

            <button
              onClick={() => setActiveTab('kiosk')}
              className={`flex items-center justify-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded text-[11px] sm:text-xs font-semibold whitespace-nowrap transition-colors grow sm:grow-0 ${
                activeTab === 'kiosk'
                  ? 'bg-slate-800 text-emerald-400 shadow-xs border border-slate-700/80'
                  : 'text-slate-300 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Monitor className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              <span>Machines</span>
            </button>

            <button
              onClick={() => setActiveTab('analytics')}
              className={`flex items-center justify-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded text-[11px] sm:text-xs font-semibold whitespace-nowrap transition-colors grow sm:grow-0 ${
                activeTab === 'analytics'
                  ? 'bg-slate-800 text-emerald-400 shadow-xs border border-slate-700/80'
                  : 'text-slate-300 hover:text-white hover:bg-slate-900'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              <span>Analytics & Power BI</span>
            </button>

            {/* Master Data Tab: Only shown for Unit Head / Admin */}
            {isAdmin && (
              <button
                onClick={() => setActiveTab('settings')}
                className={`flex items-center justify-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded text-[11px] sm:text-xs font-semibold whitespace-nowrap transition-colors grow sm:grow-0 ${
                  activeTab === 'settings'
                    ? 'bg-slate-800 text-emerald-400 shadow-xs border border-slate-700/80'
                    : 'text-slate-300 hover:text-white hover:bg-slate-900'
                }`}
              >
                <Sliders className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                <span>Master Data</span>
              </button>
            )}
          </nav>

          {/* Zone 3: Global Actions & Admin Status */}
          <div className="order-2 lg:order-3 flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
            {/* Unit Head Override Badge & Exit Button */}
            {isAdmin && (
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 px-2 sm:px-2.5 py-1 rounded text-[11px] sm:text-xs font-medium shadow-xs">
                <span className="flex items-center gap-1 font-bold whitespace-nowrap">
                  <span>🔓 Unit Head Override</span>
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                  className="px-2 py-0.5 bg-emerald-800/80 hover:bg-rose-900 text-white rounded text-[11px] font-semibold transition-colors flex items-center gap-1 disabled:opacity-50 whitespace-nowrap"
                  title="Exit Unit Head session and lock override"
                >
                  <LogOut className="w-3 h-3" />
                  <span>{isLoggingOut ? 'Exiting...' : 'Lock & Exit'}</span>
                </button>
              </div>
            )}

            {onResetDemo && (
              <button
                onClick={onResetDemo}
                title="Reset all logs and masters to sample baseline"
                className="px-2 sm:px-2.5 py-1.5 text-[11px] sm:text-xs text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 rounded flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
                <span className="hidden xl:inline">Reset Demo</span>
              </button>
            )}

            <button
              onClick={onExportExcel}
              className="px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-medium text-emerald-300 hover:text-emerald-200 bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-600/40 rounded flex items-center gap-1.5 transition-colors whitespace-nowrap shadow-xs"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span>Export .xlsx</span>
            </button>
          </div>
        </div>
      </div>

      {/* Secondary Context Control Bar (Shown on Sheet & Kiosk views) */}
      {(activeTab === 'sheet' || activeTab === 'kiosk') && (
        <div className={`bg-slate-950 border-t border-slate-800/80 py-2 ${activeTab === 'sheet' ? 'w-full px-2 sm:px-3' : 'px-3 sm:px-6 lg:px-8'}`}>
          <div className={`${activeTab === 'sheet' ? 'w-full' : 'max-w-7xl mx-auto'} flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 text-xs`}>
            <div className="flex items-center gap-2 sm:gap-3 lg:gap-4 flex-wrap w-full lg:w-auto">
              {/* Date Selector (Whole label & date pill acts as a single button) */}
              <button
                type="button"
                onClick={handleOpenDatePicker}
                title="Click anywhere to change Log Date"
                className="relative flex items-center gap-2 bg-slate-900 hover:bg-slate-800 px-2.5 py-1.5 sm:py-1 rounded border border-slate-800 hover:border-slate-600 transition-colors cursor-pointer group focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              >
                <Calendar className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-400 transition-colors shrink-0" />
                <span className="text-slate-400 group-hover:text-slate-200 font-medium transition-colors">
                  Log Date:
                </span>
                <span className="text-slate-100 font-mono text-xs font-semibold">
                  {selectedDate}
                </span>
                <input
                  ref={dateInputRef}
                  type="date"
                  aria-label="Log Date"
                  tabIndex={-1}
                  value={selectedDate}
                  onChange={(e) => {
                    if (e.target.value) setSelectedDate(e.target.value);
                  }}
                  style={{ colorScheme: 'dark' }}
                  className="absolute inset-0 w-full h-full opacity-0 pointer-events-none"
                />
              </button>

              {/* Shift Selector */}
              <div className="flex flex-wrap items-center gap-1 bg-slate-900 p-1 sm:p-0.5 rounded border border-slate-800 max-w-full">
                <div className="flex items-center gap-1 px-1">
                  <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="text-slate-400 font-medium">Shift:</span>
                </div>
                {availableShifts.map((shift) => {
                  const parts = shift.split(' ');
                  const label = parts.length >= 2 ? `${parts[0]} ${parts[1]}` : shift;
                  return (
                    <button
                      key={shift}
                      onClick={() => setSelectedShift(shift)}
                      className={`px-2 py-0.5 rounded text-xs transition-colors whitespace-nowrap ${
                        selectedShift === shift
                          ? 'bg-emerald-600 text-white font-semibold shadow-xs'
                          : 'text-slate-300 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* Production Line Selector */}
              <div className="flex flex-wrap items-center gap-1 bg-slate-900 p-1 sm:p-0.5 rounded border border-slate-800 max-w-full">
                <div className="flex items-center gap-1 px-1">
                  <Layers className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="text-slate-400 font-medium">Line:</span>
                </div>
                {productionLines.map((line) => (
                  <button
                    key={line}
                    onClick={() => setSelectedLine(line)}
                    className={`px-2 py-0.5 rounded text-xs transition-colors whitespace-nowrap ${
                      selectedLine === line
                        ? 'bg-emerald-600 text-white font-semibold shadow-xs'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    {line}
                  </button>
                ))}
              </div>
            </div>

            {/* Save Status / Lock Status Indicator */}
            <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2 w-full lg:w-auto">
              {isSaving ? (
                <div className="flex items-center gap-1.5 text-amber-300 text-xs font-semibold px-2.5 py-1 rounded bg-amber-950/40 border border-amber-500/30">
                  <div className="w-3 h-3 rounded-full border-2 border-amber-300 border-t-transparent animate-spin" />
                  <span>Syncing with Cloud...</span>
                </div>
              ) : isShiftLocked ? (
                <div
                  className="flex items-center gap-1.5 text-rose-300 text-xs font-bold bg-rose-950/70 border border-rose-500/50 px-3 py-1 rounded shadow-xs"
                  title={shiftLock?.reason || "Shift editing window has closed"}
                >
                  <span>🔒 Shift Locked (Read-Only)</span>
                </div>
              ) : shiftLock?.status === 'grace_period' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <div
                    className="flex items-center gap-1.5 text-amber-300 text-xs font-bold bg-amber-950/70 border border-amber-500/50 px-2.5 py-1 rounded shadow-xs animate-pulse"
                    title={shiftLock.reason || undefined}
                  >
                    <span>⏳ Grace Buffer: {shiftLock.remainingMinutes}m left to save</span>
                  </div>
                  {hasUnsavedChanges ? (
                    <button
                      type="button"
                      onClick={onSaveShiftLog}
                      className="px-3.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs rounded transition-all flex items-center gap-1.5 shadow-md ring-2 ring-amber-400/60 ring-offset-1 ring-offset-slate-950 animate-pulse hover:animate-none"
                      title="Unsaved changes active — click to save and sync shift sheet to database"
                    >
                      <AlertTriangle className="w-3.5 h-3.5 text-slate-950" />
                      <span>Save Shift Log *</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-semibold bg-emerald-950/60 border border-emerald-600/40 px-2.5 py-1 rounded shadow-xs">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Shift Log Synced</span>
                    </div>
                  )}
                </div>
              ) : hasUnsavedChanges ? (
                <button
                  type="button"
                  onClick={onSaveShiftLog}
                  className="px-3.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs rounded transition-all flex items-center gap-1.5 shadow-md ring-2 ring-amber-400/60 ring-offset-1 ring-offset-slate-950 animate-pulse hover:animate-none"
                  title="Unsaved changes active — click to save and sync shift sheet to database"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-slate-950" />
                  <span>Save Shift Log *</span>
                </button>
              ) : (
                <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-semibold bg-emerald-950/60 border border-emerald-600/40 px-2.5 py-1 rounded shadow-xs">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Shift Log Synced</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
};

export default Header;
