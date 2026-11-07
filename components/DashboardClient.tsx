"use client";

import React, { useState, useEffect, useRef, useTransition, useMemo } from "react";
import dynamic from "next/dynamic";
import { CheckCircle2 } from "lucide-react";
import Header from "@/components/Header";
import { DailyShiftSheet } from "@/components/DailyShiftSheet";
import { OperatorKiosk } from "@/components/OperatorKiosk";
import {
  ActiveTab,
  MachineShiftRow,
  MasterDataState,
  ShiftType,
} from "@/types";
import {
  getShiftSheetRows,
  saveShiftSheetRows,
  updateSingleMachineLog,
  getMasterData,
} from "@/actions/shiftActions";
import {
  PRODUCTION_LINES,
  SHIFTS,
  generateDefaultShiftRows,
} from "@/data/initialData";
import { exportShiftToExcel } from "@/services/excelExport";
import { calculateShiftTimeBalance } from "@/services/storageService";

// Lazy-loaded: zero RAM impact on shop-floor PCs unless clicked
const AnalyticsPreview = dynamic(
  () => import("@/components/AnalyticsPreview"),
  {
    loading: () => (
      <div className="p-6 text-sm text-slate-600">Loading Analytics...</div>
    ),
  }
);

const MasterDataSettings = dynamic(
  () => import("@/components/MasterDataSettings"),
  {
    loading: () => (
      <div className="p-6 text-sm text-slate-600">Loading Settings...</div>
    ),
  }
);

const DRAFT_STORAGE_KEY = "shopfloor_unsaved_draft";

const getDraftKey = (date: string, shift: string, line: string) =>
  `${DRAFT_STORAGE_KEY}:${date}:${shift}:${line}`;

export interface DashboardClientProps {
  initialMasterData: MasterDataState;
  initialRows: MachineShiftRow[];
  initialDate: string;
  initialShift: ShiftType;
  initialLine: string;
}

