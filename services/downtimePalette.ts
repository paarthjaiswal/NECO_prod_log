/**
 * Canonical Downtime & Breakdown Color Palette
 *
 * Single source of truth for all 7 downtime categories + Total Downtime
 * across DailyShiftSheet, OperatorKiosk, AnalyticsPreview, MachineAnalyticsView,
 * ShiftSheetReadOnlyContent, and Excel exports (xlsx-js-style).
 *
 * All Tailwind classes are written as static literal strings for Tailwind JIT safety.
 */

export type BreakdownKey =
  | "noDisc"
  | "change"
  | "power"
  | "operator"
  | "machineBreakdown"
  | "fixProgSettings"
  | "miscellaneous";

export const BD_KEYS: BreakdownKey[] = [
  "noDisc",
  "change",
  "power",
  "operator",
  "machineBreakdown",
  "fixProgSettings",
  "miscellaneous",
];

export interface DowntimeCategoryTheme {
  key: BreakdownKey;
  shortLabel: string;
  fullLabel: string;
  sublabel: string;
  barBgClass: string;
  dotBgClass: string;
  chipClass: string;
  pillClass: string;
  cardBorderClass: string;
  cellBackdropClass: string;
  activeCellClass: string;
  readonlyCellClass: string;
  darkHeaderTextClass: string;
  darkFooterTextClass: string;
  excelHeaderHex: string;
  excelCellBgHex: string;
  excelCellTextHex: string;
}

export const DOWNTIME_PALETTE: Record<BreakdownKey, DowntimeCategoryTheme> = {
  noDisc: {
    key: "noDisc",
    shortLabel: "NO/DISC",
    fullLabel: "NO/DISC (Material)",
    sublabel: "Material/Disc shortage",
    barBgClass: "bg-slate-500",
    dotBgClass: "bg-slate-500",
    chipClass: "bg-slate-100 text-slate-900 border-slate-300",
    pillClass: "bg-slate-200 text-slate-950 border-slate-400",
    cardBorderClass: "border-slate-300/90 hover:border-slate-500",
    cellBackdropClass: "bg-slate-100/80",
    activeCellClass: "bg-slate-200 text-slate-950 font-bold border-slate-400",
    readonlyCellClass: "bg-slate-200/85 text-slate-950 font-bold",
    darkHeaderTextClass: "text-slate-200",
    darkFooterTextClass: "text-slate-200",
    excelHeaderHex: "475569",
    excelCellBgHex: "E2E8F0",
    excelCellTextHex: "0F172A",
  },
  change: {
    key: "change",
    shortLabel: "CHANGE",
    fullLabel: "CHANGE (Tool/Setup)",
    sublabel: "Tool insert/Job setup",
    barBgClass: "bg-sky-500",
    dotBgClass: "bg-sky-500",
    chipClass: "bg-sky-100/80 text-sky-900 border-sky-300",
    pillClass: "bg-sky-100 text-sky-950 border-sky-400",
    cardBorderClass: "border-sky-300/80 hover:border-sky-500",
    cellBackdropClass: "bg-sky-100/70",
    activeCellClass: "bg-sky-200/85 text-sky-950 font-bold border-sky-400",
    readonlyCellClass: "bg-sky-200/75 text-sky-950 font-bold",
    darkHeaderTextClass: "text-sky-300",
    darkFooterTextClass: "text-sky-300",
    excelHeaderHex: "0369A1",
    excelCellBgHex: "BAE6FD",
    excelCellTextHex: "0C4A6E",
  },
  power: {
    key: "power",
    shortLabel: "POWER",
    fullLabel: "POWER (Electrical)",
    sublabel: "Power outage/Trip",
    barBgClass: "bg-amber-500",
    dotBgClass: "bg-amber-500",
    chipClass: "bg-amber-100/80 text-amber-900 border-amber-300",
    pillClass: "bg-amber-100 text-amber-950 border-amber-400",
    cardBorderClass: "border-amber-300/80 hover:border-amber-500",
    cellBackdropClass: "bg-amber-100/70",
    activeCellClass: "bg-amber-200/85 text-amber-950 font-bold border-amber-500",
    readonlyCellClass: "bg-amber-200/80 text-amber-950 font-bold",
    darkHeaderTextClass: "text-amber-300",
    darkFooterTextClass: "text-amber-300",
    excelHeaderHex: "B45309",
    excelCellBgHex: "FDE68A",
    excelCellTextHex: "78350F",
  },
  operator: {
    key: "operator",
    shortLabel: "OPERATOR",
    fullLabel: "OPERATOR (Delay)",
    sublabel: "Unattended/Delay",
    barBgClass: "bg-purple-500",
    dotBgClass: "bg-purple-500",
    chipClass: "bg-purple-100/80 text-purple-900 border-purple-300",
    pillClass: "bg-purple-100 text-purple-950 border-purple-400",
    cardBorderClass: "border-purple-300/80 hover:border-purple-500",
    cellBackdropClass: "bg-purple-100/70",
    activeCellClass: "bg-purple-200/85 text-purple-950 font-bold border-purple-400",
    readonlyCellClass: "bg-purple-200/75 text-purple-950 font-bold",
    darkHeaderTextClass: "text-purple-300",
    darkFooterTextClass: "text-purple-300",
    excelHeaderHex: "7E22CE",
    excelCellBgHex: "E9D5FF",
    excelCellTextHex: "581C87",
  },
  machineBreakdown: {
    key: "machineBreakdown",
    shortLabel: "BREAK DOWN",
    fullLabel: "BREAK DOWN (Machine)",
    sublabel: "Machine/Mech fault",
    barBgClass: "bg-orange-500",
    dotBgClass: "bg-orange-500",
    chipClass: "bg-orange-100/80 text-orange-900 border-orange-300",
    pillClass: "bg-orange-100 text-orange-950 border-orange-400",
    cardBorderClass: "border-orange-300/80 hover:border-orange-500",
    cellBackdropClass: "bg-orange-100/70",
    activeCellClass: "bg-orange-200/85 text-orange-950 font-bold border-orange-400",
    readonlyCellClass: "bg-orange-200/75 text-orange-950 font-bold",
    darkHeaderTextClass: "text-orange-300",
    darkFooterTextClass: "text-orange-300",
    excelHeaderHex: "C2410C",
    excelCellBgHex: "FED7AA",
    excelCellTextHex: "7C2D12",
  },
  fixProgSettings: {
    key: "fixProgSettings",
    shortLabel: "FIX/PROG",
    fullLabel: "FIX/PROG Settings",
    sublabel: "Fixture/Program setting",
    barBgClass: "bg-indigo-500",
    dotBgClass: "bg-indigo-500",
    chipClass: "bg-indigo-100/80 text-indigo-900 border-indigo-300",
    pillClass: "bg-indigo-100 text-indigo-950 border-indigo-400",
    cardBorderClass: "border-indigo-300/80 hover:border-indigo-500",
    cellBackdropClass: "bg-indigo-100/70",
    activeCellClass: "bg-indigo-200/85 text-indigo-950 font-bold border-indigo-400",
    readonlyCellClass: "bg-indigo-200/75 text-indigo-950 font-bold",
    darkHeaderTextClass: "text-indigo-300",
    darkFooterTextClass: "text-indigo-300",
    excelHeaderHex: "4338CA",
    excelCellBgHex: "C7D2FE",
    excelCellTextHex: "312E81",
  },
  miscellaneous: {
    key: "miscellaneous",
    shortLabel: "MISC.",
    fullLabel: "MISCELLANEOUS",
    sublabel: "Other/Misc downtime",
    barBgClass: "bg-teal-500",
    dotBgClass: "bg-teal-500",
    chipClass: "bg-teal-100/80 text-teal-900 border-teal-300",
    pillClass: "bg-teal-100 text-teal-950 border-teal-400",
    cardBorderClass: "border-teal-300/80 hover:border-teal-500",
    cellBackdropClass: "bg-teal-100/70",
    activeCellClass: "bg-teal-200/85 text-teal-950 font-bold border-teal-400",
    readonlyCellClass: "bg-teal-200/75 text-teal-950 font-bold",
    darkHeaderTextClass: "text-teal-300",
    darkFooterTextClass: "text-teal-300",
    excelHeaderHex: "0F766E",
    excelCellBgHex: "99F6E4",
    excelCellTextHex: "134E4A",
  },
};

