"use client";

import React, { useState, useEffect, useRef, useTransition, useMemo } from "react";
import dynamic from "next/dynamic";
import Header from "@/components/Header";
import { DailyShiftSheet } from "@/components/DailyShiftSheet";
import { OperatorKiosk } from "@/components/OperatorKiosk";
import {
  ActiveTab,
  MachineMaster,
  MachineShiftRow,
  MasterDataState,
  ShiftType,
  ShiftLockInfo,
} from "@/types";
import {
  getShiftSheetRows,
  saveShiftSheetRows,
  updateSingleMachineLog,
  saveMachineRuns,
  getMasterData,
  getFactoryTimeContext,
  checkShiftEditWindow,
} from "@/actions/shiftActions";
import {
  PRODUCTION_LINES,
  SHIFTS,
} from "@/data/initialData";
import { exportShiftToExcel } from "@/services/excelExport";
import {
  calculateMachineGroupTimeBalance,
  calculateTotalBreakdown,
  evaluateShiftLock,
} from "@/services/storageService";
import { useFeedback } from "@/context/FeedbackContext";

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

/**
 * Ensures that every permanent machine belonging to the target line in Master Data
 * (with status !== "disabled") exists in the rows array.
 * - Preserves existing machine runs and their user-entered data, ordered by runNo.
 * - Generates 1 default blank row with runNo: 1 for any line machine lacking rows.
 * - Normalizes srNo sequentially (1, 2, 3...) based on line machines order.
 * - Appends valid temporary machines (isTempMachine or machineId starts with "temp_") for this line.
 */
function isPopulatedUiRow(r: MachineShiftRow): boolean {
  const bdTotal =
    (Number(r.breakdown?.noDisc) || 0) +
    (Number(r.breakdown?.change) || 0) +
    (Number(r.breakdown?.power) || 0) +
    (Number(r.breakdown?.operator) || 0) +
    (Number(r.breakdown?.machineBreakdown) || 0) +
    (Number(r.breakdown?.fixProgSettings) || 0);

  return (
    (Number(r.actualOutput) || 0) > 0 ||
    (Number(r.stdOutput) || 0) > 0 ||
    (Number(r.rework) || 0) > 0 ||
    Boolean(r.operatorName && r.operatorName.trim()) ||
    Boolean(r.itemId && r.itemId.trim()) ||
    Boolean(r.itemName && r.itemName.trim()) ||
    Boolean(r.operation && r.operation.trim()) ||
    (Number(r.cycleTime) || 0) > 0 ||
    bdTotal > 0 ||
    Boolean(r.remarks && r.remarks.trim())
  );
}