export default function DashboardClient({
  initialMasterData,
  initialRows,
  initialDate,
  initialShift,
  initialLine,
}: DashboardClientProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>("sheet");
  const [kioskMachineId, setKioskMachineId] = useState<string | null>(null);
  const [masterData, setMasterData] =
    useState<MasterDataState>(initialMasterData);

  // Active filter state
  const [selectedDate, setSelectedDate] = useState<string>(initialDate);
  const [selectedShift, setSelectedShift] = useState<ShiftType>(initialShift);
  const [selectedLine, setSelectedLine] = useState<string>(initialLine);

  // Holds ONLY the 16 rows for the current Date + Shift + Line (never allLogs[])
  const [currentShiftRows, setCurrentShiftRows] =
    useState<MachineShiftRow[]>(initialRows);
  const [hasUnsavedDraft, setHasUnsavedDraft] = useState<boolean>(false);
  const [isPending, startTransition] = useTransition();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Derive active production lines from masterData (fallback to PRODUCTION_LINES)
  const availableLines = useMemo(() => {
    const active = masterData.lines
      ?.filter((l) => l.isActive !== false)
      .map((l) => l.name);
    return active && active.length > 0 ? active : PRODUCTION_LINES;
  }, [masterData.lines]);

  // Derive active shifts from masterData (fallback to SHIFTS)
  const availableShifts = useMemo(() => {
    const active = masterData.shifts
      ?.filter((s) => s.isActive !== false)
      .map((s) => s.displayName as ShiftType);
    return active && active.length > 0 ? active : (SHIFTS as ShiftType[]);
  }, [masterData.shifts]);

  const draftKey = getDraftKey(selectedDate, selectedShift, selectedLine);
  const isFirstLoad = useRef(true);

  const writeDraft = (rows: MachineShiftRow[]) => {
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          date: selectedDate,
          shift: selectedShift,
          line: selectedLine,
          rows,
          updatedAt: new Date().toISOString(),
        })
      );
    } catch {
      // Ignore storage errors (quota / restricted kiosk browsers)
    }
  };

  // Restore matching local draft, otherwise fetch fresh rows from Supabase, when filters change
  useEffect(() => {
    let isMounted = true;

    try {
      const rawDraft = localStorage.getItem(draftKey);
      if (rawDraft) {
        const parsed = JSON.parse(rawDraft);
        if (
          parsed.date === selectedDate &&
          parsed.shift === selectedShift &&
          parsed.line === selectedLine &&
          Array.isArray(parsed.rows) &&
          parsed.rows.length > 0
        ) {
          setCurrentShiftRows(parsed.rows);
          setHasUnsavedDraft(true);
          isFirstLoad.current = false;
          return;
        }
      }
    } catch {
      // Ignore malformed localStorage data
    }

    if (isFirstLoad.current) {
      isFirstLoad.current = false;
      setHasUnsavedDraft(false);
      return;
    }

    startTransition(async () => {
      try {
        const freshRows = await getShiftSheetRows(
          selectedDate,
          selectedShift,
          selectedLine
        );
        if (isMounted) {
          setCurrentShiftRows(freshRows);
          setHasUnsavedDraft(false);
        }
      } catch (err) {
        console.error("Failed to load shift rows:", err);
        if (isMounted) {
          setStatusMessage("Could not load shift data — showing last known state.");
          setTimeout(() => setStatusMessage(null), 4000);
        }
      }
    });

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, selectedShift, selectedLine]);

  const handleRowsChange = (updatedRows: MachineShiftRow[]) => {
    setCurrentShiftRows(updatedRows);
    setHasUnsavedDraft(true);
    writeDraft(updatedRows);
  };

  const handleDiscardDraft = () => {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }
    setHasUnsavedDraft(false);
    startTransition(async () => {
      try {
        const freshRows = await getShiftSheetRows(
          selectedDate,
          selectedShift,
          selectedLine
        );
        setCurrentShiftRows(freshRows);
      } catch (err) {
        console.error("Failed to reload shift rows:", err);
        setStatusMessage("Could not reload from Supabase. Your draft is still safe.");
        setTimeout(() => setStatusMessage(null), 4000);
      }
    });
  };

  const handleSaveShiftSheet = async (rowsToSave: MachineShiftRow[]) => {
    // Validate shift time accounting
    const activeShiftObj = masterData.shifts?.find(
      (s) => s.displayName === selectedShift || s.shiftCode === selectedShift
    );
    const shiftWorkingMinutes =
      activeShiftObj?.shiftWorkingMinutes ??
      rowsToSave[0]?.totalWorkingMinutes ??
      0;

    const unbalancedRows = rowsToSave.filter((row) => {
      if (!row.itemId || !(row.cycleTime > 0)) return false;
      const balance = calculateShiftTimeBalance(row, shiftWorkingMinutes);
      return !balance.isBalanced;
    });

    if (unbalancedRows.length > 0) {
      const firstBad = unbalancedRows[0];
      const bal = calculateShiftTimeBalance(firstBad, shiftWorkingMinutes);
      alert(
        `Shift Time Mismatch on ${firstBad.machineName} (Row #${firstBad.srNo}):\n\n` +
          `• Shift Duration (from DB): ${bal.shiftMinutes} mins\n` +
          `• Actual Output Time (${firstBad.actualOutput} pcs × ${firstBad.cycleTime}m): ${bal.productionMinutes} mins\n` +
          `• Required Breakdown / Wasted Time: ${bal.requiredBreakdownMinutes} mins\n` +
          `• Currently Logged Breakdown: ${bal.loggedBreakdownMinutes} mins\n\n` +
          `Please fill the remaining ${bal.unaccountedMinutes} mins in the Breakdown columns so total time equals ${bal.shiftMinutes} mins.`
      );
      return;
    }

    startTransition(async () => {
      try {
        const result = await saveShiftSheetRows(rowsToSave);
        if (result.success && result.rows) {
          setCurrentShiftRows(result.rows);
          setHasUnsavedDraft(false);
          try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
          setStatusMessage("Shift logs saved to cloud.");
          setTimeout(() => setStatusMessage(null), 3000);
        } else {
          setStatusMessage("Save failed. Your local draft is safe.");
        }
      } catch (err) {
        console.error("Error saving shift sheet:", err);
        setStatusMessage("Error saving logs. Your local draft is safe.");
      }
    });
  };

  const handleSaveSingleKioskRow = async (singleRow: MachineShiftRow) => {
    startTransition(async () => {
      try {
        const result = await updateSingleMachineLog(singleRow);
        if (result.success && result.row) {
          const updatedRows = currentShiftRows.map((r) =>
            r.machineId === result.row.machineId ? result.row : r
          );
          setCurrentShiftRows(updatedRows);
          if (hasUnsavedDraft) writeDraft(updatedRows);
          setStatusMessage(`Saved ${result.row.machineName}`);
          setTimeout(() => setStatusMessage(null), 2500);
        }
      } catch (err) {
        console.error("Error saving kiosk log:", err);
        setStatusMessage("Failed to save machine log.");
      }
    });
  };

  const handleRefreshMasterData = async () => {
    try {
      const freshMaster = await getMasterData();
      setMasterData(freshMaster);
    } catch (err) {
      console.error("Failed to refresh master data:", err);
      setStatusMessage("Could not sync master data. Check your connection.");
      setTimeout(() => setStatusMessage(null), 4000);
    }
  };

  const handleExportExcel = () => {
    exportShiftToExcel(
      currentShiftRows,
      `${selectedDate}_${selectedLine}`
    );
  };

  const handleResetDemo = () => {
    if (!window.confirm("Reset current shift rows to sample demo baseline?")) return;
    try {
      localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }
    const defaultRows = generateDefaultShiftRows(
      selectedDate,
      selectedShift,
      selectedLine
    );
    setCurrentShiftRows(defaultRows);
    setHasUnsavedDraft(true);
    writeDraft(defaultRows);
    setStatusMessage("Shift reset to demo baseline. Click 'Save Shift Log *' to sync to cloud.");
    setTimeout(() => setStatusMessage(null), 4000);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedDate={selectedDate}
        setSelectedDate={setSelectedDate}
        selectedShift={selectedShift}
        setSelectedShift={setSelectedShift}
        selectedLine={selectedLine}
        setSelectedLine={setSelectedLine}
        productionLines={availableLines}
        shifts={availableShifts}
        hasUnsavedChanges={hasUnsavedDraft}
        onSaveShiftLog={() => handleSaveShiftSheet(currentShiftRows)}
        onExportExcel={handleExportExcel}
        onResetDemo={handleResetDemo}
        isSaving={isPending}
      />

      <main
        className={
          activeTab === "sheet"
            ? "w-full px-[10px] py-3"
            : "max-w-7xl mx-auto p-4"
        }
      >
        {activeTab === "sheet" && (
          <DailyShiftSheet
            rows={currentShiftRows}
            masterData={masterData}
            onRowsChange={handleRowsChange}
            onSave={handleSaveShiftSheet}
            isSaving={isPending}
            selectedDate={selectedDate}
            selectedShift={selectedShift}
            selectedLine={selectedLine}
            hasUnsavedDraft={hasUnsavedDraft}
            onDiscardDraft={handleDiscardDraft}
            onExportExcel={handleExportExcel}
            onOpenMachineInKiosk={(machineId?: string) => {
              if (machineId) setKioskMachineId(machineId);
              setActiveTab("kiosk");
            }}
          />
        )}

        {activeTab === "kiosk" && (
          <OperatorKiosk
            rows={currentShiftRows}
            masterData={masterData}
            selectedDate={selectedDate}
            selectedShift={selectedShift}
            selectedLine={selectedLine}
            selectedMachineId={kioskMachineId}
            onSelectMachineId={setKioskMachineId}
            onSaveMachine={handleSaveSingleKioskRow}
            isSaving={isPending}
          />
        )}

        {activeTab === "analytics" && (
          <AnalyticsPreview
            rows={currentShiftRows}
            selectedDate={selectedDate}
            selectedShift={selectedShift}
            selectedLine={selectedLine}
            masterData={masterData}
          />
        )}

        {activeTab === "settings" && (
          <MasterDataSettings
            masterData={masterData}
            onRefreshMasterData={handleRefreshMasterData}
            onResetAllDemoData={handleResetDemo}
          />
        )}
      </main>

      {/* Floating Non-Intrusive Toast (does not push or shift layout) */}
      {statusMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 text-white text-xs px-4 py-2.5 rounded-lg shadow-2xl border border-slate-700 flex items-center gap-2 pointer-events-none transition-all animate-bounce">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}
    </div>
  );
}