import * as XLSX from "xlsx";
import { MachineShiftRow, MasterDataState, ItemProductionRollup } from "@/types";
import { calculateTotalBreakdown } from "@/services/storageService";
import { INITIAL_MACHINES, PRODUCTION_LINES } from "@/data/initialData";

/**
 * Formats a MachineShiftRow to match the vw_powerbi_shift_logs schema:
 * includes cycle time, total working minutes, breakdown category minutes & percentages.
 */
export function formatRowForExport(row: MachineShiftRow): Record<string, string | number> {
  const totalWorking = Number(row.totalWorkingMinutes) || 1305;
  const noDisc = Number((Number(row.breakdown?.noDisc) || 0).toFixed(2));
  const change = Number((Number(row.breakdown?.change) || 0).toFixed(2));
  const power = Number((Number(row.breakdown?.power) || 0).toFixed(2));
  const operator = Number((Number(row.breakdown?.operator) || 0).toFixed(2));
  const machineBreakdown = Number((Number(row.breakdown?.machineBreakdown) || 0).toFixed(2));
  const fixProgSettings = Number((Number(row.breakdown?.fixProgSettings) || 0).toFixed(2));
  const miscellaneous = Number((Number(row.breakdown?.miscellaneous) || 0).toFixed(2));
  const totalBd = Number(
    (noDisc + change + power + operator + machineBreakdown + fixProgSettings + miscellaneous).toFixed(2)
  );

  const eff =
    Number(row.stdOutput) > 0
      ? Math.round(((Number(row.actualOutput) || 0) / Number(row.stdOutput)) * 100)
      : 0;

  const noDiscPct =
    row.breakdownPct?.noDiscPct ??
    Number(((noDisc / totalWorking) * 100).toFixed(2));
  const changePct =
    row.breakdownPct?.changePct ??
    Number(((change / totalWorking) * 100).toFixed(2));
  const powerPct =
    row.breakdownPct?.powerPct ??
    Number(((power / totalWorking) * 100).toFixed(2));
  const operatorPct =
    row.breakdownPct?.operatorPct ??
    Number(((operator / totalWorking) * 100).toFixed(2));
  const machineBdPct =
    row.breakdownPct?.machineBreakdownPct ??
    Number(((machineBreakdown / totalWorking) * 100).toFixed(2));
  const fixProgPct =
    row.breakdownPct?.fixProgSettingsPct ??
    Number(((fixProgSettings / totalWorking) * 100).toFixed(2));
  const miscPct =
    row.breakdownPct?.miscellaneousPct ??
    Number(((miscellaneous / totalWorking) * 100).toFixed(2));
  const totalBdPct =
    row.breakdownPct?.totalBdPct ??
    Number(((totalBd / totalWorking) * 100).toFixed(2));

  return {
    "Date": row.date,
    "Shift": row.shift,
    "Line": row.line || "Line 1",
    "Sr No": row.srNo,
    "Run No": row.runNo || 1,
    "Is Temp Machine": Boolean(row.isTempMachine || row.machineId?.startsWith("temp_")) ? "Yes" : "No",
    "Machine ID": row.machineId,
    "Machine Name": row.machineName,
    "Operator Name": row.operatorName || "",
    "Item ID": row.itemId || "",
    "Item Name": row.itemName || "",
    "Operation": row.operation || "",
    "Cycle Time": Number(row.cycleTime) || 0,
    "Total Working Mins": totalWorking,
    "Std Output": Number(row.stdOutput) || 0,
    "Actual Output": Number(row.actualOutput) || 0,
    "Rework": Number(row.rework) || 0,
    "Efficiency %": eff,
    "NO/DISC (mins)": noDisc,
    "CHANGE (mins)": change,
    "POWER (mins)": power,
    "OPERATOR (mins)": operator,
    "BREAK DOWN (mins)": machineBreakdown,
    "FIX/PROG (mins)": fixProgSettings,
    "MISCELLANEOUS (mins)": miscellaneous,
    "Total BD Mins": totalBd,
    "NO/DISC %": noDiscPct,
    "CHANGE %": changePct,
    "POWER %": powerPct,
    "OPERATOR %": operatorPct,
    "BREAK DOWN %": machineBdPct,
    "FIX/PROG %": fixProgPct,
    "MISCELLANEOUS %": miscPct,
    "Total BD %": totalBdPct,
    "Remarks": row.remarks || "",
  };
}