export function ensureAllLineMachinesInRows(
  currentRows: MachineShiftRow[],
  lineMachines: MachineMaster[],
  date: string,
  shift: ShiftType,
  line: string,
  shiftWorkingMinutes: number
): MachineShiftRow[] {
  const normalize = (s?: string | null) => (s || "").trim().toLowerCase();
  const extractCode = (s?: string | null) => {
    if (!s) return "";
    const m = s.trim().match(/^(Shift\s+[A-Za-z0-9]+)/i);
    return m ? m[1].toLowerCase() : s.trim().toLowerCase();
  };
  const normTargetDate = (date || "").trim();
  const targetShiftCode = extractCode(shift);
  const targetLine = normalize(line || "Line 1");
  const result: MachineShiftRow[] = [];
  const assignedRowIds = new Set<string>();

  // 1. Permanent machines in lineMachines order
  lineMachines.forEach((machine, mIdx) => {
    const srNo = mIdx + 1;
    const machNormName = normalize(machine.name);

    // Checks whether machine already exists in currentRows using both machine.id OR machine.name
    const matchingRows = (currentRows || []).filter((r) => {
      if (r.isTempMachine || String(r.machineId || "").startsWith("temp_")) return false;
      // Guard against rows belonging to a different date, shift, or line
      if (r.date && normTargetDate && r.date.trim() !== normTargetDate) return false;
      if (r.line && targetLine && normalize(r.line) !== targetLine) return false;
      if (r.shift && targetShiftCode) {
        const rShiftCode = extractCode(r.shift);
        if (rShiftCode && rShiftCode !== targetShiftCode) return false;
      }

      return (
        r.machineId === machine.id ||
        Boolean(machNormName && normalize(r.machineName) === machNormName)
      );
    });

    if (matchingRows.length > 0) {
      // Deduplicate runs with the same runNo: keep populated over empty
      const byRunNo = new Map<number, MachineShiftRow>();
      for (const r of matchingRows) {
        const runNo = Number(r.runNo) || 1;
        const existing = byRunNo.get(runNo);
        if (!existing) {
          byRunNo.set(runNo, r);
        } else {
          if (!isPopulatedUiRow(existing) && isPopulatedUiRow(r)) {
            byRunNo.set(runNo, r);
          }
        }
      }

      const deduplicatedRuns = Array.from(byRunNo.values()).sort(
        (a, b) => (Number(a.runNo) || 1) - (Number(b.runNo) || 1)
      );

      deduplicatedRuns.forEach((r, runIdx) => {
        if (r.id) assignedRowIds.add(r.id);
        result.push({
          ...r,
          date: date || r.date,
          shift: shift || r.shift,
          line: line || r.line,
          srNo,
          runNo: Number(r.runNo) || runIdx + 1,
          isTempMachine: false,
          machineId: machine.id,
          machineName: machine.name,
          machineCode: machine.code || r.machineCode || undefined,
          totalWorkingMinutes: shiftWorkingMinutes || r.totalWorkingMinutes || 1305,
          shiftWorkingMinutes: shiftWorkingMinutes || r.shiftWorkingMinutes || 1305,
        });
      });
    } else {
      result.push({
        id: `${date}_${shift}_${line}_${machine.id}`,
        date,
        shift,
        line,
        srNo,
        runNo: 1,
        isTempMachine: false,
        machineId: machine.id,
        machineName: machine.name,
        machineCode: machine.code || undefined,
        operatorName: "",
        itemId: "",
        itemName: "",
        operation: "",
        cycleTime: 0,
        totalWorkingMinutes: shiftWorkingMinutes || 1305,
        shiftWorkingMinutes: shiftWorkingMinutes || 1305,
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
      });
    }
  });

  // 2. Temporary machines for this line
  const tempRows = (currentRows || []).filter(
    (r) =>
      !assignedRowIds.has(r.id) &&
      (Boolean(r.isTempMachine) === true || String(r.machineId || "").startsWith("temp_")) &&
      (!r.date || !normTargetDate || r.date.trim() === normTargetDate) &&
      (!r.line || normalize(r.line || line || "Line 1") === targetLine) &&
      (!r.shift || !targetShiftCode || !extractCode(r.shift) || extractCode(r.shift) === targetShiftCode)
  );

  const tempGroups = new Map<string, MachineShiftRow[]>();
  for (const r of tempRows) {
    const key = r.machineId;
    if (!tempGroups.has(key)) {
      tempGroups.set(key, []);
    }
    tempGroups.get(key)!.push(r);
  }

  let nextSrNo = lineMachines.length + 1;
  for (const [, runs] of tempGroups.entries()) {
    const byRunNo = new Map<number, MachineShiftRow>();
    for (const r of runs) {
      const runNo = Number(r.runNo) || 1;
      const existing = byRunNo.get(runNo);
      if (!existing) {
        byRunNo.set(runNo, r);
      } else if (!isPopulatedUiRow(existing) && isPopulatedUiRow(r)) {
        byRunNo.set(runNo, r);
      }
    }
    const deduplicatedRuns = Array.from(byRunNo.values()).sort(
      (a, b) => (Number(a.runNo) || 1) - (Number(b.runNo) || 1)
    );

    deduplicatedRuns.forEach((r, runIdx) => {
      result.push({
        ...r,
        date: date || r.date,
        shift: shift || r.shift,
        line: line || r.line,
        srNo: nextSrNo,
        runNo: Number(r.runNo) || runIdx + 1,
        isTempMachine: true,
        totalWorkingMinutes: shiftWorkingMinutes || r.totalWorkingMinutes || 1305,
        shiftWorkingMinutes: shiftWorkingMinutes || 1305,
      });
    });
    nextSrNo++;
  }

  // 3. Final deduplication pass:
  // Group rows by canonical key (row.machineId || normalize(row.machineName)).
  // If a machine has multiple rows with the same runNo, keep ONLY the populated row (or first row)
  // and discard the duplicate empty row.
  const finalGrouped = new Map<string, Map<number, MachineShiftRow>>();
  const finalOrderedKeys: string[] = [];

  for (const row of result) {
    const canonKey = row.machineId || normalize(row.machineName);
    if (!finalGrouped.has(canonKey)) {
      finalGrouped.set(canonKey, new Map());
      finalOrderedKeys.push(canonKey);
    }
    const runMap = finalGrouped.get(canonKey)!;
    const runNo = Number(row.runNo) || 1;
    const existing = runMap.get(runNo);
    if (!existing) {
      runMap.set(runNo, row);
    } else {
      if (!isPopulatedUiRow(existing) && isPopulatedUiRow(row)) {
        runMap.set(runNo, row);
      }
    }
  }

  const finalResult: MachineShiftRow[] = [];
  for (const key of finalOrderedKeys) {
    const runMap = finalGrouped.get(key)!;
    const sortedRuns = Array.from(runMap.values()).sort(
      (a, b) => (Number(a.runNo) || 1) - (Number(b.runNo) || 1)
    );
    finalResult.push(...sortedRuns);
  }

  return finalResult;
}

