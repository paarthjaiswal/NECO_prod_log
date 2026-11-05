import DashboardClient from "@/components/DashboardClient";
import { getMasterData, getShiftSheetRows } from "@/actions/shiftActions";
import {
  getTodayDateString,
  SHIFTS,
  PRODUCTION_LINES,
  INITIAL_MACHINES,
  INITIAL_OPERATORS,
  INITIAL_ITEMS,
  generateDefaultShiftRows,
} from "@/data/initialData";
import { MasterDataState, MachineShiftRow, ShiftType } from "@/types";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const initialDate =
    typeof getTodayDateString === "function"
      ? getTodayDateString()
      : new Date().toISOString().split("T")[0];
  const initialShift: ShiftType =
    (SHIFTS?.[0] as ShiftType) ?? "Shift A (6AM-2PM)";
  const initialLine: string = PRODUCTION_LINES?.[0] ?? "Line 1";

  let initialMasterData: MasterDataState = {
    machines: INITIAL_MACHINES ?? [],
    operators: INITIAL_OPERATORS ?? [],
    items: INITIAL_ITEMS ?? [],
  };

  let initialRows: MachineShiftRow[] = [];

  try {
    const [fetchedMaster, fetchedRows] = await Promise.all([
      getMasterData(),
      getShiftSheetRows(initialDate, initialShift, initialLine),
    ]);

    if (fetchedMaster?.machines?.length > 0) {
      initialMasterData = fetchedMaster;
      initialRows = fetchedRows;
    } else {
      // Database connected, but 0 machines found — generate fallback rows
      initialRows = generateDefaultShiftRows(
        initialDate,
        initialShift,
        initialLine
      );
    }
  } catch (error) {
    console.error(
      "Supabase unreachable on initial load, falling back to initialData:",
      error
    );
    initialRows = generateDefaultShiftRows(
      initialDate,
      initialShift,
      initialLine
    );
  }

  return (
    <DashboardClient
      initialMasterData={initialMasterData}
      initialRows={initialRows}
      initialDate={initialDate}
      initialShift={initialShift}
      initialLine={initialLine}
    />
  );
}