/**
 * Builds Sheet 1: Line & Shift-Wise Efficiency Matrix
 * Strictly enforces Partial-Line Rule: only active rows (stdOutput > 0) are factored into efficiency.
 */
function buildLineEfficiencyData(
  rows: MachineShiftRow[],
  masterData?: MasterDataState
): Record<string, string | number>[] {
  const lineNames =
    masterData?.lines && masterData.lines.length > 0
      ? masterData.lines.filter((l) => l.isActive !== false).map((l) => l.name)
      : PRODUCTION_LINES;

  const allMachines = masterData?.machines && masterData.machines.length > 0
    ? masterData.machines
    : INITIAL_MACHINES;

  const result: Record<string, string | number>[] = [];

  let grandTotalMachines = 0;
  const grandActiveMachinesSet = new Set<string>();
  let grandStd = 0;
  let grandAct = 0;
  let grandShiftAStd = 0;
  let grandShiftAAct = 0;
  let grandShiftBStd = 0;
  let grandShiftBAct = 0;
  let grandShiftCStd = 0;
  let grandShiftCAct = 0;
  let grandBd = 0;

  for (const lineName of lineNames) {
    const lineMachines = allMachines.filter((m) => (m.line || "Line 1") === lineName);
    const totalLineMachines = lineMachines.length;
    grandTotalMachines += totalLineMachines;

    const lineRows = rows.filter((r) => (r.line || "Line 1") === lineName);
    const activeRows = lineRows.filter((r) => Number(r.stdOutput) > 0);

    const activeMachineIds = new Set(activeRows.map((r) => r.machineId || r.machineName));
    activeRows.forEach((r) => grandActiveMachinesSet.add(r.machineId || r.machineName));

    const lineStd = activeRows.reduce((acc, r) => acc + (Number(r.stdOutput) || 0), 0);
    const lineAct = activeRows.reduce((acc, r) => acc + (Number(r.actualOutput) || 0), 0);
    const lineVariance = lineAct - lineStd;
    const lineEff = lineStd > 0 ? Math.round((lineAct / lineStd) * 100) : 0;

    // Shift breakdowns
    const filterShiftRows = (prefix: string) =>
      activeRows.filter((r) => (r.shift || "").toLowerCase().includes(prefix.toLowerCase()));

    const shiftARows = filterShiftRows("shift a");
    const shiftBRows = filterShiftRows("shift b");
    const shiftCRows = filterShiftRows("shift c");

    const shiftAStd = shiftARows.reduce((acc, r) => acc + (Number(r.stdOutput) || 0), 0);
    const shiftAAct = shiftARows.reduce((acc, r) => acc + (Number(r.actualOutput) || 0), 0);
    const shiftAEff = shiftAStd > 0 ? Math.round((shiftAAct / shiftAStd) * 100) : 0;

    const shiftBStd = shiftBRows.reduce((acc, r) => acc + (Number(r.stdOutput) || 0), 0);
    const shiftBAct = shiftBRows.reduce((acc, r) => acc + (Number(r.actualOutput) || 0), 0);
    const shiftBEff = shiftBStd > 0 ? Math.round((shiftBAct / shiftBStd) * 100) : 0;

    const shiftCStd = shiftCRows.reduce((acc, r) => acc + (Number(r.stdOutput) || 0), 0);
    const shiftCAct = shiftCRows.reduce((acc, r) => acc + (Number(r.actualOutput) || 0), 0);
    const shiftCEff = shiftCStd > 0 ? Math.round((shiftCAct / shiftCStd) * 100) : 0;

    // Calculate spread among shifts that ran
    const activeEffs: number[] = [];
    if (shiftAStd > 0) activeEffs.push(shiftAEff);
    if (shiftBStd > 0) activeEffs.push(shiftBEff);
    if (shiftCStd > 0) activeEffs.push(shiftCEff);
    const spread =
      activeEffs.length >= 2 ? Math.max(...activeEffs) - Math.min(...activeEffs) : 0;

    const totalBd = Number(lineRows.reduce((acc, r) => acc + calculateTotalBreakdown(r.breakdown), 0).toFixed(2));

    grandStd += lineStd;
    grandAct += lineAct;
    grandShiftAStd += shiftAStd;
    grandShiftAAct += shiftAAct;
    grandShiftBStd += shiftBStd;
    grandShiftBAct += shiftBAct;
    grandShiftCStd += shiftCStd;
    grandShiftCAct += shiftCAct;
    grandBd += totalBd;

    result.push({
      "Line Name": lineName,
      "Operating Machines": `${activeMachineIds.size} / ${totalLineMachines} active (${totalLineMachines > 0 ? Math.round((activeMachineIds.size / totalLineMachines) * 100) : 0}%)`,
      "Target (Std Pcs)": lineStd,
      "Actual Output (Pcs)": lineAct,
      "Variance (Pcs)": lineVariance,
      "Line Efficiency %": `${lineEff}%`,
      "Shift A Target": shiftAStd,
      "Shift A Actual": shiftAAct,
      "Shift A Eff %": shiftAStd > 0 ? `${shiftAEff}%` : "—",
      "Shift B Target": shiftBStd,
      "Shift B Actual": shiftBAct,
      "Shift B Eff %": shiftBStd > 0 ? `${shiftBEff}%` : "—",
      "Shift C Target": shiftCStd,
      "Shift C Actual": shiftCAct,
      "Shift C Eff %": shiftCStd > 0 ? `${shiftCEff}%` : "—",
      "Shift Spread %": activeEffs.length >= 2 ? `${spread}%` : "—",
      "Total Downtime (mins)": totalBd,
    });
  }

  // Overall Plant Row
  const grandEff = grandStd > 0 ? Math.round((grandAct / grandStd) * 100) : 0;
  const grandShiftAEff = grandShiftAStd > 0 ? Math.round((grandShiftAAct / grandShiftAStd) * 100) : 0;
  const grandShiftBEff = grandShiftBStd > 0 ? Math.round((grandShiftBAct / grandShiftBStd) * 100) : 0;
  const grandShiftCEff = grandShiftCStd > 0 ? Math.round((grandShiftCAct / grandShiftCStd) * 100) : 0;

  const plantEffs: number[] = [];
  if (grandShiftAStd > 0) plantEffs.push(grandShiftAEff);
  if (grandShiftBStd > 0) plantEffs.push(grandShiftBEff);
  if (grandShiftCStd > 0) plantEffs.push(grandShiftCEff);
  const grandSpread =
    plantEffs.length >= 2 ? Math.max(...plantEffs) - Math.min(...plantEffs) : 0;

  result.push({
    "Line Name": "TOTAL PLANT (ALL LINES)",
    "Operating Machines": `${grandActiveMachinesSet.size} / ${grandTotalMachines} active (${grandTotalMachines > 0 ? Math.round((grandActiveMachinesSet.size / grandTotalMachines) * 100) : 0}%)`,
    "Target (Std Pcs)": grandStd,
    "Actual Output (Pcs)": grandAct,
    "Variance (Pcs)": grandAct - grandStd,
    "Line Efficiency %": `${grandEff}%`,
    "Shift A Target": grandShiftAStd,
    "Shift A Actual": grandShiftAAct,
    "Shift A Eff %": grandShiftAStd > 0 ? `${grandShiftAEff}%` : "—",
    "Shift B Target": grandShiftBStd,
    "Shift B Actual": grandShiftBAct,
    "Shift B Eff %": grandShiftBStd > 0 ? `${grandShiftBEff}%` : "—",
    "Shift C Target": grandShiftCStd,
    "Shift C Actual": grandShiftCAct,
    "Shift C Eff %": grandShiftCStd > 0 ? `${grandShiftCEff}%` : "—",
    "Shift Spread %": plantEffs.length >= 2 ? `${grandSpread}%` : "—",
    "Total Downtime (mins)": grandBd,
  });

  return result;
}