export const TOTAL_DOWNTIME_THEME = {
  label: "Total Downtime",
  shortLabel: "TOTAL BD",
  dotBgClass: "bg-red-600",
  textClass: "text-red-700",
  textDarkClass: "text-red-300",
  badgeClass: "bg-red-100 text-red-950 border-red-400 font-bold",
  cellClass: "bg-red-200/80 text-red-950 font-extrabold",
  subtotalCellClass: "bg-red-200 text-red-950 font-extrabold",
  kpiBgClass: "bg-red-100/80 border-red-300",
  excelHeaderHex: "B91C1C",
  excelCellBgHex: "FECACA",
  excelCellTextHex: "7F1D1D",
} as const;

export function getDowntimeCategoryByHeader(header: string): DowntimeCategoryTheme | null {
  const raw = (header || "").trim();
  const norm = raw.toLowerCase();

  if (norm.includes("no/disc") || norm.includes("no disc")) return DOWNTIME_PALETTE.noDisc;
  if (norm.includes("change")) return DOWNTIME_PALETTE.change;
  if (norm.includes("power")) return DOWNTIME_PALETTE.power;
  if (
    raw === "OPERATOR" ||
    raw.includes("OPERATOR (mins)") ||
    raw.includes("OPERATOR %") ||
    norm === "operator delay"
  ) {
    return DOWNTIME_PALETTE.operator;
  }
  if (norm.includes("break down") || norm.includes("machine breakdown")) {
    return DOWNTIME_PALETTE.machineBreakdown;
  }
  if (norm.includes("fix/prog") || norm.includes("fix / prog")) {
    return DOWNTIME_PALETTE.fixProgSettings;
  }
  if (norm.includes("misc")) return DOWNTIME_PALETTE.miscellaneous;

  return null;
}
