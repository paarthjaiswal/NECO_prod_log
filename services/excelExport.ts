import * as XLSX from "xlsx";
import { MachineShiftRow } from "@/types";

/**
 * Formats a MachineShiftRow to match the vw_powerbi_shift_logs schema:
 * includes cycle time, total working minutes, breakdown category minutes & percentages.
 */
export function formatRowForExport(row: MachineShiftRow): Record<string, string | number> {
  const totalWorking = Number(row.totalWorkingMinutes) || 1350;
  const noDisc = Number(row.breakdown?.noDisc) || 0;
  const change = Number(row.breakdown?.change) || 0;
  const power = Number(row.breakdown?.power) || 0;
  const operator = Number(row.breakdown?.operator) || 0;
  const totalBd = noDisc + change + power + operator;

  const eff =
    row.stdOutput > 0
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
  const totalBdPct =
    row.breakdownPct?.totalBdPct ??
    Number(((totalBd / totalWorking) * 100).toFixed(2));

  return {
    "Date": row.date,
    "Shift": row.shift,
    "Line": row.line || "Line 1",
    "Sr No": row.srNo,
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
    "Total BD Mins": totalBd,
    "NO/DISC %": noDiscPct,
    "CHANGE %": changePct,
    "POWER %": powerPct,
    "OPERATOR %": operatorPct,
    "Total BD %": totalBdPct,
    "Remarks": row.remarks || "",
  };
}

/**
 * Exports shift rows to an .xlsx file matching vw_powerbi_shift_logs
 */
export function exportShiftToExcel(
  rows: MachineShiftRow[],
  dateArg?: string,
  shiftArg?: string,
  lineArg?: string
): void {
  if (rows && rows.length > 0) {
    try {
      const formatted = rows.map(formatRowForExport);
      const ws = XLSX.utils.json_to_sheet(formatted);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Shift_Production");

      const sampleRow = rows[0];
      const date = dateArg || sampleRow?.date || new Date().toISOString().split("T")[0];
      const line = lineArg || sampleRow?.line || "Line 1";
      const cleanLine = line.replace(/\s+/g, "_");
      const filename = `shift_log_${date}_${cleanLine}.xlsx`;

      XLSX.writeFile(wb, filename);
      return;
    } catch (err) {
      console.warn("Client XLSX export failed, falling back to API route:", err);
    }
  }

  const sampleRow = rows?.[0];
  const date = dateArg || sampleRow?.date || new Date().toISOString().split("T")[0];
  const shift = shiftArg || sampleRow?.shift || "Shift A (6AM-2PM)";
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
  dateTo?: string
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
      link.href = url;
      link.download = `neco_production_logs_${today}.csv`;
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
