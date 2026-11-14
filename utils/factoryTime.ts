import { ShiftMaster, ShiftType } from "@/types";

export interface FactoryTimeContext {
  serverNowIst: string;
  activeDate: string; // YYYY-MM-DD
  autoSelectedShift: ShiftType;
}

/**
 * Fallback IST shift & production date resolver (used only if Supabase RPC fails).
 * Mirrors the exact PostgreSQL get_factory_time_context() rules:
 * - 00:00 to 00:30 IST -> Yesterday + Shift B (30-min post-shift grace period)
 * - 00:31 to 07:30 IST -> Today + Shift C (active 00:00-07:00, grace 07:00-07:30)
 * - 07:31 to 16:00 IST -> Today + Shift A (active 07:00-15:30, grace 15:30-16:00)
 * - 16:01 to 23:59 IST -> Today + Shift B (active 15:30-00:00)
 */
export function getFallbackFactoryTimeContext(
  shifts?: ShiftMaster[],
  referenceDate: Date = new Date()
): FactoryTimeContext {
  // Format components strictly in Asia/Kolkata
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(referenceDate);

  const getPart = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";

  const year = Number(getPart("year"));
  const month = Number(getPart("month"));
  const day = Number(getPart("day"));
  const hour = Number(getPart("hour")) % 24;
  const minute = Number(getPart("minute"));
  const second = Number(getPart("second"));

  const todayStr = `${String(year).padStart(4, "0")}-${String(month).padStart(
    2,
    "0"
  )}-${String(day).padStart(2, "0")}`;

  // Compute yesterday's YYYY-MM-DD safely in UTC calendar arithmetic
  const yesterdayObj = new Date(Date.UTC(year, month - 1, day - 1));
  const yesterdayStr = yesterdayObj.toISOString().split("T")[0];

  const totalMinutesFromMidnight = hour * 60 + minute;

  const resolveShiftDisplayName = (code: string, fallback: ShiftType): ShiftType => {
    const match = shifts?.find(
      (s) => s.shiftCode === code || s.displayName.startsWith(code)
    );
    return (match?.displayName as ShiftType) ?? fallback;
  };

  let activeDate = todayStr;
  let autoSelectedShift: ShiftType;

  if (totalMinutesFromMidnight <= 30) {
    // 00:00 to 00:30 IST -> Shift B grace window (belongs to yesterday's log_date)
    activeDate = yesterdayStr;
    autoSelectedShift = resolveShiftDisplayName("Shift B", "Shift B (3:30PM-12AM)");
  } else if (totalMinutesFromMidnight <= 7 * 60 + 30) {
    // 00:31 to 07:30 IST -> Shift C (active 00:00-07:00 + grace 07:00-07:30)
    activeDate = todayStr;
    autoSelectedShift = resolveShiftDisplayName("Shift C", "Shift C (12AM-7AM)");
  } else if (totalMinutesFromMidnight <= 16 * 60) {
    // 07:31 to 16:00 IST -> Shift A (active 07:00-15:30 + grace 15:30-16:00)
    activeDate = todayStr;
    autoSelectedShift = resolveShiftDisplayName("Shift A", "Shift A (7AM-3:30PM)");
  } else {
    // 16:01 to 23:59 IST -> Shift B (active 15:30-00:00)
    activeDate = todayStr;
    autoSelectedShift = resolveShiftDisplayName("Shift B", "Shift B (3:30PM-12AM)");
  }

  const serverNowIst = `${todayStr}T${String(hour).padStart(2, "0")}:${String(
    minute
  ).padStart(2, "0")}:${String(second).padStart(2, "0")}`;

  return {
    serverNowIst,
    activeDate,
    autoSelectedShift,
  };
}
