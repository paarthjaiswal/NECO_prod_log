"use client";

import React, { useState, useEffect, useRef, useTransition } from "react";
import dynamic from "next/dynamic";
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
import { PRODUCTION_LINES } from "@/data/initialData";
import { exportShiftToExcel } from "@/services/excelExport";

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
        productionLines={PRODUCTION_LINES}
        hasUnsavedChanges={hasUnsavedDraft}
        onSaveShiftLog={() => handleSaveShiftSheet(currentShiftRows)}
        onExportExcel={() =>
          exportShiftToExcel(
            currentShiftRows,
            `${selectedDate}_${selectedLine}`
          )
        }
      />

      {(isPending || hasUnsavedDraft || statusMessage) && (
        <div className="bg-slate-800 text-white text-xs px-4 py-1.5 flex items-center justify-between">
          <span>
            {isPending
              ? "Syncing with Supabase..."
              : statusMessage ||
              (hasUnsavedDraft
                ? "Unsaved local draft active — click Save Shift to sync."
                : "")}
          </span>
        </div>
      )}

      <main className="max-w-7xl mx-auto p-4">
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
          />
        )}
      </main>
    </div>
  );
}