/**
 * Builds Sheet 2: Machine & Shift-Wise Efficiency Matrix
 */
function buildMachineEfficiencyData(
  rows: MachineShiftRow[],
  masterData?: MasterDataState
): Record<string, string | number>[] {
  const allMachines = masterData?.machines && masterData.machines.length > 0
    ? masterData.machines
    : INITIAL_MACHINES;

  const baseMachineIds = new Set(allMachines.map((m) => m.id));
  const tempMachinesMap = new Map<
    string,
    { id: string; name: string; code: string; line: string; isTemp: boolean }
  >();

  for (const r of rows) {
    const isTemp = Boolean(
      r.isTempMachine ||
      r.machineId?.startsWith("temp_") ||
      !baseMachineIds.has(r.machineId)
    );
    if (isTemp && r.machineId && !tempMachinesMap.has(r.machineId)) {
      tempMachinesMap.set(r.machineId, {
        id: r.machineId,
        name: `${r.machineName || "Temp Machine"} (Temp)`,
        code: r.machineCode || "TEMP",
        line: r.line || "Line 1",
        isTemp: true,
      });
    }
  }

  const combinedMachines = [
    ...allMachines.map((m) => ({ ...m, isTemp: false })),
    ...Array.from(tempMachinesMap.values()),
  ];

  return combinedMachines.map((m) => {
    const machLogs = rows.filter(
      (r) => r.machineId === m.id || (!m.isTemp && r.machineName === m.name)
    );
    const activeLogs = machLogs.filter((r) => Number(r.stdOutput) > 0);

    const std = activeLogs.reduce((acc, r) => acc + (Number(r.stdOutput) || 0), 0);
    const act = activeLogs.reduce((acc, r) => acc + (Number(r.actualOutput) || 0), 0);
    const rework = machLogs.reduce((acc, r) => acc + (Number(r.rework) || 0), 0);
    const downtime = Number(machLogs.reduce((acc, r) => acc + calculateTotalBreakdown(r.breakdown), 0).toFixed(2));
    const eff = std > 0 ? Math.round((act / std) * 100) : 0;

    const filterShift = (prefix: string) =>
      activeLogs.filter((r) => (r.shift || "").toLowerCase().includes(prefix.toLowerCase()));

    const shiftA = filterShift("shift a");
    const shiftB = filterShift("shift b");
    const shiftC = filterShift("shift c");

    const aStd = shiftA.reduce((acc, r) => acc + (Number(r.stdOutput) || 0), 0);
    const aAct = shiftA.reduce((acc, r) => acc + (Number(r.actualOutput) || 0), 0);
    const aEff = aStd > 0 ? `${Math.round((aAct / aStd) * 100)}%` : "—";

    const bStd = shiftB.reduce((acc, r) => acc + (Number(r.stdOutput) || 0), 0);
    const bAct = shiftB.reduce((acc, r) => acc + (Number(r.actualOutput) || 0), 0);
    const bEff = bStd > 0 ? `${Math.round((bAct / bStd) * 100)}%` : "—";

    const cStd = shiftC.reduce((acc, r) => acc + (Number(r.stdOutput) || 0), 0);
    const cAct = shiftC.reduce((acc, r) => acc + (Number(r.actualOutput) || 0), 0);
    const cEff = cStd > 0 ? `${Math.round((cAct / cStd) * 100)}%` : "—";

    const activeShifts: { name: string; eff: number }[] = [];
    if (aStd > 0) activeShifts.push({ name: "Shift A", eff: Math.round((aAct / aStd) * 100) });
    if (bStd > 0) activeShifts.push({ name: "Shift B", eff: Math.round((bAct / bStd) * 100) });
    if (cStd > 0) activeShifts.push({ name: "Shift C", eff: Math.round((cAct / cStd) * 100) });

    const shiftsOperatedText = `${activeShifts.length} / 3 shifts`;

    let bestWorstText = "—";
    let shiftSpreadText = "—";
    if (activeShifts.length >= 2) {
      activeShifts.sort((x, y) => y.eff - x.eff);
      const best = activeShifts[0];
      const worst = activeShifts[activeShifts.length - 1];
      const diff = best.eff - worst.eff;
      shiftSpreadText = `${diff}%`;
      bestWorstText = `Best: ${best.name} (${best.eff}%) / Worst: ${worst.name} (${worst.eff}%) [Δ ${diff}%]`;
    } else if (activeShifts.length === 1) {
      bestWorstText = `${activeShifts[0].name} only (${activeShifts[0].eff}%)`;
    }

    return {
      "Machine Name": m.name,
      "Code": m.code || "",
      "Line": m.line || "Line 1",
      "Status": activeLogs.length > 0 ? "Active" : "Idle / Unassigned",
      "Shifts Operated": shiftsOperatedText,
      "Scheduled Target (Std)": std,
      "Actual Output (Pcs)": act,
      "Variance": act - std,
      "Machine Efficiency %": std > 0 ? `${eff}%` : "—",
      "Shift A Output": aAct,
      "Shift A Eff %": aEff,
      "Shift B Output": bAct,
      "Shift B Eff %": bEff,
      "Shift C Output": cAct,
      "Shift C Eff %": cEff,
      "Best / Worst Shift": bestWorstText,
      "Shift Spread %": shiftSpreadText,
      "Downtime (mins)": downtime,
      "Rework (pcs)": rework,
    };
  });
}