export interface DashboardClientProps {
  initialMasterData: MasterDataState;
  initialRows: MachineShiftRow[];
  initialDate: string;
  initialShift: ShiftType;
  initialLine: string;
  isAdmin?: boolean;
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

  const [isShiftLocked, setIsShiftLocked] = useState<boolean>(
    !isAdmin && !shiftLock.isEditable
  );

  // Check editability whenever selectedDate or selectedShift changes via server action wrapper
  useEffect(() => {
    if (isAdmin) {
      setIsShiftLocked(false);
      return;
    }

    // Synchronously set optimistic lock state from client-evaluated shiftLock
    setIsShiftLocked(!shiftLock.isEditable);

    let isMounted = true;
    checkShiftEditWindow(selectedDate, selectedShift, 30)
      .then((windowResult) => {
        if (isMounted) {
          setIsShiftLocked(!isAdmin && !windowResult.is_editable);
        }
      })
      .catch(() => {
        if (isMounted) {
          setIsShiftLocked(!isAdmin && !shiftLock.isEditable);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [selectedDate, selectedShift, isAdmin, shiftLock.isEditable]);

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

  // Derive active machines for the currently selected line
  const currentLineMachines = useMemo(() => {
    const targetLine = (selectedLine || "Line 1").trim().toLowerCase();
    return (masterData.machines || [])
      .filter((m) => {
        const mLine = (m.line || "Line 1").trim().toLowerCase();
        if (mLine !== targetLine) return false;
        const status = (m.status || "").trim().toLowerCase();
        return status !== "disabled";
      })
      .sort((a, b) => {
        const orderA = typeof a.sortOrder === "number" ? a.sortOrder : 9999;
        const orderB = typeof b.sortOrder === "number" ? b.sortOrder : 9999;
        if (orderA !== orderB) return orderA - orderB;
        return (a.name || "").localeCompare(b.name || "");
      });
  }, [masterData.machines, selectedLine]);

  const activeShiftWorkingMinutes = useMemo(() => {
    const shiftCode = selectedShift.startsWith("Shift")
      ? selectedShift.split(" ")[0] + " " + selectedShift.split(" ")[1]
      : selectedShift;
    const matchedShift = masterData.shifts?.find(
      (s) =>
        s.displayName === selectedShift ||
        s.shiftCode === selectedShift ||
        s.shiftCode === shiftCode
    );
    return matchedShift?.shiftWorkingMinutes ?? 1305;
  }, [masterData.shifts, selectedShift]);

  const [currentShiftRows, setCurrentShiftRows] = useState<MachineShiftRow[]>(() => {
    const targetLine = (initialLine || "Line 1").trim().toLowerCase();
    const initialLineMachines = (initialMasterData.machines || [])
      .filter((m) => {
        const mLine = (m.line || "Line 1").trim().toLowerCase();
        if (mLine !== targetLine) return false;
        const status = (m.status || "").trim().toLowerCase();
        return status !== "disabled";
      })
      .sort((a, b) => {
        const orderA = typeof a.sortOrder === "number" ? a.sortOrder : 9999;
        const orderB = typeof b.sortOrder === "number" ? b.sortOrder : 9999;
        if (orderA !== orderB) return orderA - orderB;
        return (a.name || "").localeCompare(b.name || "");
      });

    const shiftCode = initialShift.startsWith("Shift")
      ? initialShift.split(" ")[0] + " " + initialShift.split(" ")[1]
      : initialShift;
    const matchedShift = initialMasterData.shifts?.find(
      (s) =>
        s.displayName === initialShift ||
        s.shiftCode === initialShift ||
        s.shiftCode === shiftCode
    );
    const shiftMins = matchedShift?.shiftWorkingMinutes ?? 1305;

    return ensureAllLineMachinesInRows(
      initialRows,
      initialLineMachines,
      initialDate,
      initialShift,
      initialLine,
      shiftMins
    );
  });

  const displayRows = useMemo(() => {
    return ensureAllLineMachinesInRows(
      currentShiftRows,
      currentLineMachines,
      selectedDate,
      selectedShift,
      selectedLine,
      activeShiftWorkingMinutes
    );
  }, [
    currentShiftRows,
    currentLineMachines,
    selectedDate,
    selectedShift,
    selectedLine,
    activeShiftWorkingMinutes,
  ]);

  const [hasUnsavedDraft, setHasUnsavedDraft] = useState<boolean>(false);
  const [isPending] = useTransition();

  const { runWithFeedback } = useFeedback();

  const draftKey = getDraftKey(selectedDate, selectedShift, selectedLine);
  const prevFilterRef = useRef<{
    date: string;
    shift: ShiftType;
    line: string;
  }>({
    date: selectedDate,
    shift: selectedShift,
    line: selectedLine,
  });

  // On mount, restore unsaved local draft if one exists for the initial selection (runs strictly on client after hydration)
  useEffect(() => {
    if (isShiftLocked) return;
    try {
      const initialDraftKey = getDraftKey(initialDate, initialShift, initialLine);
      const rawDraft = localStorage.getItem(initialDraftKey);
      if (rawDraft) {
        const parsed = JSON.parse(rawDraft);
        if (
          parsed.date === initialDate &&
          parsed.shift === initialShift &&
          parsed.line === initialLine &&
          Array.isArray(parsed.rows) &&
          parsed.rows.length > 0
        ) {
          const validMachineIds = new Set(masterData.machines.map((m) => m.id));
          const validRows = parsed.rows.filter(
            (r: MachineShiftRow) =>
              validMachineIds.has(r.machineId) ||
              (Boolean(r.isTempMachine) === true && String(r.machineId || "").startsWith("temp_"))
          );

          if (validRows.length > 0) {
            const reconciled = ensureAllLineMachinesInRows(
              validRows,
              currentLineMachines,
              selectedDate,
              selectedShift,
              selectedLine,
              activeShiftWorkingMinutes
            );
            setCurrentShiftRows(reconciled);
            setHasUnsavedDraft(true);
          }
        }
      }
    } catch {
      // ignore
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const writeDraftTimerRef = useRef<NodeJS.Timeout | null>(null);

  const writeDraft = (rows: MachineShiftRow[]) => {
    if (writeDraftTimerRef.current) {
      clearTimeout(writeDraftTimerRef.current);
    }
    writeDraftTimerRef.current = setTimeout(() => {
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
    }, 300);
  };

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (writeDraftTimerRef.current) {
        clearTimeout(writeDraftTimerRef.current);
      }
    };
  }, []);

  // Restore matching local draft, otherwise fetch fresh rows from Supabase, ONLY when filters (date, shift, line) change
  useEffect(() => {
    // Strictly verify if date, shift, or line genuinely changed
    const filterChanged =
      selectedDate !== prevFilterRef.current.date ||
      selectedShift !== prevFilterRef.current.shift ||
      selectedLine !== prevFilterRef.current.line;

    if (!filterChanged) {
      return;
    }

    prevFilterRef.current = {
      date: selectedDate,
      shift: selectedShift,
      line: selectedLine,
    };

    let isMounted = true;

    // Immediately replace currentShiftRows with clean default rows for the new selection
    // so stale rows from the previous shift/date/line are NEVER retained or merged
    const cleanDefaultRows = ensureAllLineMachinesInRows(
      [],
      currentLineMachines,
      selectedDate,
      selectedShift,
      selectedLine,
      activeShiftWorkingMinutes
    );
    setCurrentShiftRows(cleanDefaultRows);
    setHasUnsavedDraft(false);

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
            const validMachineIds = new Set(masterData.machines.map((m) => m.id));
            const validRows = parsed.rows.filter(
              (r: MachineShiftRow) =>
                validMachineIds.has(r.machineId) ||
                (Boolean(r.isTempMachine) === true && String(r.machineId || "").startsWith("temp_"))
            );

            if (validRows.length > 0) {
              const reconciled = ensureAllLineMachinesInRows(
                validRows,
                currentLineMachines,
                selectedDate,
                selectedShift,
                selectedLine,
                activeShiftWorkingMinutes
              );
              setCurrentShiftRows(reconciled);
              setHasUnsavedDraft(true);
              return;
            } else {
              localStorage.removeItem(draftKey);
            }
          }
        }
      } catch {
        // Ignore malformed localStorage data
      }
    }

    runWithFeedback(
      async () => {
        const freshRows = await getShiftSheetRows(
          selectedDate,
          selectedShift,
          selectedLine
        );
        if (isMounted) {
          const reconciled = ensureAllLineMachinesInRows(
            freshRows,
            currentLineMachines,
            selectedDate,
            selectedShift,
            selectedLine,
            activeShiftWorkingMinutes
          );
          setCurrentShiftRows(reconciled);
          setHasUnsavedDraft(false);
        }
        return freshRows;
      },
      {
        loadingMessage: `Loading ${selectedLine} (${selectedShift})...`,
        errorTitle: "Failed to load shift sheet",
      }
    );

    return () => {
      isMounted = false;
    };
  }, [
    selectedDate,
    selectedShift,
    selectedLine,
    isShiftLocked,
    draftKey,
    masterData.machines,
    currentLineMachines,
    activeShiftWorkingMinutes,
    runWithFeedback,
  ]);

