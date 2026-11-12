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
  ShiftLockInfo,
} from "@/types";
import {
  getShiftSheetRows,
  saveShiftSheetRows,
  updateSingleMachineLog,
  getMasterData,
  getFactoryTimeContext,
} from "@/actions/shiftActions";
import {
  PRODUCTION_LINES,
  SHIFTS,
  generateDefaultShiftRows,
} from "@/data/initialData";
import { exportShiftToExcel } from "@/services/excelExport";
import {
  calculateShiftTimeBalance,
  calculateTotalBreakdown,
  evaluateShiftLock,
} from "@/services/storageService";

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

const parseIstMs = (str?: string): number => {
  if (!str) return Date.now();
  const clean = str.trim().replace(" ", "T");
  const parsed =
    clean.includes("+") ||
    clean.includes("Z") ||
    (clean.length > 10 && clean.slice(10).includes("-"))
      ? new Date(clean).getTime()
      : new Date(`${clean}+05:30`).getTime();
  return Number.isNaN(parsed) ? Date.now() : parsed;
};

const formatMsToIstString = (ms: number): string => {
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const getPart = (type: string) =>
    parts.find((p) => p.type === type)?.value || "";
  const year = getPart("year");
  const month = getPart("month");
  const day = getPart("day");
  const hour = getPart("hour") === "24" ? "00" : getPart("hour");
  const minute = getPart("minute");
  const second = getPart("second");
  return `${year}-${month}-${day}T${hour}:${minute}:${second}+05:30`;
};

export interface DashboardClientProps {
  initialMasterData: MasterDataState;
  initialRows: MachineShiftRow[];
  initialDate: string;
  initialShift: ShiftType;
  initialLine: string;
  isAdmin: boolean;
  serverNowIst: string;
}

