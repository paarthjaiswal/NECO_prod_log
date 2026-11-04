import { MachineShiftRow } from "@/app/types";

/**
 * Triggers a server-generated .xlsx download for the active shift
 * so the 1 GB RAM Windows 7 browser never loads the SheetJS library.
 */
export function exportShiftToExcel(
  rows: MachineShiftRow[],
  dateArg?: string,
  shiftArg?: string,
  lineArg?: string
): void {
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

  // Hands off file generation to the Phase 5 Next.js API route
  window.location.href = `/api/export?${params.toString()}`;
}

/**
 * Triggers a server-generated .csv download of historical logs directly from Supabase
 * without holding allLogs[] in browser RAM.
 */
export function exportHistoricalToCSV(
  _rows?: MachineShiftRow[],
  dateFrom?: string,
  dateTo?: string
): void {
  const params = new URLSearchParams({ format: "csv" });
  if (dateFrom) params.set("from", dateFrom);
  if (dateTo) params.set("to", dateTo);

  window.location.href = `/api/export?${params.toString()}`;
}