/**
 * Builds Sheet 3: Item Production Totals (Period, Today, MTD, All-Time Till Now)
 */
function buildItemProductionData(
  rows: MachineShiftRow[],
  itemRollups?: ItemProductionRollup[],
  masterData?: MasterDataState
): Record<string, string | number>[] {
  // Canonical item index for consistent resolution across masterData, rollups, and shift logs
  const itemLookup = new Map<string, { id?: string; itemCode: string; itemName: string }>();
  for (const it of (masterData?.items || [])) {
    const info = { id: it.id, itemCode: it.itemCode || "", itemName: it.itemName || "" };
    if (it.id) itemLookup.set(it.id.trim().toLowerCase(), info);
    if (it.itemCode) itemLookup.set(it.itemCode.trim().toLowerCase(), info);
    if (it.itemName) itemLookup.set(it.itemName.trim().toLowerCase(), info);
  }

  const resolve = (rawId?: string, rawCode?: string, rawName?: string) => {
    const id = (rawId || "").trim();
    const code = (rawCode || "").trim();
    const name = (rawName || "").trim();
    const matched =
      (id ? itemLookup.get(id.toLowerCase()) : null) ||
      (code ? itemLookup.get(code.toLowerCase()) : null) ||
      (name ? itemLookup.get(name.toLowerCase()) : null);

    const itemCode = matched?.itemCode || code || (id && !id.startsWith("item_") && !id.startsWith("it_") ? id : "—");
    const itemName = matched?.itemName || name || (itemCode !== "—" ? itemCode : "Unknown Part");
    const itemId = matched?.id || id || "";
    const canonicalKey = (itemCode !== "—" ? itemCode : itemId || itemName).toLowerCase();
    return { canonicalKey, itemId, itemCode, itemName };
  };

  const map = new Map<
    string,
    {
      itemId: string;
      itemCode: string;
      itemName: string;
      periodAct: number;
      periodStd: number;
      periodRework: number;
      todayQty: number;
      mtdQty: number;
      tillNowQty: number;
      tillNowStd: number;
      tillNowRework: number;
    }
  >();

  // 1. Seed from itemRollups if available
  if (itemRollups && itemRollups.length > 0) {
    for (const roll of itemRollups) {
      const resolved = resolve(roll.itemId, roll.itemCode, roll.itemName);
      if (!map.has(resolved.canonicalKey)) {
        map.set(resolved.canonicalKey, {
          itemId: resolved.itemId,
          itemCode: resolved.itemCode || "—",
          itemName: resolved.itemName,
          periodAct: 0,
          periodStd: 0,
          periodRework: 0,
          todayQty: 0,
          mtdQty: 0,
          tillNowQty: 0,
          tillNowStd: 0,
          tillNowRework: 0,
        });
      }
      const entry = map.get(resolved.canonicalKey)!;
      entry.todayQty += Number(roll.todayOutput) || 0;
      entry.mtdQty += Number(roll.mtdOutput) || 0;
      entry.tillNowQty += Number(roll.tillNowOutput) || 0;
      entry.tillNowStd += Number(roll.tillNowStd) || 0;
      entry.tillNowRework += Number(roll.tillNowRework) || 0;
    }
  }

  // 2. Accumulate period quantities from current rows
  for (const r of rows) {
    if (!r.itemId && !r.itemName) continue;
    const resolved = resolve(r.itemId, undefined, r.itemName);
    if (!map.has(resolved.canonicalKey)) {
      map.set(resolved.canonicalKey, {
        itemId: resolved.itemId,
        itemCode: resolved.itemCode || "—",
        itemName: resolved.itemName || "Unknown Part",
        periodAct: 0,
        periodStd: 0,
        periodRework: 0,
        todayQty: 0,
        mtdQty: 0,
        tillNowQty: 0,
        tillNowStd: 0,
        tillNowRework: 0,
      });
    }

    const entry = map.get(resolved.canonicalKey)!;
    if (entry.itemCode === "—" && resolved.itemCode !== "—") {
      entry.itemCode = resolved.itemCode;
    }
    if ((!entry.itemName || entry.itemName === "Unknown Part") && resolved.itemName) {
      entry.itemName = resolved.itemName;
    }
    entry.periodAct += Number(r.actualOutput) || 0;
    entry.periodStd += Number(r.stdOutput) || 0;
    entry.periodRework += Number(r.rework) || 0;
  }

  return Array.from(map.values())
    .sort((a, b) => b.periodAct - a.periodAct || b.tillNowQty - a.tillNowQty)
    .map((it) => ({
      "Part Code": it.itemCode,
      "Item Name": it.itemName,
      "Selected Period Qty": it.periodAct,
      "Today Qty": it.todayQty,
      "Month-to-Date (MTD) Qty": it.mtdQty,
      "Total Till Now Qty": it.tillNowQty,
      "Till Now Target (Std)": it.tillNowStd,
      "Till Now Rework (pcs)": it.tillNowRework,
      "Period Efficiency %":
        it.periodStd > 0 ? `${Math.round((it.periodAct / it.periodStd) * 100)}%` : "—",
    }));
}

