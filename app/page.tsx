import DashboardClient from "@/components/DashboardClient";
import {
  getMasterData,
  getShiftSheetRows,
  getShiftItemProduction,
  getFactoryTimeContext,
} from "@/actions/shiftActions";
import { getIsUnitHead } from "@/actions/authActions";
import { getFallbackFactoryTimeContext } from "@/utils/factoryTime";
import { PRODUCTION_LINES } from "@/data/initialData";
import { MasterDataState, MachineShiftRow, ShiftType, ShiftItemProductionRow } from "@/types";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const initialLine: string = PRODUCTION_LINES?.[0] ?? "Line 1";

  let initialMasterData: MasterDataState = {
    machines: [],
    operators: [],
    items: [],
  };

  let initialRows: MachineShiftRow[] = [];
  let initialShiftItemTotals: ShiftItemProductionRow[] = [];
  let initialDate = "";
  let initialShift: ShiftType = "Shift A (7AM-3:30PM)";
  let isAdmin = false;
  let serverNowIst = "";

  try {
    const [timeContext, isHead, fetchedMaster] = await Promise.all([
      getFactoryTimeContext(),
      getIsUnitHead(),
      getMasterData(),
    ]);

    isAdmin = isHead;
    initialDate = timeContext.activeDate;
    initialShift = timeContext.autoSelectedShift;
    serverNowIst = timeContext.serverNowIst;

    if (fetchedMaster) {
      initialMasterData = fetchedMaster;
    }

    const [freshRows, freshItemProd] = await Promise.all([
      getShiftSheetRows(initialDate, initialShift, initialLine),
      getShiftItemProduction(initialDate, initialShift, initialLine),
    ]);
    initialRows = freshRows;
    initialShiftItemTotals = freshItemProd;
  } catch (error) {
    console.error(
      "Supabase unreachable or error on initial load:",
      error
    );
    if (!initialDate || !serverNowIst) {
      // Safe fallback if timeContext failed completely
      const fallbackCtx = getFallbackFactoryTimeContext();
      if (!initialDate) initialDate = fallbackCtx.activeDate;
      if (!serverNowIst) serverNowIst = fallbackCtx.serverNowIst;
      initialShift = fallbackCtx.autoSelectedShift;
    }
    initialRows = [];
    initialShiftItemTotals = [];
  }

  return (
    <DashboardClient
      initialMasterData={initialMasterData}
      initialRows={initialRows}
      initialShiftItemTotals={initialShiftItemTotals}
      initialDate={initialDate}
      initialShift={initialShift}
      initialLine={initialLine}
      isAdmin={isAdmin}
      serverNowIst={serverNowIst}
    />
  );
}