  const handleRowsChange = (updatedRows: MachineShiftRow[]) => {
    if (isShiftLocked) return;
    setCurrentShiftRows(updatedRows);
    setHasUnsavedDraft(true);
    writeDraft(updatedRows);
  };

  const handleDiscardDraft = async () => {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }
    setHasUnsavedDraft(false);

    await runWithFeedback(
      async () => {
        const freshRows = await getShiftSheetRows(
          selectedDate,
          selectedShift,
          selectedLine
        );
        const reconciled = ensureAllLineMachinesInRows(
          freshRows,
          currentLineMachines,
          selectedDate,
          selectedShift,
          selectedLine,
          activeShiftWorkingMinutes
        );
        setCurrentShiftRows(reconciled);
        return reconciled;
      },
      {
        loadingMessage: "Reloading from server...",
        successTitle: "Draft Discarded",
        successDetail: "Restored last saved server data",
        errorTitle: "Could not reload shift rows",
      }
    );
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

    const touchedMachineIds = new Set<string>();
    rowsToSave.forEach((row) => {
      const isTouched =
        !!row.itemId ||
        !!row.operatorName ||
        (row.actualOutput || 0) > 0 ||
        calculateTotalBreakdown(row.breakdown) > 0 ||
        (row.cycleTime || 0) > 0;
      if (isTouched) {
        touchedMachineIds.add(row.machineId);
      }
    });