/**
 * Exports shift rows to a comprehensive multi-sheet .xlsx workbook:
 * Sheet 1: Line & Shift Efficiency
 * Sheet 2: Machine & Shift Efficiency
 * Sheet 3: Item Production Summary
 * Sheet 4: Shift Logs Detail
 */
export function exportShiftToExcel(
  rows: MachineShiftRow[],
  dateArg?: string,
  shiftArg?: string,
  lineArg?: string,
  customFilename?: string,
  masterData?: MasterDataState,
  itemRollups?: ItemProductionRollup[]
): void {
  if (rows && rows.length > 0) {
    try {
      const wb = XLSX.utils.book_new();

      // Sheet 1: Line & Shift Efficiency
      const lineEffData = buildLineEfficiencyData(rows, masterData);
      const ws1 = XLSX.utils.json_to_sheet(lineEffData);
      XLSX.utils.book_append_sheet(wb, ws1, "Line & Shift Efficiency");

      // Sheet 2: Machine & Shift Efficiency
      const machEffData = buildMachineEfficiencyData(rows, masterData);
      const ws2 = XLSX.utils.json_to_sheet(machEffData);
      XLSX.utils.book_append_sheet(wb, ws2, "Machine Efficiency");

      // Sheet 3: Item Production Summary
      const itemProdData = buildItemProductionData(rows, itemRollups, masterData);
      if (itemProdData.length > 0) {
        const ws3 = XLSX.utils.json_to_sheet(itemProdData);
        XLSX.utils.book_append_sheet(wb, ws3, "Item Production Summary");
      }

      // Sheet 4: Shift Logs Detail (raw line-level logs)
      const formattedDetail = rows.map(formatRowForExport);
      const ws4 = XLSX.utils.json_to_sheet(formattedDetail);
      XLSX.utils.book_append_sheet(wb, ws4, "Shift Logs Detail");

      const sampleRow = rows[0];
      const date = dateArg || sampleRow?.date || new Date().toISOString().split("T")[0];
      const line = lineArg || sampleRow?.line || "All_Lines";
      const cleanLine = line.replace(/\s+/g, "_");
      const filename = customFilename || `neco_production_report_${date}_${cleanLine}.xlsx`;

      XLSX.writeFile(wb, filename);
      return;
    } catch (err) {
      console.warn("Client XLSX export failed, falling back to API route:", err);
    }
  }

  const sampleRow = rows?.[0];
  const date = dateArg || sampleRow?.date || new Date().toISOString().split("T")[0];
  const shift = shiftArg || sampleRow?.shift || "Shift A (7AM-3:30PM)";
  const line = lineArg || sampleRow?.line || "Line 1";

  const params = new URLSearchParams({
    format: "xlsx",
    date,
    shift,
    line,
  });

  window.location.href = `/api/export?${params.toString()}`;
}