export default function DashboardClient({
  initialMasterData,
  initialRows,
  initialDate,
  initialShift,
  initialLine,
  isAdmin = false,
  serverNowIst = "",
}: DashboardClientProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>("sheet");
  const [kioskMachineId, setKioskMachineId] = useState<string | null>(null);
  const [masterData, setMasterData] =
    useState<MasterDataState>(initialMasterData);

  // Active filter state
  const [selectedDate, setSelectedDate] = useState<string>(initialDate);
  const [selectedShift, setSelectedShift] = useState<ShiftType>(initialShift);
  const [selectedLine, setSelectedLine] = useState<string>(initialLine);

  // Live server-anchored clock state
  const [currentServerNowIst, setCurrentServerNowIst] = useState<string>(
    serverNowIst || formatMsToIstString(Date.now())
  );
  const baseServerMsRef = useRef<number>(parseIstMs(serverNowIst));
  const basePerfMsRef = useRef<number>(
    typeof performance !== "undefined" ? performance.now() : 0
  );

  // Re-anchor clock if serverNowIst prop refreshes from Server Component
  useEffect(() => {
    if (serverNowIst) {
      baseServerMsRef.current = parseIstMs(serverNowIst);
      basePerfMsRef.current =
        typeof performance !== "undefined" ? performance.now() : 0;
      setCurrentServerNowIst(serverNowIst);
    }
  }, [serverNowIst]);

  // 30-second interval advancing server time using monotonic elapsed time
  useEffect(() => {
    const timer = setInterval(() => {
      const elapsed =
        typeof performance !== "undefined"
          ? performance.now() - basePerfMsRef.current
          : 0;
      const currentMs = baseServerMsRef.current + elapsed;
      setCurrentServerNowIst(formatMsToIstString(currentMs));
    }, 30_000);

    return () => clearInterval(timer);
  }, []);

  // Sync clock with true server timestamp when filters change
  useEffect(() => {
    let isMounted = true;
    getFactoryTimeContext()
      .then((ctx) => {
        if (isMounted && ctx?.serverNowIst) {
          baseServerMsRef.current = parseIstMs(ctx.serverNowIst);
          basePerfMsRef.current =
            typeof performance !== "undefined" ? performance.now() : 0;
          setCurrentServerNowIst(ctx.serverNowIst);
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [selectedDate, selectedShift, selectedLine]);

  // Compute shift lock info based strictly on server time
  const shiftLock: ShiftLockInfo = useMemo(() => {
    return evaluateShiftLock(
      selectedDate,
      selectedShift,
      masterData.shifts ?? [],
      currentServerNowIst,
      isAdmin,
      30
    );
  }, [selectedDate, selectedShift, masterData.shifts, currentServerNowIst, isAdmin]);

  const isShiftLocked = !shiftLock.isEditable;

  // Holds ONLY the rows for the current Date + Shift + Line
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

  // Redirect to sheet if non-admin tries to access settings
  useEffect(() => {
    if (activeTab === "settings" && !isAdmin) {
      setActiveTab("sheet");
    }
  }, [activeTab, isAdmin]);

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

    // Do NOT restore unsaved localStorage draft if shift is locked
    if (!isShiftLocked) {
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
  }, [selectedDate, selectedShift, selectedLine, isShiftLocked]);

  const handleRowsChange = (updatedRows: MachineShiftRow[]) => {
    if (isShiftLocked) return;
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
    if (isShiftLocked) {
      alert(shiftLock.reason || "Shift is locked. Data is read-only.");
      return;
    }

    // Validate shift time accounting
    const activeShiftObj = masterData.shifts?.find(
      (s) => s.displayName === selectedShift || s.shiftCode === selectedShift
    );
    const shiftWorkingMinutes =
      activeShiftObj?.shiftWorkingMinutes ??
      rowsToSave[0]?.totalWorkingMinutes ??
      0;

    const unbalancedRows = rowsToSave.filter((row) => {
      const isTouched =
        !!row.itemId ||
        !!row.operatorName ||
        (row.actualOutput || 0) > 0 ||
        calculateTotalBreakdown(row.breakdown) > 0 ||
        (row.cycleTime || 0) > 0;
      if (!isTouched) return false;
      const balance = calculateShiftTimeBalance(row, shiftWorkingMinutes);
      return !balance.isBalanced;
    });

    if (unbalancedRows.length > 0) {
      const firstBad = unbalancedRows[0];
      const bal = calculateShiftTimeBalance(firstBad, shiftWorkingMinutes);
      let details = '';
      if (bal.missingCycleTime) {
        details =
          `• ERROR: Actual output (${firstBad.actualOutput} pcs) was entered, but Cycle Time is 0!\n` +
          `• Productive time cannot be verified. Please select an Item with a cycle time or enter cycle time.`;
      } else if (bal.isProductionExceeded) {
        details =
          `• ERROR: Actual output (${firstBad.actualOutput} pcs × ${firstBad.cycleTime}m = ${bal.productionMinutes} mins) exceeds shift duration (${bal.shiftMinutes} mins)!\n` +
          `• Productive time alone is greater than shift timing. Please reduce Actual Output or verify cycle time.`;
      } else if (bal.isOver) {
        details =
          `• ERROR: Total productive time (${bal.productionMinutes}m) + breakdown (${bal.loggedBreakdownMinutes}m) = ${bal.totalAccountedMinutes} mins, which exceeds shift duration (${bal.shiftMinutes} mins) by ${Math.abs(bal.unaccountedMinutes)} mins!\n` +
          `• Total productive time + total breakdown time must NOT exceed shift duration—it must be exactly equal.`;
      } else {
        details =
          `• Actual Output Time (${firstBad.actualOutput} pcs × ${firstBad.cycleTime}m): ${bal.productionMinutes} mins\n` +
          `• Required Breakdown / Downtime: ${bal.requiredBreakdownMinutes} mins\n` +
          `• Currently Logged Breakdown: ${bal.loggedBreakdownMinutes} mins\n\n` +
          `• Please fill the remaining ${bal.unaccountedMinutes} mins in Breakdown columns (NO/DISC, CHANGE, POWER, or OPERATOR) so total time equals ${bal.shiftMinutes} mins.`;
      }

      alert(
        `Shift Time Mismatch on ${firstBad.machineName} (Row #${firstBad.srNo}):\n\n` +
          `• Shift Duration (from DB): ${bal.shiftMinutes} mins\n` +
          details
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
          setTimeout(() => setStatusMessage(null), 5000);
        }
      } catch (err: unknown) {
        console.error("Error saving shift sheet:", err);
        const msg =
          err instanceof Error
            ? err.message
            : "Error saving logs. Your local draft is safe.";
        setStatusMessage(msg);
        setTimeout(() => setStatusMessage(null), 5000);
      }
    });
  };

  const handleSaveSingleKioskRow = async (singleRow: MachineShiftRow) => {
    if (isShiftLocked) {
      setStatusMessage("Shift is locked — changes cannot be saved.");
      setTimeout(() => setStatusMessage(null), 3000);
      return;
    }

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
      } catch (err: unknown) {
        console.error("Error saving kiosk log:", err);
        const msg =
          err instanceof Error ? err.message : "Failed to save machine log.";
        setStatusMessage(msg);
        setTimeout(() => setStatusMessage(null), 5000);
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
    if (isShiftLocked) {
      alert(shiftLock.reason || "Shift is locked. Data cannot be reset.");
      return;
    }
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
        isAdmin={isAdmin}
        isShiftLocked={isShiftLocked}
        shiftLock={shiftLock}
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
            isAdmin={isAdmin}
            isShiftLocked={isShiftLocked}
            shiftLock={shiftLock}
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
            isAdmin={isAdmin}
            isShiftLocked={isShiftLocked}
            shiftLock={shiftLock}
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

        {activeTab === "settings" && isAdmin && (
          <MasterDataSettings
            masterData={masterData}
            onRefreshMasterData={handleRefreshMasterData}
            onResetAllDemoData={handleResetDemo}
          />
        )}
      </main>

      {/* Floating Non-Intrusive Toast */}
      {statusMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 text-white text-xs px-4 py-2.5 rounded-lg shadow-2xl border border-slate-700 flex items-center gap-2 pointer-events-none transition-all animate-bounce">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}
    </div>
  );
}