    const unbalancedMachineIds: string[] = [];
    const machineBalances = new Map<string, ReturnType<typeof calculateMachineGroupTimeBalance>>();

    touchedMachineIds.forEach((mId) => {
      const balance = calculateMachineGroupTimeBalance(rowsToSave, mId, shiftWorkingMinutes);
      machineBalances.set(mId, balance);
      if (!balance.isBalanced) {
        unbalancedMachineIds.push(mId);
      }
    });

    if (unbalancedMachineIds.length > 0) {
      const firstBadId = unbalancedMachineIds[0];
      const bal = machineBalances.get(firstBadId)!;
      const firstBadRow = rowsToSave.find((r) => r.machineId === firstBadId)!;
      let details = '';
      if (bal.missingCycleTime) {
        details =
          `• ERROR: Actual output was entered on ${firstBadRow.machineName}, but Cycle Time is 0!\n` +
          `• Productive time cannot be verified. Please select an Item with a cycle time or enter cycle time.`;
      } else if (bal.isProductionExceeded) {
        details =
          `• ERROR: Total productive time across all runs on ${firstBadRow.machineName} (${bal.productionMinutes} mins) exceeds shift duration (${bal.shiftMinutes} mins)!\n` +
          `• Productive time alone is greater than shift timing. Please reduce Actual Output or verify cycle time.`;
      } else if (bal.isOver) {
        details =
          `• ERROR: Total productive time (${bal.productionMinutes}m) + breakdown (${bal.loggedBreakdownMinutes}m) = ${bal.totalAccountedMinutes} mins, which exceeds shift duration (${bal.shiftMinutes} mins) by ${Math.abs(bal.unaccountedMinutes)} mins!\n` +
          `• Total productive time + total breakdown time across all runs on ${firstBadRow.machineName} must NOT exceed shift duration—it must be exactly equal.`;
      } else {
        details =
          `• Total Productive Time: ${bal.productionMinutes} mins\n` +
          `• Required Breakdown / Downtime: ${bal.requiredBreakdownMinutes} mins\n` +
          `• Currently Logged Breakdown: ${bal.loggedBreakdownMinutes} mins\n\n` +
          `• Please fill the remaining ${bal.unaccountedMinutes} mins in Breakdown columns so total time for ${firstBadRow.machineName} equals ${bal.shiftMinutes} mins.`;
      }

      alert(
        `Shift Time Mismatch on ${firstBadRow.machineName} (Row #${firstBadRow.srNo}):\n\n` +
          `• Shift Duration (from DB): ${bal.shiftMinutes} mins\n` +
          details
      );
      return;
    }