/**
 * Exports historical or filtered logs to CSV matching vw_powerbi_shift_logs
 */
export function exportHistoricalToCSV(
  rows?: MachineShiftRow[],
  dateFrom?: string,
  dateTo?: string,
  customFilename?: string
): void {
  if (rows && rows.length > 0) {
    try {
      const formatted = rows.map(formatRowForExport);
      const headers = Object.keys(formatted[0]);
      const csvRows = [
        headers.join(","),
        ...formatted.map((row) =>
          headers
            .map((h) => {
              const val = row[h] ?? "";
              const escaped = String(val).replace(/"/g, '""');
              return `"${escaped}"`;
            })
            .join(",")
        ),
      ];
      const csvContent = csvRows.join("\r\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const today = new Date().toISOString().split("T")[0];
      const defaultFilename =
        dateFrom && dateTo
          ? `neco_production_logs_${dateFrom}_to_${dateTo}.csv`
          : `neco_production_logs_${today}.csv`;
      link.href = url;
      link.download = customFilename || defaultFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      return;
    } catch (err) {
      console.warn("Client CSV export failed, falling back to API route:", err);
    }
  }

  const params = new URLSearchParams({ format: "csv" });
  if (dateFrom) params.set("from", dateFrom);
  if (dateTo) params.set("to", dateTo);

  window.location.href = `/api/export?${params.toString()}`;
}