    const sanitizedRows = rowsToSave.map((r) => ({
      ...r,
      shift: selectedShift || r.shift,
      date: selectedDate || r.date,
      line: selectedLine || r.line,
    }));

    await runWithFeedback(
      async () => {
        const result = await saveShiftSheetRows(sanitizedRows);
        if (result?.success && result?.rows) {
          const reconciled = ensureAllLineMachinesInRows(
            result.rows,
            currentLineMachines,
            selectedDate,
            selectedShift,
            selectedLine,
            activeShiftWorkingMinutes
          );
          setCurrentShiftRows(reconciled);
          setHasUnsavedDraft(false);
          try {
            localStorage.removeItem(draftKey);
          } catch {
            /* ignore */
          }
          return result;
        }
        throw new Error("Save operation failed on server.");
      },
      {
        loadingMessage: "Saving shift log...",
        successTitle: "Shift Log Saved",
        successDetail: `${selectedLine} • ${selectedShift} synced to database`,
        errorTitle: "Could Not Save Shift Log",
      }
    );
  };

  const handleSaveSingleKioskRow = async (singleRow: MachineShiftRow) => {
    if (isShiftLocked) {
      alert("Shift is locked — changes cannot be saved.");
      return;
    }

    const rowToSave: MachineShiftRow = {
      ...singleRow,
      shift: selectedShift || singleRow.shift,
      date: selectedDate || singleRow.date,
      line: selectedLine || singleRow.line,
    };

    await runWithFeedback(
      async () => {
        const result = await updateSingleMachineLog(rowToSave);
        if (result?.success && result?.row) {
          const exists = displayRows.some(
            (r) => r.machineId === result.row.machineId && (r.runNo || 1) === (result.row.runNo || 1)
          );
          const updatedRows = exists
            ? displayRows.map((r) =>
                r.machineId === result.row.machineId && (r.runNo || 1) === (result.row.runNo || 1)
                  ? result.row
                  : r
              )
            : [...displayRows, result.row];
          const reconciled = ensureAllLineMachinesInRows(
            updatedRows,
            currentLineMachines,
            selectedDate,
            selectedShift,
            selectedLine,
            activeShiftWorkingMinutes
          );
          setCurrentShiftRows(reconciled);
          if (hasUnsavedDraft) writeDraft(reconciled);
          return result;
        }
        throw new Error("Failed to save kiosk machine log.");
      },
      {
        loadingMessage: "Saving machine entry...",
        successTitle: "Machine Entry Saved",
        successDetail: `${singleRow.machineName} updated successfully`,
        errorTitle: "Could Not Save Machine Entry",
      }
    );
  };

  const handleSaveMachineRuns = async (machineRuns: MachineShiftRow[]) => {
    if (isShiftLocked) {
      alert("Shift is locked — changes cannot be saved.");
      return;
    }
    if (!machineRuns || machineRuns.length === 0) return;

    const sanitizedRuns = machineRuns.map((r) => ({
      ...r,
      shift: selectedShift || r.shift,
      date: selectedDate || r.date,
      line: selectedLine || r.line,
    }));

    await runWithFeedback(
      async () => {
        const result = await saveMachineRuns(sanitizedRuns);
        if (result?.success && result?.rows) {
          const targetMachineId = sanitizedRuns[0].machineId;
          const firstTargetIdx = displayRows.findIndex(
            (r) => r.machineId === targetMachineId
          );
          const currentCount = displayRows.filter(
            (r) => r.machineId === targetMachineId
          ).length;

          const newRows = [...displayRows];
          if (firstTargetIdx >= 0) {
            newRows.splice(firstTargetIdx, currentCount, ...result.rows);
          } else {
            newRows.push(...result.rows);
          }

          const reconciled = ensureAllLineMachinesInRows(
            newRows,
            currentLineMachines,
            selectedDate,
            selectedShift,
            selectedLine,
            activeShiftWorkingMinutes
          );
          setCurrentShiftRows(reconciled);
          if (hasUnsavedDraft) writeDraft(reconciled);
          return result;
        }
        throw new Error("Failed to save machine runs.");
      },
      {
        loadingMessage: "Saving machine runs...",
        successTitle: "Machine Runs Saved",
        successDetail: `${sanitizedRuns[0]?.machineName || "Machine"} runs synced to database`,
        errorTitle: "Could Not Save Machine Runs",
      }
    );
  };

  const handleRefreshMasterData = async () => {
    await runWithFeedback(
      async () => {
        const freshMaster = await getMasterData();
        setMasterData(freshMaster);
        // Non-destructively merge masterData.machines into currentShiftRows (preserving all user inputs and unsaved edits)
        const targetLine = (selectedLine || "Line 1").trim().toLowerCase();
        const updatedLineMachines = (freshMaster.machines || [])
          .filter((m) => {
            const mLine = (m.line || "Line 1").trim().toLowerCase();
            if (mLine !== targetLine) return false;
            const status = (m.status || "").trim().toLowerCase();
            return status !== "disabled";
          })
          .sort((a, b) => {
            const orderA = typeof a.sortOrder === "number" ? a.sortOrder : 9999;
            const orderB = typeof b.sortOrder === "number" ? b.sortOrder : 9999;
            if (orderA !== orderB) return orderA - orderB;
            return (a.name || "").localeCompare(b.name || "");
          });
        setCurrentShiftRows((prevRows) =>
          ensureAllLineMachinesInRows(
            prevRows,
            updatedLineMachines,
            selectedDate,
            selectedShift,
            selectedLine,
            activeShiftWorkingMinutes
          )
        );
        return freshMaster;
      },
      {
        loadingMessage: "Syncing master data...",
        errorTitle: "Could not sync master data",
      }
    );
  };

  const handleExportExcel = () => {
    exportShiftToExcel(
      displayRows,
      `${selectedDate}_${selectedLine}`,
      selectedShift,
      selectedLine,
      undefined,
      masterData
    );
  };

  const handleResetDemo = async () => {
    if (isShiftLocked) {
      alert(shiftLock.reason || "Shift is locked. Data cannot be reset.");
      return;
    }
    if (!window.confirm("Reload shift rows fresh from database and clear local draft?")) return;
    try {
      localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }
    await runWithFeedback(
      async () => {
        const freshRows = await getShiftSheetRows(
          selectedDate,
          selectedShift,
          selectedLine
        );
        const reconciled = ensureAllLineMachinesInRows(
          freshRows,
          currentLineMachines,
          selectedDate,
          selectedShift,
          selectedLine,
          activeShiftWorkingMinutes
        );
        setCurrentShiftRows(reconciled);
        setHasUnsavedDraft(false);
        return reconciled;
      },
      {
        loadingMessage: "Reloading from database...",
        successTitle: "Shift Reloaded",
        successDetail: "Loaded fresh machines from database",
        errorTitle: "Failed to reload",
      }
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 overflow-x-clip">
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
        onSaveShiftLog={() => handleSaveShiftSheet(displayRows)}
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
            key={`${selectedDate}_${selectedShift}_${selectedLine}`}
            rows={displayRows}
            masterData={masterData}
            onRowsChange={handleRowsChange}
            onSave={handleSaveShiftSheet}
            onSaveShift={handleSaveShiftSheet}
            isSaving={isPending}
            currentDate={selectedDate}
            selectedDate={selectedDate}
            currentShift={selectedShift}
            selectedShift={selectedShift}
            currentLine={selectedLine}
            selectedLine={selectedLine}
            hasUnsavedDraft={hasUnsavedDraft}
            onDiscardDraft={handleDiscardDraft}
            onExportExcel={handleExportExcel}
            onOpenMachineInKiosk={(machineId?: string) => {
              if (machineId) setKioskMachineId(machineId);
              setActiveTab("kiosk");
            }}
            onRefreshMasterData={handleRefreshMasterData}
            isAdmin={isAdmin}
            isReadOnly={isShiftLocked}
            isShiftLocked={isShiftLocked}
            shiftLock={shiftLock}
          />
        )}

        {activeTab === "kiosk" && (
          <OperatorKiosk
            key={`${selectedDate}_${selectedShift}_${selectedLine}`}
            rows={displayRows}
            masterData={masterData}
            selectedDate={selectedDate}
            selectedShift={selectedShift}
            selectedLine={selectedLine}
            selectedMachineId={kioskMachineId}
            onSelectMachineId={setKioskMachineId}
            onSaveMachine={handleSaveSingleKioskRow}
            onSaveMachineRuns={handleSaveMachineRuns}
            onRefreshMasterData={handleRefreshMasterData}
            onRowsChange={handleRowsChange}
            isSaving={isPending}
            isAdmin={isAdmin}
            isReadOnly={isShiftLocked}
            isShiftLocked={isShiftLocked}
            shiftLock={shiftLock}
          />
        )}

        {activeTab === "analytics" && (
          <AnalyticsPreview
            rows={displayRows}
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
            isAdmin={isAdmin}
            isReadOnly={isShiftLocked}
          />
        )}
      </main>
    </div>
  );
}
