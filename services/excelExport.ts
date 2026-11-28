import * as XLSX from "xlsx-js-style";
import { MachineShiftRow, MasterDataState, ItemProductionRollup, ShiftItemProductionRow } from "@/types";
import { calculateTotalBreakdown } from "@/services/storageService";
import { INITIAL_MACHINES, PRODUCTION_LINES } from "@/data/initialData";
import {
  computeAllocatedPlannedMinutes,
  calculateOeeMetrics,
  buildProductLineMachineMatrix,
  groupByLine,
  groupByShift,
  groupByPeriod,
  groupByMachine,
  buildGroupedMachineMatrix,
  resolveProductQcMetrics,
  EnrichedAnalyticsRow,
  OeeMetrics,
  ProductMatrixItem,
  MachineDetailAnalytics,
  MachineGroupByMode,
  MachineMatrixGroup,
} from "@/services/analyticsEngine";
import {
  getDowntimeCategoryByHeader,
  TOTAL_DOWNTIME_THEME,
} from "@/services/downtimePalette";
import {
  extractCombinedSplitTotals,
  isMergedSplitGroup,
} from "@/lib/splitAllocation";

// ============================================================================
// STYLING PALETTE & CONSTANTS (Lightweight Executive Design)
// ============================================================================

export const EXCEL_PALETTE = {
  // Brand & Slate Colors
  navySlate: "1E293B",     // #1E293B Title banner & Identity headers
  darkSlate: "0F172A",     // #0F172A Value text & table border
  mutedSlate: "475569",    // #475569 Key label text, Remarks header
  borderSlate: "64748B",   // #64748B Metadata outer border
  gridBorder: "CBD5E1",    // #CBD5E1 Table grid cell borders
  dividerBorder: "E2E8F0", // #E2E8F0 Section banner & totals footer fill
  softBg: "F8FAFC",        // #F8FAFC Metadata box & odd zebra row
  white: "FFFFFF",         // #FFFFFF Plain white
  kpiBorder: "94A3B8",     // #94A3B8 KPI box border

  // Semantic Header Groups
  royalBlue: "1D4ED8",     // #1D4ED8 Production / Output headers
  deepRose: "BE123C",      // #BE123C Rework header
  warmAmber: "B45309",     // #B45309 Breakdown category headers
  darkAmber: "92400E",     // #92400E Total BD header
  deepEmerald: "047857",   // #047857 OEE & Quality headers

  // Data Cell Semantic Tints & Text
  blueTint: "EFF6FF",      // #EFF6FF Actual / Good output cell tint
  roseTint: "FFF1F2",      // #FFF1F2 Rework cell tint (>0)
  roseText: "9F1239",      // #9F1239 Rework text (>0)
  amberTint: "FFFBEB",     // #FFFBEB Breakdown cell tint (>0)
  amberDarkText: "92400E", // #92400E Breakdown text (>0)
  totalBdTint: "FEF3C7",   // #FEF3C7 Total BD cell tint (>0)
  indigoTint: "EEF2FF",    // #EEF2FF Temp machine badge tint
  indigoText: "3730A3",    // #3730A3 Temp machine badge text

  // OEE Traffic-Light Tints
  oeeGreenBg: "DCFCE7",    // #DCFCE7 OEE >= 85%
  oeeGreenText: "166534",  // #166534
  oeeYellowBg: "FEF3C7",   // #FEF3C7 OEE 65-84.99%
  oeeYellowText: "92400E", // #92400E
  oeeRedBg: "FFE4E6",      // #FFE4E6 OEE < 65%
  oeeRedText: "9F1239",    // #9F1239
};

const round2 = (val: number) => Number((Number(val) || 0).toFixed(2));

// Border helpers for xlsx-js-style
const thinBorder = (rgb: string = EXCEL_PALETTE.gridBorder) => ({
  style: "thin",
  color: { rgb },
});
const mediumBorder = (rgb: string = EXCEL_PALETTE.navySlate) => ({
  style: "medium",
  color: { rgb },
});
const thickBorder = (rgb: string = EXCEL_PALETTE.navySlate) => ({
  style: "thick",
  color: { rgb },
});

// ============================================================================
// STYLING RULE ENGINE (Header Classification, Alignment & Formatting)
// ============================================================================

/**
 * Classifies a header name into its semantic column group color:
 * - Identity / Context (#1E293B; #475569 for Remarks)
 * - Production / Output (#1D4ED8)
 * - Rework (#BE123C)
 * - Breakdown / Downtime (#B45309; #92400E for Total BD)
 * - OEE & Quality KPIs (#047857)
 */
export function getHeaderFill(header: string): string {
  const norm = (header || "").trim().toLowerCase();

  // 1. OEE & Quality KPIs (#047857)
  if (
    norm.includes("oee") ||
    norm.includes("avail") ||
    norm.includes("qual") ||
    norm.includes("finished") ||
    norm.includes("pre-qc") ||
    norm.includes("preqc") ||
    norm.includes("total prod") ||
    norm.includes("qc passed") ||
    norm === "availability %" ||
    norm === "quality %" ||
    norm === "oee %" ||
    norm === "day oee"
  ) {
    return EXCEL_PALETTE.deepEmerald;
  }

  // 2. Rework (#BE123C)
  if (norm.includes("rework")) {
    return EXCEL_PALETTE.deepRose;
  }

  // 3. Breakdown / Downtime (Unified Canonical Palette)
  // Total BD / Total Downtime gets Crimson (#B91C1C)
  if (
    norm.includes("total bd") ||
    norm.includes("total downtime") ||
    norm === "bd %" ||
    norm === "downtime (m)" ||
    norm === "downtime (mins)" ||
    norm === "downtime" ||
    norm === "bd mins"
  ) {
    return TOTAL_DOWNTIME_THEME.excelHeaderHex;
  }
  // Individual BD categories get their exact canonical category hex color
  const dtCategory = getDowntimeCategoryByHeader(header);
  if (dtCategory) {
    return dtCategory.excelHeaderHex;
  }
  if (norm.startsWith("bd_")) {
    return EXCEL_PALETTE.warmAmber;
  }

  // 4. Production / Output (#1D4ED8)
  if (
    norm.includes("cycle time") ||
    norm.includes("avg ct") ||
    norm.includes("output") ||
    norm.includes("std") ||
    norm.includes("target") ||
    norm.includes("plan %") ||
    norm.includes("planned mins") ||
    norm.includes("operating mins") ||
    norm.includes("planned shift time") ||
    norm.includes("operating time") ||
    norm.includes("ideal run") ||
    norm === "ot (m)" ||
    norm.includes("overtime") ||
    norm.includes("eff %") ||
    norm.includes("efficiency") ||
    norm.includes("variance") ||
    norm.includes("spread") ||
    norm.includes("qty") ||
    norm.includes("combined") ||
    norm.includes("op combined") ||
    norm.includes("machine ops")
  ) {
    return EXCEL_PALETTE.royalBlue;
  }

  // 5. Remarks (#475569)
  if (norm.includes("remark") || norm.includes("note")) {
    return EXCEL_PALETTE.mutedSlate;
  }

  // 6. Identity / Context (#1E293B)
  return EXCEL_PALETTE.navySlate;
}

/**
 * Determines text alignment based on column semantics.
 */
export function getColumnAlignment(header: string): "left" | "center" | "right" {
  const norm = (header || "").trim().toLowerCase();

  // Short badges & identifiers -> center
  if (
    norm === "date" ||
    norm === "shift" ||
    norm === "temp?" ||
    norm === "is temp machine" ||
    norm === "run #" ||
    norm === "run no" ||
    norm === "sr no" ||
    norm === "split runs" ||
    norm === "split run?" ||
    norm === "split runs count" ||
    norm === "status" ||
    norm === "type" ||
    norm === "machine type" ||
    norm === "code" ||
    norm === "machine code" ||
    norm === "product code" ||
    norm === "part code" ||
    norm === "item code" ||
    norm === "item id" ||
    norm === "machine id" ||
    norm === "category code" ||
    norm === "shifts" ||
    norm === "active lines" ||
    norm === "machines count" ||
    norm === "runs count" ||
    norm === "shifts count" ||
    norm === "shifts operated"
  ) {
    return "center";
  }

  // Text descriptions -> left
  if (
    norm.includes("name") ||
    norm.includes("line") ||
    norm.includes("item") ||
    norm.includes("product") ||
    norm.includes("operation") ||
    norm.includes("operator") ||
    norm.includes("remark") ||
    norm.includes("note") ||
    norm.includes("category name") ||
    norm.includes("standard") ||
    norm.includes("formula") ||
    norm.includes("metric") ||
    norm === "best / worst shift"
  ) {
    return "left";
  }

  // All numeric, targets, outputs, and % -> right
  return "right";
}

/**
 * Returns explicit Excel number format string for clean display.
 */
export function getNumberFormat(header: string, sampleValue: unknown): string | undefined {
  const norm = (header || "").trim().toLowerCase();

  // Integer counts whose header contains "pre-qc" / "100%" / "machine ops"
  if (
    norm.includes("qc passed") ||
    norm.includes("total prod") ||
    norm.includes("pre-qc") ||
    norm.includes("preqc") ||
    norm.includes("machine ops actual") ||
    norm.includes("machine ops std")
  ) {
    if (typeof sampleValue === "number") {
      return "#,##0";
    }
    return undefined;
  }

  // Percentages: use '0.00"%"' so values like 87.5 display as 87.50% directly
  if (
    norm.includes("%") ||
    norm.includes("eff") ||
    norm.includes("avail") ||
    norm.includes("qual") ||
    norm.includes("oee") ||
    norm.includes("plan %")
  ) {
    if (typeof sampleValue === "number") {
      return '0.00"%"';
    }
    return undefined;
  }

  // Decimal minutes / rates: #,##0.00
  if (
    norm.includes("min") ||
    norm.includes("time") ||
    norm.includes("ct") ||
    norm.includes("no/disc") ||
    norm.includes("change") ||
    norm.includes("power") ||
    norm.includes("break down") ||
    norm.includes("fix/prog") ||
    norm.includes("misc") ||
    norm.includes("bd") ||
    norm.includes("downtime")
  ) {
    if (typeof sampleValue === "number") {
      return "#,##0.00";
    }
    return undefined;
  }

  // Quantities / Integer counts: #,##0
  if (
    norm.includes("output") ||
    norm.includes("std") ||
    norm.includes("target") ||
    norm.includes("rework") ||
    norm.includes("qty") ||
    norm.includes("count") ||
    norm.includes("runs") ||
    norm.includes("allocations") ||
    norm === "sr no" ||
    norm === "run no" ||
    norm === "run #" ||
    norm === "ot (m)" ||
    norm.includes("overtime")
  ) {
    if (typeof sampleValue === "number") {
      return "#,##0";
    }
    return undefined;
  }

  if (typeof sampleValue === "number") {
    return Number.isInteger(sampleValue) ? "#,##0" : "#,##0.00";
  }

  return undefined;
}

/**
 * Applies zebra striping and subtle semantic highlights to data cells:
 * - Actual / Good Output: soft blue tint #EFF6FF + bold on Actual
 * - Rework > 0: soft rose tint #FFF1F2 + bold #9F1239 text
 * - Breakdown > 0: soft warm tint #FFFBEB + #92400E text
 * - Total BD > 0: subtle #FEF3C7 tint + bold text
 * - OEE %: traffic-light conditional fill (>=85 green, 65-85 yellow, <65 red)
 * - Temp? badge: soft indigo #EEF2FF + bold #3730A3 text
 */
export function getDataCellStyle(
  header: string,
  rawVal: unknown,
  rowIndex: number,
  align: "left" | "center" | "right",
  numFmt?: string
): Record<string, unknown> {
  const norm = (header || "").trim().toLowerCase();
  const baseZebraBg = rowIndex % 2 === 0 ? EXCEL_PALETTE.white : EXCEL_PALETTE.softBg;

  let bg = baseZebraBg;
  let fontColor = EXCEL_PALETTE.darkSlate;
  let bold = false;

  // 1. Actual Output / Good Output / Machine Ops Actual
  if (
    norm.includes("actual output") ||
    norm.includes("machine ops actual") ||
    norm === "good output" ||
    norm === "good output (pcs)"
  ) {
    bg = EXCEL_PALETTE.blueTint;
    if (norm.includes("actual output") || norm.includes("machine ops actual")) {
      bold = true;
    }
  }

  // 2. Rework
  if (norm.includes("rework")) {
    const num = typeof rawVal === "number" ? rawVal : parseFloat(String(rawVal));
    if (!isNaN(num) && num > 0) {
      bg = EXCEL_PALETTE.roseTint;
      fontColor = EXCEL_PALETTE.roseText;
      bold = true;
    }
  }

  // 2B. Overtime (subtle amber tint when > 0)
  if (norm === "ot (m)" || norm.includes("overtime")) {
    const num = typeof rawVal === "number" ? rawVal : parseFloat(String(rawVal));
    if (!isNaN(num) && num > 0) {
      bg = EXCEL_PALETTE.amberTint;
      fontColor = EXCEL_PALETTE.amberDarkText;
      bold = true;
    }
  }

  // 3. Breakdown category summary badge column (Overview Sheet 1)
  if (norm === "category code") {
    const dtCategory = getDowntimeCategoryByHeader(String(rawVal ?? ""));
    if (dtCategory) {
      bg = dtCategory.excelCellBgHex;
      fontColor = dtCategory.excelCellTextHex;
      bold = true;
    }
  }

  // 4. Breakdown category columns (exact canonical tint & text when > 0)
  const dtCategoryCol = getDowntimeCategoryByHeader(header);
  if (dtCategoryCol) {
    const num = typeof rawVal === "number" ? rawVal : parseFloat(String(rawVal));
    if (!isNaN(num) && num > 0) {
      bg = dtCategoryCol.excelCellBgHex;
      fontColor = dtCategoryCol.excelCellTextHex;
      bold = true;
    }
  }

  // 5. Total BD / Downtime column
  const isTotalBdCol =
    norm.includes("total bd") ||
    norm.includes("total downtime") ||
    norm === "bd %" ||
    norm === "downtime (m)" ||
    norm === "downtime (mins)" ||
    norm === "downtime" ||
    norm === "bd mins";

  if (isTotalBdCol) {
    const num = typeof rawVal === "number" ? rawVal : parseFloat(String(rawVal));
    if (!isNaN(num) && num > 0) {
      bg = TOTAL_DOWNTIME_THEME.excelCellBgHex;
      fontColor = TOTAL_DOWNTIME_THEME.excelCellTextHex;
      bold = true;
    }
  }

  // 5. OEE % traffic-light
  if (norm.includes("oee")) {
    let pctVal = NaN;
    if (typeof rawVal === "number") {
      pctVal = rawVal;
    } else if (typeof rawVal === "string") {
      const clean = rawVal.replace("%", "").trim();
      pctVal = parseFloat(clean);
    }

    if (!isNaN(pctVal)) {
      if (pctVal >= 85) {
        bg = EXCEL_PALETTE.oeeGreenBg;
        fontColor = EXCEL_PALETTE.oeeGreenText;
        bold = true;
      } else if (pctVal >= 65) {
        bg = EXCEL_PALETTE.oeeYellowBg;
        fontColor = EXCEL_PALETTE.oeeYellowText;
        bold = true;
      } else if (pctVal > 0) {
        bg = EXCEL_PALETTE.oeeRedBg;
        fontColor = EXCEL_PALETTE.oeeRedText;
        bold = true;
      }
    }
  }

  // 6. Temp? badge
  if (norm === "temp?" || norm === "is temp machine" || norm === "type" || norm === "machine type") {
    const str = String(rawVal || "").trim().toLowerCase();
    if (str === "yes" || str === "temp" || str.includes("temporary")) {
      bg = EXCEL_PALETTE.indigoTint;
      fontColor = EXCEL_PALETTE.indigoText;
      bold = true;
    }
  }

  return {
    fill: { fgColor: { rgb: bg } },
    font: {
      name: "Calibri",
      sz: 10,
      bold,
      color: { rgb: fontColor },
    },
    alignment: {
      vertical: "center",
      horizontal: align,
      wrapText: align === "left",
    },
    border: {
      top: thinBorder(EXCEL_PALETTE.gridBorder),
      bottom: thinBorder(EXCEL_PALETTE.gridBorder),
      left: thinBorder(EXCEL_PALETTE.gridBorder),
      right: thinBorder(EXCEL_PALETTE.gridBorder),
    },
    numFmt: numFmt || undefined,
  };
}

/**
 * Returns totals footer row cell style:
 * - Fill: #E2E8F0
 * - Font: bold #0F172A 10pt
 * - Medium top & bottom border #1E293B
 */
export function getTotalsCellStyle(
  align: "left" | "center" | "right",
  numFmt?: string
): Record<string, unknown> {
  return {
    fill: { fgColor: { rgb: EXCEL_PALETTE.dividerBorder } },
    font: {
      name: "Calibri",
      sz: 10,
      bold: true,
      color: { rgb: EXCEL_PALETTE.darkSlate },
    },
    alignment: {
      vertical: "center",
      horizontal: align,
    },
    border: {
      top: mediumBorder(EXCEL_PALETTE.navySlate),
      bottom: mediumBorder(EXCEL_PALETTE.navySlate),
      left: thinBorder(EXCEL_PALETTE.kpiBorder),
      right: thinBorder(EXCEL_PALETTE.kpiBorder),
    },
    numFmt: numFmt || undefined,
  };
}

// ============================================================================
// REUSABLE STYLED WORKSHEET BUILDER
// ============================================================================

export interface StyledWorksheetSection {
  sectionTitle?: string;
  headers?: string[];
  rows: (string | number)[][];
  totalsRow?: (string | number)[];
}

export interface StyledWorksheetOptions {
  title: string;
  metadata?: Array<{ label: string; value: string | number } | [string, string | number]>;
  kpiStrip?: Array<{ label: string; value: string | number }>;
  sectionTitle?: string;
  headers?: string[];
  rows?: (string | number)[][];
  totalsRow?: (string | number)[];
  extraSections?: StyledWorksheetSection[];
  dataMerges?: Array<{ startRowIndex: number; endRowIndex: number; colIndex: number }>;
  rowStyleHints?: Record<number, "group_header" | "group_subtotal">;
}

/**
 * Constructs a fully formatted, executive-styled XLSX.WorkSheet:
 * 1. Merged Title Banner (#1E293B, bold white 13pt, height 28)
 * 2. Metadata Info Box (#F8FAFC, bold #475569 labels, medium #64748B outer border)
 * 3. Compact 2-row boxed KPI strip (#E2E8F0 header + large 11pt values)
 * 4. Blank spacer row (height 12)
 * 5. Table Section Header Banner (#E2E8F0, thick bottom border #1E293B, height 22)
 * 6. Color-coded Main Table Header Row (semantic fills, white bold 10pt, height 26)
 * 7. Zebra data rows (10pt, thin grid, semantic highlights, height 19)
 * 8. Summary Totals Row (#E2E8F0, medium top/bottom border, height 22)
 * 9. Auto-fit column widths & freeze panes
 */
export function buildStyledWorksheet(options: StyledWorksheetOptions): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  const merges: XLSX.Range[] = [];
  const rowHeights: Array<{ hpt: number }> = [];

  // Determine total column span
  const candidateHeaderLen = options.headers?.length || 0;
  const candidateExtraLen = Math.max(
    0,
    ...(options.extraSections || []).map((s) => s.headers?.length || (s.rows[0]?.length ?? 0))
  );
  const candidateKpiLen = options.kpiStrip?.length || 0;
  const totalCols = Math.max(candidateHeaderLen, candidateExtraLen, candidateKpiLen, 6);

  let currRow = 0;

  // --------------------------------------------------------------------------
  // 1. Title Banner Row (Merged A1 to totalCols - 1)
  // --------------------------------------------------------------------------
  merges.push({ s: { r: currRow, c: 0 }, e: { r: currRow, c: totalCols - 1 } });
  rowHeights.push({ hpt: 28 });

  for (let c = 0; c < totalCols; c++) {
    const addr = XLSX.utils.encode_cell({ r: currRow, c });
    ws[addr] = {
      v: c === 0 ? options.title.toUpperCase() : "",
      t: "s",
      s: {
        fill: { fgColor: { rgb: EXCEL_PALETTE.navySlate } },
        font: { name: "Calibri", sz: 13, bold: true, color: { rgb: EXCEL_PALETTE.white } },
        alignment: { vertical: "center", horizontal: "left" },
        border: {
          top: mediumBorder(EXCEL_PALETTE.darkSlate),
          bottom: mediumBorder(EXCEL_PALETTE.darkSlate),
          left: c === 0 ? mediumBorder(EXCEL_PALETTE.darkSlate) : undefined,
          right: c === totalCols - 1 ? mediumBorder(EXCEL_PALETTE.darkSlate) : undefined,
        },
      },
    };
  }
  currRow++;

  // --------------------------------------------------------------------------
  // 2. Metadata / Active Filters Block (Distinct Info Box)
  // --------------------------------------------------------------------------
  const rawMeta = options.metadata || [];
  const metaItems: Array<{ label: string; value: string | number }> = rawMeta.map((m) =>
    Array.isArray(m) ? { label: String(m[0]), value: m[1] } : m
  );

  if (metaItems.length > 0) {
    const useTwoColumnPairs = totalCols >= 8 && metaItems.length >= 2;
    const midCol = Math.floor(totalCols / 2);

    // Group items into rows
    const metaRowPairs: Array<Array<{ label: string; value: string | number }>> = [];
    if (useTwoColumnPairs) {
      for (let i = 0; i < metaItems.length; i += 2) {
        const pair = [metaItems[i]];
        if (i + 1 < metaItems.length) pair.push(metaItems[i + 1]);
        metaRowPairs.push(pair);
      }
    } else {
      metaItems.forEach((it) => metaRowPairs.push([it]));
    }

    const totalMetaRows = metaRowPairs.length;

    metaRowPairs.forEach((pair, rIdx) => {
      rowHeights.push({ hpt: 20 });
      const isFirst = rIdx === 0;
      const isLast = rIdx === totalMetaRows - 1 && (!options.kpiStrip || options.kpiStrip.length === 0);

      if (useTwoColumnPairs) {
        // Pair 1
        const it1 = pair[0];
        merges.push({ s: { r: currRow, c: 1 }, e: { r: currRow, c: midCol - 1 } });
        // Pair 2 (if present)
        if (pair[1]) {
          merges.push({ s: { r: currRow, c: midCol + 1 }, e: { r: currRow, c: totalCols - 1 } });
        } else {
          merges.push({ s: { r: currRow, c: midCol }, e: { r: currRow, c: totalCols - 1 } });
        }

        for (let c = 0; c < totalCols; c++) {
          let cellVal = "";
          let isLabel = false;

          if (c === 0) {
            cellVal = `${it1.label}:`;
            isLabel = true;
          } else if (c === 1) {
            cellVal = String(it1.value ?? "");
          } else if (c === midCol) {
            if (pair[1]) {
              cellVal = `${pair[1].label}:`;
              isLabel = true;
            }
          } else if (c === midCol + 1 && pair[1]) {
            cellVal = String(pair[1].value ?? "");
          }

          const addr = XLSX.utils.encode_cell({ r: currRow, c });
          ws[addr] = {
            v: cellVal,
            t: "s",
            s: {
              fill: { fgColor: { rgb: EXCEL_PALETTE.softBg } },
              font: {
                name: "Calibri",
                sz: 10,
                bold: isLabel,
                color: { rgb: isLabel ? EXCEL_PALETTE.mutedSlate : EXCEL_PALETTE.darkSlate },
              },
              alignment: { vertical: "center", horizontal: "left" },
              border: {
                top: isFirst ? mediumBorder(EXCEL_PALETTE.borderSlate) : thinBorder(EXCEL_PALETTE.dividerBorder),
                bottom: isLast ? mediumBorder(EXCEL_PALETTE.borderSlate) : thinBorder(EXCEL_PALETTE.dividerBorder),
                left: c === 0 ? mediumBorder(EXCEL_PALETTE.borderSlate) : undefined,
                right: c === totalCols - 1 ? mediumBorder(EXCEL_PALETTE.borderSlate) : undefined,
              },
            },
          };
        }
      } else {
        // Single pair per row
        const it = pair[0];
        merges.push({ s: { r: currRow, c: 1 }, e: { r: currRow, c: totalCols - 1 } });

        for (let c = 0; c < totalCols; c++) {
          const cellVal = c === 0 ? `${it.label}:` : c === 1 ? String(it.value ?? "") : "";
          const isLabel = c === 0;

          const addr = XLSX.utils.encode_cell({ r: currRow, c });
          ws[addr] = {
            v: cellVal,
            t: "s",
            s: {
              fill: { fgColor: { rgb: EXCEL_PALETTE.softBg } },
              font: {
                name: "Calibri",
                sz: 10,
                bold: isLabel,
                color: { rgb: isLabel ? EXCEL_PALETTE.mutedSlate : EXCEL_PALETTE.darkSlate },
              },
              alignment: { vertical: "center", horizontal: "left" },
              border: {
                top: isFirst ? mediumBorder(EXCEL_PALETTE.borderSlate) : thinBorder(EXCEL_PALETTE.dividerBorder),
                bottom: isLast ? mediumBorder(EXCEL_PALETTE.borderSlate) : thinBorder(EXCEL_PALETTE.dividerBorder),
                left: c === 0 ? mediumBorder(EXCEL_PALETTE.borderSlate) : undefined,
                right: c === totalCols - 1 ? mediumBorder(EXCEL_PALETTE.borderSlate) : undefined,
              },
            },
          };
        }
      }
      currRow++;
    });
  }

  // --------------------------------------------------------------------------
  // 3. Compact Summary KPI Strip (2 rows: Header + Large 11pt Value)
  // --------------------------------------------------------------------------
  if (options.kpiStrip && options.kpiStrip.length > 0) {
    const kpis = options.kpiStrip;
    const colsPerKpi = Math.max(1, Math.floor(totalCols / kpis.length));

    // KPI Header Row
    rowHeights.push({ hpt: 20 });
    const kpiHeaderRow = currRow;
    currRow++;

    // KPI Value Row
    rowHeights.push({ hpt: 24 });
    const kpiValRow = currRow;
    currRow++;

    kpis.forEach((kpi, kIdx) => {
      const startC = kIdx * colsPerKpi;
      const endC = kIdx === kpis.length - 1 ? totalCols - 1 : (kIdx + 1) * colsPerKpi - 1;

      if (endC > startC) {
        merges.push({ s: { r: kpiHeaderRow, c: startC }, e: { r: kpiHeaderRow, c: endC } });
        merges.push({ s: { r: kpiValRow, c: startC }, e: { r: kpiValRow, c: endC } });
      }

      for (let c = startC; c <= endC; c++) {
        // Header cell
        const hAddr = XLSX.utils.encode_cell({ r: kpiHeaderRow, c });
        ws[hAddr] = {
          v: c === startC ? kpi.label : "",
          t: "s",
          s: {
            fill: { fgColor: { rgb: EXCEL_PALETTE.dividerBorder } },
            font: { name: "Calibri", sz: 9, bold: true, color: { rgb: EXCEL_PALETTE.mutedSlate } },
            alignment: { vertical: "center", horizontal: "center" },
            border: {
              top: mediumBorder(EXCEL_PALETTE.borderSlate),
              bottom: thinBorder(EXCEL_PALETTE.kpiBorder),
              left: c === startC ? thinBorder(EXCEL_PALETTE.kpiBorder) : undefined,
              right: c === endC ? thinBorder(EXCEL_PALETTE.kpiBorder) : undefined,
            },
          },
        };

        // Value cell
        const vAddr = XLSX.utils.encode_cell({ r: kpiValRow, c });
        ws[vAddr] = {
          v: c === startC ? kpi.value : "",
          t: typeof kpi.value === "number" ? "n" : "s",
          s: {
            fill: { fgColor: { rgb: EXCEL_PALETTE.white } },
            font: { name: "Calibri", sz: 11, bold: true, color: { rgb: EXCEL_PALETTE.darkSlate } },
            alignment: { vertical: "center", horizontal: "center" },
            border: {
              top: thinBorder(EXCEL_PALETTE.kpiBorder),
              bottom: mediumBorder(EXCEL_PALETTE.borderSlate),
              left: c === startC ? thinBorder(EXCEL_PALETTE.kpiBorder) : undefined,
              right: c === endC ? thinBorder(EXCEL_PALETTE.kpiBorder) : undefined,
            },
          },
        };
      }
    });
  }

  // Helper to render a table block (Section Header, Table Headers, Rows, Totals)
  let freezeHeaderRowIdx = -1;

  const renderSectionBlock = (section: {
    sectionTitle?: string;
    headers?: string[];
    rows: (string | number)[][];
    totalsRow?: (string | number)[];
    isMainTable?: boolean;
  }) => {
    // 1. Clean blank spacer row (height 12)
    rowHeights.push({ hpt: 12 });
    currRow++;

    const secHeaders = section.headers || [];
    const secCols = Math.max(secHeaders.length, totalCols);

    // 2. Section Header Banner
    if (section.sectionTitle) {
      merges.push({ s: { r: currRow, c: 0 }, e: { r: currRow, c: secCols - 1 } });
      rowHeights.push({ hpt: 22 });

      for (let c = 0; c < secCols; c++) {
        const addr = XLSX.utils.encode_cell({ r: currRow, c });
        ws[addr] = {
          v: c === 0 ? section.sectionTitle.toUpperCase() : "",
          t: "s",
          s: {
            fill: { fgColor: { rgb: EXCEL_PALETTE.dividerBorder } },
            font: { name: "Calibri", sz: 10.5, bold: true, color: { rgb: EXCEL_PALETTE.darkSlate } },
            alignment: { vertical: "center", horizontal: "left" },
            border: {
              top: thinBorder(EXCEL_PALETTE.gridBorder),
              bottom: thickBorder(EXCEL_PALETTE.navySlate), // Thick bottom border makes start of table unmistakable
              left: thinBorder(EXCEL_PALETTE.gridBorder),
              right: thinBorder(EXCEL_PALETTE.gridBorder),
            },
          },
        };
      }
      currRow++;
    }

    // 3. Color-Coded Header Row
    if (secHeaders.length > 0) {
      rowHeights.push({ hpt: 26 });
      if (section.isMainTable && freezeHeaderRowIdx === -1) {
        freezeHeaderRowIdx = currRow + 1; // Freeze panes immediately below this header
      }

      secHeaders.forEach((h, c) => {
        const fillRgb = getHeaderFill(h);
        const addr = XLSX.utils.encode_cell({ r: currRow, c });
        ws[addr] = {
          v: h,
          t: "s",
          s: {
            fill: { fgColor: { rgb: fillRgb } },
            font: { name: "Calibri", sz: 10, bold: true, color: { rgb: EXCEL_PALETTE.white } },
            alignment: { vertical: "center", horizontal: "center", wrapText: true },
            border: {
              top: thinBorder("475569"),
              bottom: mediumBorder(EXCEL_PALETTE.darkSlate),
              left: thinBorder("475569"),
              right: thinBorder("475569"),
            },
          },
        };
      });
      currRow++;
    }

    // 4. Data Rows (Zebra + Semantic Tints)
    if (section.isMainTable && options.dataMerges && options.dataMerges.length > 0) {
      options.dataMerges.forEach((dm) => {
        merges.push({
          s: { r: currRow + dm.startRowIndex, c: dm.colIndex },
          e: { r: currRow + dm.endRowIndex, c: dm.colIndex },
        });
      });
    }

    section.rows.forEach((row, rIdx) => {
      const hint = section.isMainTable ? options.rowStyleHints?.[rIdx] : undefined;
      rowHeights.push({ hpt: hint === "group_header" ? 21 : hint === "group_subtotal" ? 20 : 19 });

      row.forEach((val, c) => {
        const headerName = secHeaders[c] || "";
        const align = getColumnAlignment(headerName);
        const numFmt = getNumberFormat(headerName, val);
        let style = getDataCellStyle(headerName, val, rIdx, align, numFmt);

        if (hint === "group_header") {
          style = {
            fill: { fgColor: { rgb: EXCEL_PALETTE.dividerBorder } },
            font: { name: "Calibri", sz: 10, bold: true, color: { rgb: EXCEL_PALETTE.darkSlate } },
            alignment: { vertical: "center", horizontal: c === 0 ? "left" : align },
            border: {
              top: mediumBorder(EXCEL_PALETTE.borderSlate),
              bottom: thinBorder(EXCEL_PALETTE.kpiBorder),
              left: thinBorder(EXCEL_PALETTE.gridBorder),
              right: thinBorder(EXCEL_PALETTE.gridBorder),
            },
            numFmt: numFmt || undefined,
          };
        } else if (hint === "group_subtotal") {
          style = {
            fill: { fgColor: { rgb: EXCEL_PALETTE.softBg } },
            font: { name: "Calibri", sz: 9.5, bold: true, color: { rgb: EXCEL_PALETTE.darkSlate } },
            alignment: { vertical: "center", horizontal: align },
            border: {
              top: thinBorder(EXCEL_PALETTE.borderSlate),
              bottom: mediumBorder(EXCEL_PALETTE.borderSlate),
              left: thinBorder(EXCEL_PALETTE.gridBorder),
              right: thinBorder(EXCEL_PALETTE.gridBorder),
            },
            numFmt: numFmt || undefined,
          };
        }

        const addr = XLSX.utils.encode_cell({ r: currRow, c });
        ws[addr] = {
          v: val,
          t: typeof val === "number" ? "n" : "s",
          s: style,
        };
      });
      currRow++;
    });

    // 5. Totals Footer Row
    if (section.totalsRow && section.totalsRow.length > 0) {
      rowHeights.push({ hpt: 22 });

      section.totalsRow.forEach((val, c) => {
        const headerName = secHeaders[c] || "";
        const align = getColumnAlignment(headerName);
        const numFmt = getNumberFormat(headerName, val);
        const style = getTotalsCellStyle(align, numFmt);

        const addr = XLSX.utils.encode_cell({ r: currRow, c });
        ws[addr] = {
          v: val,
          t: typeof val === "number" ? "n" : "s",
          s: style,
        };
      });
      currRow++;
    }
  };

  // Render extra sections first (if any)
  if (options.extraSections && options.extraSections.length > 0) {
    options.extraSections.forEach((sec) => renderSectionBlock(sec));
  }

  // Render main data table
  if (options.headers && options.headers.length > 0) {
    renderSectionBlock({
      sectionTitle: options.sectionTitle || "MAIN DATA TABLE",
      headers: options.headers,
      rows: options.rows || [],
      totalsRow: options.totalsRow,
      isMainTable: true,
    });
  }

  // Set range
  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: Math.max(currRow - 1, 0), c: totalCols - 1 },
  });
  ws["!merges"] = merges;
  ws["!rows"] = rowHeights;

  // Auto-fit column widths (min 10, max 36, +3 padding)
  const cols: Array<{ wch: number }> = [];
  for (let c = 0; c < totalCols; c++) {
    let maxLen = 10;
    // Check main headers
    if (options.headers && options.headers[c]) {
      maxLen = Math.max(maxLen, String(options.headers[c]).length);
    }
    // Check main rows
    if (options.rows) {
      for (let r = 0; r < Math.min(options.rows.length, 150); r++) {
        const v = options.rows[r]?.[c];
        if (v !== undefined && v !== null) {
          maxLen = Math.max(maxLen, String(v).length);
        }
      }
    }
    // Check totals
    if (options.totalsRow && options.totalsRow[c]) {
      maxLen = Math.max(maxLen, String(options.totalsRow[c]).length);
    }

    cols.push({ wch: Math.min(maxLen + 3, 38) });
  }
  ws["!cols"] = cols;

  // Set freeze panes on main table header
  if (freezeHeaderRowIdx > 0) {
    ws["!views"] = [{ state: "frozen", ySplit: freezeHeaderRowIdx }];
  }

  return ws;
}

// ============================================================================
// FORMATTERS & DATA ROW UTILITIES (PowerBI & Analytics Schema)
// ============================================================================

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

function formatEnrichedLogRow(r: EnrichedAnalyticsRow): (string | number)[] {
  const ct = Number(r.cycleTime) || 0;
  const ot = Math.max(0, Number(r.overtimeMinutes) || 0);
  const std = Number(r.stdOutput) || 0;
  const act = Number(r.actualOutput) || 0;
  const rew = Number(r.rework) || 0;
  const good = Number(r.goodOutput) || Math.max(0, act - rew);
  const planned = Number((Number(r.allocatedPlannedMinutes) || 0).toFixed(1));
  const oper = Number((Number(r.operatingMinutes) || 0).toFixed(1));
  const planPct = std > 0 ? Number(((act / std) * 100).toFixed(1)) : 0;

  const noDisc = Number((Number(r.breakdown?.noDisc) || 0).toFixed(2));
  const change = Number((Number(r.breakdown?.change) || 0).toFixed(2));
  const power = Number((Number(r.breakdown?.power) || 0).toFixed(2));
  const operator = Number((Number(r.breakdown?.operator) || 0).toFixed(2));
  const bd = Number((Number(r.breakdown?.machineBreakdown) || 0).toFixed(2));
  const fix = Number((Number(r.breakdown?.fixProgSettings) || 0).toFixed(2));
  const misc = Number((Number(r.breakdown?.miscellaneous) || 0).toFixed(2));
  const totalBd = Number((noDisc + change + power + operator + bd + fix + misc).toFixed(2));

  const availPct = planned > 0 ? Math.min(100, Number(((oper / planned) * 100).toFixed(2))) : 0;
  const qualPct = act > 0 ? Math.min(100, Number(((good / act) * 100).toFixed(2))) : 100;
  const goodIdeal = good * ct;
  const oeePct = planned > 0 ? Math.min(100, Number(((goodIdeal / planned) * 100).toFixed(2))) : 0;

  return [
    r.date,
    r.shift,
    r.line || "Line 1",
    r.machineName || r.machineId,
    r.machineId,
    r.isTempMachine ? "TEMP" : "Perm",
    r.runNo || 1,
    r.operatorName || "",
    r.itemName || "",
    r.itemId || "",
    r.operation || "",
    ct,
    ot,
    planned,
    oper,
    std,
    act,
    good,
    rew,
    `${planPct}%`,
    noDisc,
    change,
    power,
    operator,
    bd,
    fix,
    misc,
    totalBd,
    `${availPct}%`,
    `${qualPct}%`,
    `${oeePct}%`,
    r.remarks || "",
  ];
}

export function sanitizeSheetName(name: string, usedNames?: Set<string>): string {
  let clean = (name || "Sheet")
    .replace(/[\\/?*[\]:]/g, "_")
    .trim()
    .slice(0, 31);
  if (!clean) clean = "Sheet";

  if (!usedNames) return clean;

  let candidate = clean;
  let counter = 2;
  while (usedNames.has(candidate)) {
    const suffix = `_${counter}`;
    const maxBaseLen = 31 - suffix.length;
    candidate = `${clean.slice(0, maxBaseLen)}${suffix}`;
    counter++;
  }
  usedNames.add(candidate);
  return candidate;
}

export function sanitizeFileName(name: string): string {
  return (name || "Export")
    .replace(/[\\/:*?"<>|\s]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export interface ActiveFiltersMetadata {
  reportTitle?: string;
  fromDate: string;
  toDate: string;
  line?: string;
  shift?: string;
  product?: string;
  machine?: string;
  operator?: string;
  includeTemp?: boolean;
  tempOnly?: boolean;
  splitOnly?: boolean;
  otOnly?: boolean;
  exportedAt?: string;
}

const formatDateRangeValue = (fromDate: string, toDate: string): string =>
  fromDate && toDate && fromDate === toDate ? fromDate : `${fromDate} to ${toDate}`;

const formatDateRangeFileTag = (fromDate: string, toDate: string): string =>
  fromDate && toDate && fromDate === toDate ? fromDate : `${fromDate}_to_${toDate}`;

export function buildFilterMetadataRows(filters: ActiveFiltersMetadata): (string | number)[][] {
  const rows: (string | number)[][] = [];

  if (filters.reportTitle) {
    rows.push(["REPORT TITLE", filters.reportTitle]);
  }
  rows.push([
    filters.fromDate && filters.toDate && filters.fromDate === filters.toDate
      ? "DATE"
      : "DATE RANGE",
    formatDateRangeValue(filters.fromDate, filters.toDate),
  ]);
  rows.push(["LINE FILTER", filters.line && filters.line !== "all" ? filters.line : "All Lines"]);
  rows.push(["SHIFT FILTER", filters.shift && filters.shift !== "all" ? filters.shift : "All Shifts"]);
  if (filters.product && filters.product !== "all") {
    rows.push(["PRODUCT FILTER", filters.product]);
  }
  if (filters.machine && filters.machine !== "all") {
    rows.push(["MACHINE FILTER", filters.machine]);
  }
  if (filters.operator && filters.operator !== "all") {
    rows.push(["OPERATOR FILTER", filters.operator]);
  }

  const toggles: string[] = [];
  if (filters.tempOnly) toggles.push("TEMP Only");
  else if (filters.includeTemp === false) toggles.push("Permanent Only (No TEMP)");
  else toggles.push("Include TEMP");

  if (filters.splitOnly) toggles.push("Split Runs Only");
  if (filters.otOnly) toggles.push("OT Only");

  rows.push(["TOGGLES / MODES", toggles.join(", ")]);
  rows.push(["EXPORTED AT", filters.exportedAt || new Date().toLocaleString()]);
  rows.push([]);

  return rows;
}

export function buildFilterMetadataList(filters: ActiveFiltersMetadata): Array<{ label: string; value: string | number }> {
  const list: Array<{ label: string; value: string | number }> = [];

  list.push({
    label:
      filters.fromDate && filters.toDate && filters.fromDate === filters.toDate
        ? "DATE"
        : "DATE RANGE",
    value: formatDateRangeValue(filters.fromDate, filters.toDate),
  });
  list.push({
    label: "LINE FILTER",
    value: filters.line && filters.line !== "all" ? filters.line : "All Lines",
  });
  list.push({
    label: "SHIFT FILTER",
    value: filters.shift && filters.shift !== "all" ? filters.shift : "All Shifts",
  });

  if (filters.product && filters.product !== "all") {
    list.push({ label: "PRODUCT FILTER", value: filters.product });
  }
  if (filters.machine && filters.machine !== "all") {
    list.push({ label: "MACHINE FILTER", value: filters.machine });
  }
  if (filters.operator && filters.operator !== "all") {
    list.push({ label: "OPERATOR FILTER", value: filters.operator });
  }

  const toggles: string[] = [];
  if (filters.tempOnly) toggles.push("TEMP Only");
  else if (filters.includeTemp === false) toggles.push("Permanent Only (No TEMP)");
  else toggles.push("Include TEMP");

  if (filters.splitOnly) toggles.push("Split Runs Only");
  if (filters.otOnly) toggles.push("OT Only");

  list.push({ label: "TOGGLES / MODES", value: toggles.join(", ") });
  list.push({ label: "EXPORTED AT", value: filters.exportedAt || new Date().toLocaleString() });

  return list;
}

// ============================================================================
// DATA BUILDERS (Line, Machine, Item & Product Matrix)
// ============================================================================

function buildLineEfficiencyData(
  rows: MachineShiftRow[],
  masterData?: MasterDataState
): { headers: string[]; data: (string | number)[][]; totals: (string | number)[] } {
  const lineNames =
    masterData?.lines && masterData.lines.length > 0
      ? masterData.lines.filter((l) => l.isActive !== false).map((l) => l.name)
      : PRODUCTION_LINES;

  const allMachines = masterData?.machines && masterData.machines.length > 0
    ? masterData.machines
    : INITIAL_MACHINES;

  const allEnriched = computeAllocatedPlannedMinutes(rows);
  const data: (string | number)[][] = [];

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
    const lineEnriched = allEnriched.filter((r) => (r.line || "Line 1") === lineName);
    const lineMetrics = calculateOeeMetrics(lineEnriched);

    const activeRows = lineRows.filter((r) => Number(r.stdOutput) > 0);

    const activeMachineIds = new Set(activeRows.map((r) => r.machineId || r.machineName));
    activeRows.forEach((r) => grandActiveMachinesSet.add(r.machineId || r.machineName));

    const lineStd = activeRows.reduce((acc, r) => acc + (Number(r.stdOutput) || 0), 0);
    const lineAct = activeRows.reduce((acc, r) => acc + (Number(r.actualOutput) || 0), 0);
    const lineVariance = lineAct - lineStd;
    const lineEff = lineStd > 0 ? Math.round((lineAct / lineStd) * 100) : 0;

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

    data.push([
      lineName,
      `${activeMachineIds.size} / ${totalLineMachines} active (${totalLineMachines > 0 ? Math.round((activeMachineIds.size / totalLineMachines) * 100) : 0}%)`,
      lineStd,
      lineAct,
      lineVariance,
      `${lineEff}%`,
      `${lineMetrics.availabilityPct}%`,
      `${lineMetrics.qualityPct}%`,
      `${lineMetrics.oeePct}%`,
      shiftAStd,
      shiftAAct,
      shiftAStd > 0 ? `${shiftAEff}%` : "—",
      shiftBStd,
      shiftBAct,
      shiftBStd > 0 ? `${shiftBEff}%` : "—",
      shiftCStd,
      shiftCAct,
      shiftCStd > 0 ? `${shiftCEff}%` : "—",
      activeEffs.length >= 2 ? `${spread}%` : "—",
      totalBd,
    ]);
  }

  const plantMetrics = calculateOeeMetrics(allEnriched);
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

  const totals: (string | number)[] = [
    "TOTAL PLANT (ALL LINES)",
    `${grandActiveMachinesSet.size} / ${grandTotalMachines} active (${grandTotalMachines > 0 ? Math.round((grandActiveMachinesSet.size / grandTotalMachines) * 100) : 0}%)`,
    grandStd,
    grandAct,
    grandAct - grandStd,
    `${grandEff}%`,
    `${plantMetrics.availabilityPct}%`,
    `${plantMetrics.qualityPct}%`,
    `${plantMetrics.oeePct}%`,
    grandShiftAStd,
    grandShiftAAct,
    grandShiftAStd > 0 ? `${grandShiftAEff}%` : "—",
    grandShiftBStd,
    grandShiftBAct,
    grandShiftBStd > 0 ? `${grandShiftBEff}%` : "—",
    grandShiftCStd,
    grandShiftCAct,
    grandShiftCStd > 0 ? `${grandShiftCEff}%` : "—",
    plantEffs.length >= 2 ? `${grandSpread}%` : "—",
    grandBd,
  ];

  const headers = [
    "Line Name",
    "Operating Machines",
    "Target (Std Pcs)",
    "Actual Output (Pcs)",
    "Variance (Pcs)",
    "Line Efficiency %",
    "Availability %",
    "Quality %",
    "OEE %",
    "Shift A Target",
    "Shift A Actual",
    "Shift A Eff %",
    "Shift B Target",
    "Shift B Actual",
    "Shift B Eff %",
    "Shift C Target",
    "Shift C Actual",
    "Shift C Eff %",
    "Shift Spread %",
    "Total Downtime (mins)",
  ];

  return { headers, data, totals };
}

function buildMachineEfficiencyData(
  rows: MachineShiftRow[],
  masterData?: MasterDataState
): { headers: string[]; data: (string | number)[][] } {
  const allMachines = masterData?.machines && masterData.machines.length > 0
    ? masterData.machines
    : INITIAL_MACHINES;

  const allEnriched = computeAllocatedPlannedMinutes(rows);
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

  const headers = [
    "Machine Name",
    "Code",
    "Line",
    "Status",
    "Shifts Operated",
    "Scheduled Target (Std)",
    "Actual Output (Pcs)",
    "Variance",
    "Machine Efficiency %",
    "Availability %",
    "Quality %",
    "OEE %",
    "Shift A Output",
    "Shift A Eff %",
    "Shift B Output",
    "Shift B Eff %",
    "Shift C Output",
    "Shift C Eff %",
    "Best / Worst Shift",
    "Shift Spread %",
    "Downtime (mins)",
    "Rework (pcs)",
  ];

  const data = combinedMachines.map((m) => {
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

    const machEnriched = allEnriched.filter(
      (r) => r.machineId === m.id || (!m.isTemp && r.machineName === m.name)
    );
    const machMetrics = calculateOeeMetrics(machEnriched);

    return [
      m.name,
      m.code || "",
      m.line || "Line 1",
      activeLogs.length > 0 ? "Active" : "Idle / Unassigned",
      shiftsOperatedText,
      std,
      act,
      act - std,
      std > 0 ? `${eff}%` : "—",
      machMetrics.plannedMinutes > 0 ? `${machMetrics.availabilityPct}%` : "—",
      machMetrics.totalActual > 0 ? `${machMetrics.qualityPct}%` : "—",
      machMetrics.plannedMinutes > 0 ? `${machMetrics.oeePct}%` : "—",
      aAct,
      aEff,
      bAct,
      bEff,
      cAct,
      cEff,
      bestWorstText,
      shiftSpreadText,
      downtime,
      rework,
    ];
  });

  return { headers, data };
}

function buildItemProductionData(
  rows: MachineShiftRow[],
  itemRollups?: ItemProductionRollup[],
  masterData?: MasterDataState
): { headers: string[]; data: (string | number)[][] } {
  const itemLookup = new Map<string, { id?: string; itemCode: string; itemName: string }>();
  for (const it of (masterData?.items || [])) {
    const id = (it.id ?? "").trim().toLowerCase();
    const code = (it.itemCode ?? "").trim().toLowerCase();
    const name = (it.itemName ?? "").trim().toLowerCase();
    const info = { id: it.id, itemCode: it.itemCode || "", itemName: it.itemName || "" };
    if (id.length > 0) itemLookup.set(id, info);
    if (code.length > 0) itemLookup.set(code, info);
    if (name.length > 0) itemLookup.set(name, info);
  }

  const resolve = (rawId?: string, rawCode?: string, rawName?: string) => {
    const id = (rawId ?? "").trim();
    const code = (rawCode ?? "").trim();
    const name = (rawName ?? "").trim();
    const norm = (s: string) => s.toLowerCase();
    const matched =
      (id.length > 0 ? itemLookup.get(norm(id)) : null) ||
      (code.length > 0 ? itemLookup.get(norm(code)) : null) ||
      (name.length > 0 ? itemLookup.get(norm(name)) : null);

    const itemCode = matched?.itemCode || code || (id && !id.startsWith("item_") && !id.startsWith("it_") ? id : "—");
    const itemName = matched?.itemName || name || (itemCode !== "—" ? itemCode : "Unknown Part");
    const itemId = matched?.id || id || "";
    const canonicalKey = (itemCode !== "—" ? itemCode : itemId || itemName).toLowerCase();
    return { canonicalKey, itemId, itemCode, itemName };
  };

  const map = new Map<
    string,
    {
      canonicalKey: string;
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

  if (itemRollups && itemRollups.length > 0) {
    for (const roll of itemRollups) {
      const resolved = resolve(roll.itemId, roll.itemCode, roll.itemName);
      if (!map.has(resolved.canonicalKey)) {
        map.set(resolved.canonicalKey, {
          canonicalKey: resolved.canonicalKey,
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

  for (const r of rows) {
    const act = Number(r.actualOutput) || 0;
    const rew = Number(r.rework) || 0;
    if (act <= 0 && rew <= 0) continue;
    const rawId = (r.itemId ?? "").trim();
    const rawName = (r.itemName ?? "").trim();
    if (rawId.length === 0 && rawName.length === 0) continue;
    const resolved = resolve(rawId, undefined, rawName);
    if (!map.has(resolved.canonicalKey)) {
      map.set(resolved.canonicalKey, {
        canonicalKey: resolved.canonicalKey,
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

  const allEnriched = computeAllocatedPlannedMinutes(rows);
  const headers = [
    "Part Code",
    "Item Name",
    "Selected Period Qty",
    "Today Qty",
    "Month-to-Date (MTD) Qty",
    "Total Till Now Qty",
    "Till Now Target (Std)",
    "Till Now Rework (pcs)",
    "Period Efficiency %",
    "Availability %",
    "Quality %",
    "OEE %",
  ];

  const data = Array.from(map.values())
    .sort((a, b) => b.periodAct - a.periodAct || b.tillNowQty - a.tillNowQty)
    .map((it) => {
      const itemEnriched = allEnriched.filter(
        (r) => resolve(r.itemId, undefined, r.itemName).canonicalKey === it.canonicalKey
      );
      const itemMetrics = calculateOeeMetrics(itemEnriched);
      return [
        it.itemCode,
        it.itemName,
        it.periodAct,
        it.todayQty,
        it.mtdQty,
        it.tillNowQty,
        it.tillNowStd,
        it.tillNowRework,
        it.periodStd > 0 ? `${Math.round((it.periodAct / it.periodStd) * 100)}%` : "—",
        itemMetrics.plannedMinutes > 0 ? `${itemMetrics.availabilityPct}%` : "—",
        itemMetrics.totalActual > 0 ? `${itemMetrics.qualityPct}%` : "—",
        itemMetrics.plannedMinutes > 0 ? `${itemMetrics.oeePct}%` : "—",
      ];
    });

  return { headers, data };
}

export function buildProductLineMachineMatrixData(
  rows: MachineShiftRow[]
): Record<string, string | number>[] {
  const enriched = computeAllocatedPlannedMinutes(rows);
  const matrixItems = buildProductLineMachineMatrix(enriched);
  const result: Record<string, string | number>[] = [];

  for (const prod of matrixItems) {
    for (const m of prod.matrix) {
      result.push({
        "Product Name": prod.productName,
        "Product Code": prod.productCode || "—",
        "Line": m.line,
        "Machine Name": m.machineName,
        "Machine ID": m.machineId,
        "Machine Type": m.isTempMachine ? "TEMP" : "Permanent",
        "Operation": m.operation,
        "Split Runs Count": m.splitRunsCount,
        "Run Numbers": m.runNos.join(", "),
        "Scheduled Target (Std)": m.stdOutput,
        "Actual Output (Pcs)": m.actualOutput,
        "Rework (Pcs)": m.rework,
        "Good Output (Pcs)": m.goodOutput,
        "Downtime (mins)": m.breakdownMinutes,
        "Availability %": `${m.metrics.availabilityPct}%`,
        "Quality %": `${m.metrics.qualityPct}%`,
        "OEE %": `${m.metrics.oeePct}%`,
        "Plan Achievement %": `${m.metrics.planAchievementPct}%`,
        "Latest Date": m.latestDate,
        "Latest Shift": m.latestShift,
      });
    }
  }

  return result;
}

// ============================================================================
// EXPORT ACTION 1: Shift to Excel (Daily Shift Sheet / Multi-Sheet Export)
// ============================================================================

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
      const sampleRow = rows[0];
      const date = dateArg || sampleRow?.date || new Date().toISOString().split("T")[0];
      const shift = shiftArg || sampleRow?.shift || "Shift A (7AM-3:30PM)";
      const line = lineArg || sampleRow?.line || "All_Lines";

      const commonMeta = [
        { label: "DATE", value: date },
        { label: "SHIFT", value: shift },
        { label: "LINE", value: line },
        { label: "EXPORTED AT", value: new Date().toLocaleString() },
      ];

      // Sheet 1: Line & Shift Efficiency
      const lineEff = buildLineEfficiencyData(rows, masterData);
      const ws1 = buildStyledWorksheet({
        title: "Line & Shift-Wise Efficiency Matrix",
        metadata: commonMeta,
        sectionTitle: "PRODUCTION LINES EFFICIENCY & TIME BALANCING",
        headers: lineEff.headers,
        rows: lineEff.data,
        totalsRow: lineEff.totals,
      });
      XLSX.utils.book_append_sheet(wb, ws1, "Line & Shift Efficiency");

      // Sheet 2: Machine & Shift Efficiency
      const machEff = buildMachineEfficiencyData(rows, masterData);
      const ws2 = buildStyledWorksheet({
        title: "Machine & Shift-Wise Efficiency Matrix",
        metadata: commonMeta,
        sectionTitle: "MACHINE EFFICIENCY & SHIFT PERFORMANCE MATRIX",
        headers: machEff.headers,
        rows: machEff.data,
      });
      XLSX.utils.book_append_sheet(wb, ws2, "Machine Efficiency");

      // Sheet 3: Item Production Summary
      const itemProd = buildItemProductionData(rows, itemRollups, masterData);
      if (itemProd.data.length > 0) {
        const ws3 = buildStyledWorksheet({
          title: "Item Production Summary",
          metadata: commonMeta,
          sectionTitle: "MANUFACTURING QUANTITIES & OEE BY COMPONENT",
          headers: itemProd.headers,
          rows: itemProd.data,
        });
        XLSX.utils.book_append_sheet(wb, ws3, "Item Production Summary");
      }

      // Sheet 4: Product-Line-Machine Matrix
      const matrixRecords = buildProductLineMachineMatrixData(rows);
      if (matrixRecords.length > 0) {
        const matrixHeaders = Object.keys(matrixRecords[0]);
        const matrixRows = matrixRecords.map((rec) => matrixHeaders.map((h) => rec[h] ?? ""));
        const ws4 = buildStyledWorksheet({
          title: "Product-Line-Machine Matrix (Traceability & Split Runs)",
          metadata: commonMeta,
          sectionTitle: "COMPONENT-TO-MACHINE TRACEABILITY MATRIX",
          headers: matrixHeaders,
          rows: matrixRows,
        });
        XLSX.utils.book_append_sheet(wb, ws4, "Product-Line-Machine Matrix");
      }

      // Sheet 5: Shift Logs Detail (vw_powerbi_shift_logs schema)
      const formattedDetail = rows.map(formatRowForExport);
      if (formattedDetail.length > 0) {
        const detailHeaders = Object.keys(formattedDetail[0]);
        const detailRows = formattedDetail.map((rec) => detailHeaders.map((h) => rec[h] ?? ""));
        const ws5 = buildStyledWorksheet({
          title: "Shift Logs Detail (PowerBI Schema)",
          metadata: commonMeta,
          sectionTitle: "RAW SHOP-FLOOR SHIFT PRODUCTION LOGS",
          headers: detailHeaders,
          rows: detailRows,
        });
        XLSX.utils.book_append_sheet(wb, ws5, "Shift Logs Detail");
      }

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

// ============================================================================
// EXPORT ACTION 2: Item Traceability Workbook
// ============================================================================

export interface ExportItemTraceabilityParams {
  product: ProductMatrixItem;
  itemRows: EnrichedAnalyticsRow[];
  activeFilters: {
    fromDate: string;
    toDate: string;
    line?: string;
    shift?: string;
    machine?: string;
    operator?: string;
    includeTemp?: boolean;
    tempOnly?: boolean;
    splitOnly?: boolean;
  };
  shiftItemTotals?: ShiftItemProductionRow[];
  groupByOperation?: boolean;
}

export function exportItemTraceabilityExcel(params: ExportItemTraceabilityParams): void {
  const { product, itemRows, activeFilters, groupByOperation = false } = params;
  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  const overallMetrics = calculateOeeMetrics(itemRows);
  const metadataList = buildFilterMetadataList({
    reportTitle: `Product Traceability & Machine Matrix - ${product.productName}`,
    fromDate: activeFilters.fromDate,
    toDate: activeFilters.toDate,
    line: activeFilters.line,
    shift: activeFilters.shift,
    product: product.productName,
    machine: activeFilters.machine,
    operator: activeFilters.operator,
    includeTemp: activeFilters.includeTemp,
    tempOnly: activeFilters.tempOnly,
    splitOnly: activeFilters.splitOnly,
  });

  if (groupByOperation) {
    metadataList.push({ label: "View Mode", value: "Grouped by Operation" });
  }

  // --------------------------------------------------------------------------
  // Sheet 1: Full Range Summary
  // --------------------------------------------------------------------------
  let sheet1Headers: string[];
  let sheet1Rows: (string | number)[][];
  let sheet1Totals: (string | number)[];
  const dataMerges: Array<{ startRowIndex: number; endRowIndex: number; colIndex: number }> = [];

  if (groupByOperation && product.operationGroups && product.operationGroups.length > 0) {
    sheet1Headers = [
      "Operation",
      "Line",
      "Machine",
      "Temp?",
      "Split Runs",
      "Runs",
      "Std Output",
      "Actual Output",
      "Good Output",
      "Rework",
      "Plan %",
      "Op Combined Prod",
      "NO/DISC",
      "CHANGE",
      "POWER",
      "OPERATOR",
      "BREAK DOWN",
      "FIX/PROG",
      "MISC.",
      "Total BD (m)",
      "Avail %",
      "Qual %",
      "OEE %",
    ];

    sheet1Rows = [];
    let rIdx = 0;

    for (const group of product.operationGroups) {
      const gLen = group.machines.length;
      if (gLen > 1) {
        dataMerges.push({ startRowIndex: rIdx, endRowIndex: rIdx + gLen - 1, colIndex: 0 });
        dataMerges.push({ startRowIndex: rIdx, endRowIndex: rIdx + gLen - 1, colIndex: 11 });
      }

      for (const m of group.machines) {
        sheet1Rows.push([
          group.operation,
          m.line,
          m.machineName,
          m.isTempMachine ? "TEMP" : "Perm",
          m.splitRunsCount > 0 ? "Split" : "1",
          m.runsCount,
          m.stdOutput,
          m.actualOutput,
          m.goodOutput,
          m.rework,
          `${m.planAchievementPct}%`,
          group.combinedActualOutput,
          m.breakdownTotals?.noDisc ?? 0,
          m.breakdownTotals?.change ?? 0,
          m.breakdownTotals?.power ?? 0,
          m.breakdownTotals?.operator ?? 0,
          m.breakdownTotals?.machineBreakdown ?? 0,
          m.breakdownTotals?.fixProgSettings ?? 0,
          m.breakdownTotals?.miscellaneous ?? 0,
          m.downtimeMinutes,
          `${m.availabilityPct}%`,
          `${m.qualityPct}%`,
          `${m.oeePct}%`,
        ]);
        rIdx++;
      }
    }

    sheet1Totals = [
      "TOTALS / OVERALL",
      "-",
      `${product.matrix.length} allocations`,
      "-",
      "-",
      overallMetrics.rowCount,
      overallMetrics.totalStd,
      overallMetrics.totalActual,
      overallMetrics.goodOutput,
      overallMetrics.totalRework,
      `${overallMetrics.planAchievementPct}%`,
      overallMetrics.totalActual,
      overallMetrics.breakdownTotals.noDisc,
      overallMetrics.breakdownTotals.change,
      overallMetrics.breakdownTotals.power,
      overallMetrics.breakdownTotals.operator,
      overallMetrics.breakdownTotals.machineBreakdown,
      overallMetrics.breakdownTotals.fixProgSettings,
      overallMetrics.breakdownTotals.miscellaneous,
      overallMetrics.downtimeMinutes,
      `${overallMetrics.availabilityPct}%`,
      `${overallMetrics.qualityPct}%`,
      `${overallMetrics.oeePct}%`,
    ];
  } else {
    sheet1Headers = [
      "Line",
      "Machine",
      "Temp?",
      "Split Runs",
      "Operation",
      "Runs",
      "Std Output",
      "Actual Output",
      "Good Output",
      "Rework",
      "Plan %",
      "NO/DISC",
      "CHANGE",
      "POWER",
      "OPERATOR",
      "BREAK DOWN",
      "FIX/PROG",
      "MISC.",
      "Total BD (m)",
      "Avail %",
      "Qual %",
      "OEE %",
    ];

    sheet1Rows = product.matrix.map((m) => [
      m.line,
      m.machineName,
      m.isTempMachine ? "TEMP" : "Perm",
      m.splitRunsCount > 0 ? `Split (${m.runNos.join(",")})` : "1",
      m.operation,
      m.metrics.rowCount,
      m.stdOutput,
      m.actualOutput,
      m.goodOutput,
      m.rework,
      `${m.metrics.planAchievementPct}%`,
      m.metrics.breakdownTotals.noDisc,
      m.metrics.breakdownTotals.change,
      m.metrics.breakdownTotals.power,
      m.metrics.breakdownTotals.operator,
      m.metrics.breakdownTotals.machineBreakdown,
      m.metrics.breakdownTotals.fixProgSettings,
      m.metrics.breakdownTotals.miscellaneous,
      m.breakdownMinutes,
      `${m.metrics.availabilityPct}%`,
      `${m.metrics.qualityPct}%`,
      `${m.metrics.oeePct}%`,
    ]);

    sheet1Totals = [
      "TOTALS / OVERALL",
      `${product.matrix.length} allocations`,
      "-",
      "-",
      "-",
      product.matrix.reduce((acc, m) => acc + m.metrics.rowCount, 0),
      overallMetrics.totalStd,
      overallMetrics.totalActual,
      overallMetrics.goodOutput,
      overallMetrics.totalRework,
      `${overallMetrics.planAchievementPct}%`,
      overallMetrics.breakdownTotals.noDisc,
      overallMetrics.breakdownTotals.change,
      overallMetrics.breakdownTotals.power,
      overallMetrics.breakdownTotals.operator,
      overallMetrics.breakdownTotals.machineBreakdown,
      overallMetrics.breakdownTotals.fixProgSettings,
      overallMetrics.breakdownTotals.miscellaneous,
      overallMetrics.downtimeMinutes,
      `${overallMetrics.availabilityPct}%`,
      `${overallMetrics.qualityPct}%`,
      `${overallMetrics.oeePct}%`,
    ];
  }

  const sheet1Kpis = [
    { label: "OEE %", value: `${overallMetrics.oeePct}%` },
    { label: "Availability %", value: `${overallMetrics.availabilityPct}%` },
    { label: "Plan %", value: `${overallMetrics.planAchievementPct}%` },
    { label: "Quality %", value: `${overallMetrics.qualityPct}%` },
    { label: "Total Prod (Pre-QC)", value: `${(product.preQcProduction ?? product.finishedProduction ?? 0).toLocaleString()} pcs` },
    { label: "Quality Inspection", value: "100.00% Passed (Assumed - Pre-QC)" },
    { label: "Actual Output", value: overallMetrics.totalActual },
    { label: "Scheduled Target", value: overallMetrics.totalStd },
    { label: "Good Output", value: overallMetrics.goodOutput },
    { label: "Total Breakdown", value: `${overallMetrics.downtimeMinutes} mins` },
    {
      label: "Total OT Hours",
      value: `${(overallMetrics.totalOvertimeMinutes / 60).toFixed(1)} hrs (${overallMetrics.totalOvertimeMinutes}m)`,
    },
  ];

  const ws1 = buildStyledWorksheet({
    title: `Product Traceability & Machine Matrix — ${product.productName}`,
    metadata: metadataList,
    kpiStrip: sheet1Kpis,
    sectionTitle: groupByOperation ? "OPERATION-GROUPED MACHINE PROCESS MATRIX" : "FULL-PERIOD LINE & MACHINE MATRIX",
    headers: sheet1Headers,
    rows: sheet1Rows,
    totalsRow: sheet1Totals,
    dataMerges: dataMerges.length > 0 ? dataMerges : undefined,
  });
  XLSX.utils.book_append_sheet(wb, ws1, sanitizeSheetName("Full Range Summary", usedNames));

  // --------------------------------------------------------------------------
  // Sheet 2: Day-Wise Overview
  // --------------------------------------------------------------------------
  const datesSet = new Set<string>();
  itemRows.forEach((r) => {
    if (r.date) datesSet.add(r.date);
  });
  const uniqueDatesDesc = Array.from(datesSet).sort((a, b) => b.localeCompare(a));

  const sheet2Headers = [
    "Date",
    "Active Lines",
    "Machines Count",
    "Shifts",
    "Std Output",
    "Actual Output",
    "Good Output",
    "Total Prod (Pre-QC)",
    "Rework",
    "Plan %",
    "Total BD (m)",
    "Avail %",
    "Qual %",
    "OEE %",
  ];

  const sheet2Rows: (string | number)[][] = uniqueDatesDesc.map((d) => {
    const dRows = itemRows.filter((r) => r.date === d);
    const dMetrics = calculateOeeMetrics(dRows);
    const lines = Array.from(new Set(dRows.map((r) => r.line || "Line 1"))).sort().join(", ");
    const mCount = new Set(dRows.map((r) => r.machineId || r.machineName)).size;
    const shifts = Array.from(new Set(dRows.map((r) => r.shift))).sort().join(", ");
    const dayPreQc = product.dailyPreQcProduction?.[d] ?? product.dailyFinishedProduction?.[d] ?? 0;

    return [
      d,
      lines,
      mCount,
      shifts,
      dMetrics.totalStd,
      dMetrics.totalActual,
      dMetrics.goodOutput,
      dayPreQc,
      dMetrics.totalRework,
      `${dMetrics.planAchievementPct}%`,
      dMetrics.downtimeMinutes,
      `${dMetrics.availabilityPct}%`,
      `${dMetrics.qualityPct}%`,
      `${dMetrics.oeePct}%`,
    ];
  });

  const sheet2Totals: (string | number)[] = [
    "TOTAL / AVERAGE",
    product.lines.join(", "),
    product.matrix.length,
    "-",
    overallMetrics.totalStd,
    overallMetrics.totalActual,
    overallMetrics.goodOutput,
    product.preQcProduction ?? product.finishedProduction ?? 0,
    overallMetrics.totalRework,
    `${overallMetrics.planAchievementPct}%`,
    overallMetrics.downtimeMinutes,
    `${overallMetrics.availabilityPct}%`,
    `${overallMetrics.qualityPct}%`,
    `${overallMetrics.oeePct}%`,
  ];

  const ws2 = buildStyledWorksheet({
    title: `Day-Wise Manufacturing Overview — ${product.productName}`,
    metadata: metadataList,
    sectionTitle: "CHRONOLOGICAL DAY-BY-DAY OUTPUT & OEE MATRIX",
    headers: sheet2Headers,
    rows: sheet2Rows,
    totalsRow: sheet2Totals,
  });
  XLSX.utils.book_append_sheet(wb, ws2, sanitizeSheetName("Day-Wise Overview", usedNames));

  // --------------------------------------------------------------------------
  // Sheets 3+: Day-Wise Matrix Sheets (Memory Guard <= 45 dates vs consolidated)
  // --------------------------------------------------------------------------
  const dayMatrixHeaders = [
    "Shift",
    "Line",
    "Machine",
    "Temp?",
    "Run #",
    "Operator",
    "Operation",
    "Cycle Time",
    "OT (m)",
    "Std Output",
    "Actual Output",
    "Good Output",
    "Rework",
    "Plan %",
    "NO/DISC",
    "CHANGE",
    "POWER",
    "OPERATOR",
    "BREAK DOWN",
    "FIX/PROG",
    "MISC.",
    "Total BD (m)",
    "Avail %",
    "Qual %",
    "OEE %",
    "Remarks",
  ];

  if (uniqueDatesDesc.length <= 45) {
    for (const d of uniqueDatesDesc) {
      const dRows = itemRows.filter((r) => r.date === d);
      const dMetrics = calculateOeeMetrics(dRows);

      const dKpis = [
        { label: "Day OEE %", value: `${dMetrics.oeePct}%` },
        { label: "Daily Output", value: `${dMetrics.totalActual} / ${dMetrics.totalStd} pcs` },
        { label: "Good / Rework", value: `${dMetrics.goodOutput} / ${dMetrics.totalRework} pcs` },
        { label: "Total Downtime", value: `${dMetrics.downtimeMinutes} mins` },
      ];

      const sortedDRows = [...dRows].sort((a, b) => {
        const sCmp = (a.shift || "").localeCompare(b.shift || "");
        if (sCmp !== 0) return sCmp;
        const lCmp = (a.line || "").localeCompare(b.line || "");
        if (lCmp !== 0) return lCmp;
        return (a.machineName || "").localeCompare(b.machineName || "");
      });

      const dTableRows: (string | number)[][] = sortedDRows.map((r) => {
        const f = formatEnrichedLogRow(r);
        return [
          f[1], f[2], f[3], f[5], f[6], f[7], f[10], f[11], f[12], f[15], f[16], f[17], f[18],
          f[19], f[20], f[21], f[22], f[23], f[24], f[25], f[26], f[27], f[28], f[29], f[30], f[31],
        ];
      });

      const dTotals: (string | number)[] = [
        "DAILY TOTAL",
        "-",
        `${new Set(dRows.map((r) => r.machineId)).size} machines`,
        "-",
        dRows.length,
        "-",
        "-",
        "-",
        dMetrics.totalOvertimeMinutes,
        dMetrics.totalStd,
        dMetrics.totalActual,
        dMetrics.goodOutput,
        dMetrics.totalRework,
        `${dMetrics.planAchievementPct}%`,
        dMetrics.breakdownTotals.noDisc,
        dMetrics.breakdownTotals.change,
        dMetrics.breakdownTotals.power,
        dMetrics.breakdownTotals.operator,
        dMetrics.breakdownTotals.machineBreakdown,
        dMetrics.breakdownTotals.fixProgSettings,
        dMetrics.breakdownTotals.miscellaneous,
        dMetrics.downtimeMinutes,
        `${dMetrics.availabilityPct}%`,
        `${dMetrics.qualityPct}%`,
        `${dMetrics.oeePct}%`,
        "-",
      ];

      const wsD = buildStyledWorksheet({
        title: `Day Matrix — ${d} — ${product.productName}`,
        metadata: [
          { label: "DATE", value: d },
          { label: "PRODUCT", value: product.productName },
          { label: "PRODUCT CODE", value: product.productCode || "—" },
          { label: "ACTIVE RUNS", value: `${dRows.length} runs` },
        ],
        kpiStrip: dKpis,
        sectionTitle: `MACHINE ALLOCATIONS & SHIFT PRODUCTION — ${d}`,
        headers: dayMatrixHeaders,
        rows: dTableRows,
        totalsRow: dTotals,
      });
      XLSX.utils.book_append_sheet(wb, wsD, sanitizeSheetName(d, usedNames));
    }
  } else {
    // Consolidated sheet if > 45 dates
    const sortedAll = [...itemRows].sort((a, b) => {
      const dCmp = (b.date || "").localeCompare(a.date || "");
      if (dCmp !== 0) return dCmp;
      const sCmp = (a.shift || "").localeCompare(b.shift || "");
      if (sCmp !== 0) return sCmp;
      return (a.machineName || "").localeCompare(b.machineName || "");
    });

    const consolidatedHeaders = ["Date", ...dayMatrixHeaders];
    const consolidatedRows: (string | number)[][] = sortedAll.map((r) => {
      const f = formatEnrichedLogRow(r);
      return [
        f[0], f[1], f[2], f[3], f[5], f[6], f[7], f[10], f[11], f[12], f[15], f[16], f[17], f[18],
        f[19], f[20], f[21], f[22], f[23], f[24], f[25], f[26], f[27], f[28], f[29], f[30], f[31],
      ];
    });

    const consolidatedTotals: (string | number)[] = [
      "GRAND TOTAL",
      "-",
      "-",
      `${product.matrix.length} allocations`,
      "-",
      sortedAll.length,
      "-",
      "-",
      "-",
      overallMetrics.totalOvertimeMinutes,
      overallMetrics.totalStd,
      overallMetrics.totalActual,
      overallMetrics.goodOutput,
      overallMetrics.totalRework,
      `${overallMetrics.planAchievementPct}%`,
      overallMetrics.breakdownTotals.noDisc,
      overallMetrics.breakdownTotals.change,
      overallMetrics.breakdownTotals.power,
      overallMetrics.breakdownTotals.operator,
      overallMetrics.breakdownTotals.machineBreakdown,
      overallMetrics.breakdownTotals.fixProgSettings,
      overallMetrics.breakdownTotals.miscellaneous,
      overallMetrics.downtimeMinutes,
      `${overallMetrics.availabilityPct}%`,
      `${overallMetrics.qualityPct}%`,
      `${overallMetrics.oeePct}%`,
      "-",
      "-",
    ];

    const wsAll = buildStyledWorksheet({
      title: `Consolidated Day-Wise Machine Matrix — ${product.productName}`,
      metadata: metadataList,
      sectionTitle: "ALL-DAYS DETAILED SHIFT & MACHINE MATRIX",
      headers: consolidatedHeaders,
      rows: consolidatedRows,
      totalsRow: consolidatedTotals,
    });
    XLSX.utils.book_append_sheet(wb, wsAll, sanitizeSheetName("All Days Machine Matrix", usedNames));
  }

  const cleanName = sanitizeFileName(product.productName);
  const filename = `Item_${cleanName}_${formatDateRangeFileTag(
    activeFilters.fromDate,
    activeFilters.toDate
  )}.xlsx`;
  XLSX.writeFile(wb, filename);
}

function appendDailyShiftItemSheet(params: {
  wb: XLSX.WorkBook;
  usedNames: Set<string>;
  filteredRows: EnrichedAnalyticsRow[];
  shiftItemTotals?: ShiftItemProductionRow[];
  masterData?: MasterDataState;
  metadataList: { label: string; value: string | number }[];
  overallMetrics: OeeMetrics;
}): void {
  const { wb, usedNames, filteredRows, shiftItemTotals, masterData, metadataList, overallMetrics } = params;
  const dailyPeriods = groupByPeriod(filteredRows, "day", shiftItemTotals, masterData?.items);

  const dsiHeaders = [
    "Date",
    "Item",
    "Shift",
    "Total Prod (Pre-QC)",
    "QC Passed (100%)",
    "Machine Ops Actual",
    "Machine Ops Std",
    "Plan %",
    "Rework",
    "Total BD (m)",
    "Avail %",
    "Qual %",
    "OEE %",
  ];

  const dsiRows: (string | number)[][] = [];
  let totalPreQc = 0;
  let totalQcPassed = 0;
  let totalOpsActual = 0;
  let totalOpsStd = 0;
  let totalRework = 0;
  let totalBd = 0;

  // Date DESC -> Item ASC -> Shift A -> B -> C
  for (const day of dailyPeriods) {
    const sortedItems = [...day.itemShiftBreakdown].sort((a, b) =>
      a.itemName.localeCompare(b.itemName)
    );
    for (const item of sortedItems) {
      const itemDisplay =
        item.itemCode && item.itemCode.trim().toLowerCase() !== item.itemName.trim().toLowerCase()
          ? `${item.itemName} (${item.itemCode})`
          : item.itemName;

      for (const s of item.shifts) {
        totalPreQc += s.qc.preQcProduction;
        totalQcPassed += s.qc.qcPassed;
        totalOpsActual += s.machineOpsActual;
        totalOpsStd += s.machineOpsStd;
        totalRework += s.rework;
        totalBd += s.downtimeMinutes;

        dsiRows.push([
          day.periodLabel,
          itemDisplay,
          s.shiftShortLabel,
          s.qc.preQcProduction,
          s.qc.qcPassed,
          s.machineOpsActual,
          s.machineOpsStd,
          s.machineRunsCount > 0 ? `${s.planAchievementPct}%` : "—",
          s.rework,
          round2(s.downtimeMinutes),
          s.machineRunsCount > 0 ? `${s.availabilityPct}%` : "—",
          s.machineRunsCount > 0 ? `${s.qualityPct}%` : "—",
          s.machineRunsCount > 0 ? `${s.oeePct}%` : "—",
        ]);
      }
    }
  }

  const overallPlanPct =
    totalOpsStd > 0 ? round2((totalOpsActual / totalOpsStd) * 100) : overallMetrics.planAchievementPct;

  const dsiTotals: (string | number)[] = [
    "TOTALS / OVERALL",
    `${dsiRows.length} shift-item rows`,
    "—",
    totalPreQc,
    totalQcPassed,
    totalOpsActual,
    totalOpsStd,
    `${overallPlanPct}%`,
    totalRework,
    round2(totalBd),
    `${overallMetrics.availabilityPct}%`,
    `${overallMetrics.qualityPct}%`,
    `${overallMetrics.oeePct}%`,
  ];

  const wsDsi = buildStyledWorksheet({
    title: "Daily Shift-Wise × Item Breakdown",
    metadata: metadataList,
    sectionTitle: "DAILY SHIFT-WISE ITEM PRODUCTION (PRE-QC) & MACHINE OEE",
    headers: dsiHeaders,
    rows: dsiRows,
    totalsRow: dsiTotals,
  });
  XLSX.utils.book_append_sheet(wb, wsDsi, sanitizeSheetName("Daily Shift-Item", usedNames));
}

// ============================================================================
// EXPORT ACTION 3: Filtered Analytics Comprehensive Workbook
// ============================================================================

export interface ExportFilteredAnalyticsParams {
  filteredRows: EnrichedAnalyticsRow[];
  activeFilters: ActiveFiltersMetadata;
  periodGranularity?: "day" | "week";
  masterData?: MasterDataState;
  shiftItemTotals?: ShiftItemProductionRow[];
}

export function exportFilteredAnalyticsWorkbook(params: ExportFilteredAnalyticsParams): void {
  const { filteredRows, activeFilters, periodGranularity = "day", masterData, shiftItemTotals } = params;
  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  const overallMetrics = calculateOeeMetrics(filteredRows);
  const totalPreQc = (shiftItemTotals || []).reduce(
    (sum, r) => sum + (Number(r.totalProduction) || 0),
    0
  );

  const metadataList = buildFilterMetadataList({
    reportTitle: "Executive Manufacturing Analytics & OEE Report",
    ...activeFilters,
  });

  const overviewKpis = [
    { label: "Overall OEE %", value: `${overallMetrics.oeePct}%` },
    { label: "Availability %", value: `${overallMetrics.availabilityPct}%` },
    { label: "Plan %", value: `${overallMetrics.planAchievementPct}%` },
    { label: "Quality %", value: `${overallMetrics.qualityPct}%` },
    { label: "Total Prod (Pre-QC)", value: `${totalPreQc.toLocaleString()} pcs` },
    { label: "Quality Pass Rate", value: "100.00% (Assumed - Pre-QC)" },
    { label: "Actual Output", value: overallMetrics.totalActual },
    { label: "Scheduled Target", value: overallMetrics.totalStd },
    { label: "Good Output", value: overallMetrics.goodOutput },
    { label: "Total Breakdown", value: `${overallMetrics.downtimeMinutes} mins` },
    {
      label: "Total OT Hours",
      value: `${(overallMetrics.totalOvertimeMinutes / 60).toFixed(1)} hrs (${overallMetrics.totalOvertimeMinutes}m)`,
    },
  ];

  // --------------------------------------------------------------------------
  // Sheet 1: Overview & Filters
  // --------------------------------------------------------------------------
  const oeeSection: StyledWorksheetSection = {
    sectionTitle: "EXECUTIVE 4-METRIC OEE DASHBOARD",
    headers: ["Metric", "Value", "Standard / Formula"],
    rows: [
      ["Overall OEE %", `${overallMetrics.oeePct}%`, "Good Run Time / Planned Shift Time"],
      ["Availability %", `${overallMetrics.availabilityPct}%`, "Operating Time / Planned Shift Time"],
      ["Plan Achievement %", `${overallMetrics.planAchievementPct}%`, "Actual Output / Scheduled Target (Std)"],
      ["Quality %", `${overallMetrics.qualityPct}%`, "Good Output / Actual Output"],
    ],
  };

  const volumeSection: StyledWorksheetSection = {
    sectionTitle: "PRODUCTION VOLUME TOTALS",
    headers: ["Metric", "Value", "Unit"],
    rows: [
      ["Total Production (Pre-QC)", totalPreQc, "pcs"],
      ["QC Passed Output (Assumed)", totalPreQc, "pcs"],
      ["QC Rejected Output (Assumed)", 0, "pcs"],
      ["Scheduled Target (Std)", overallMetrics.totalStd, "pcs"],
      ["Actual Output", overallMetrics.totalActual, "pcs"],
      ["Good Output", overallMetrics.goodOutput, "pcs"],
      ["Rework Output", overallMetrics.totalRework, "pcs"],
    ],
  };

  const timeSection: StyledWorksheetSection = {
    sectionTitle: "SHIFT TIME UTILIZATION TOTALS",
    headers: ["Metric", "Value", "Unit"],
    rows: [
      ["Planned Shift Time", overallMetrics.plannedMinutes, "mins"],
      ["Overtime Logged", overallMetrics.totalOvertimeMinutes, "mins"],
      ["Operating Time", overallMetrics.operatingMinutes, "mins"],
      ["Total Breakdown Downtime", overallMetrics.downtimeMinutes, "mins"],
      ["Ideal Run Time", overallMetrics.idealRunMinutes, "mins"],
      ["Total Shift Logs Analyzed", overallMetrics.rowCount, "runs"],
    ],
  };

  const dtHeaders = ["Category Code", "Category Name", "Downtime (mins)", "% of Total Downtime"];
  const dtRows = [
    [
      "NO/DISC",
      "No Operator / Discussion",
      overallMetrics.breakdownTotals.noDisc,
      overallMetrics.downtimeMinutes > 0
        ? `${Math.round((overallMetrics.breakdownTotals.noDisc / overallMetrics.downtimeMinutes) * 100)}%`
        : "0%",
    ],
    [
      "CHANGE",
      "Tool / Insert / Setup Change",
      overallMetrics.breakdownTotals.change,
      overallMetrics.downtimeMinutes > 0
        ? `${Math.round((overallMetrics.breakdownTotals.change / overallMetrics.downtimeMinutes) * 100)}%`
        : "0%",
    ],
    [
      "POWER",
      "Power Interruption / Failure",
      overallMetrics.breakdownTotals.power,
      overallMetrics.downtimeMinutes > 0
        ? `${Math.round((overallMetrics.breakdownTotals.power / overallMetrics.downtimeMinutes) * 100)}%`
        : "0%",
    ],
    [
      "OPERATOR",
      "Operator Absence / Relief Delay",
      overallMetrics.breakdownTotals.operator,
      overallMetrics.downtimeMinutes > 0
        ? `${Math.round((overallMetrics.breakdownTotals.operator / overallMetrics.downtimeMinutes) * 100)}%`
        : "0%",
    ],
    [
      "BREAK DOWN",
      "Mechanical / Electrical Breakdown",
      overallMetrics.breakdownTotals.machineBreakdown,
      overallMetrics.downtimeMinutes > 0
        ? `${Math.round((overallMetrics.breakdownTotals.machineBreakdown / overallMetrics.downtimeMinutes) * 100)}%`
        : "0%",
    ],
    [
      "FIX/PROG",
      "Fixture / Program Settings Adjustment",
      overallMetrics.breakdownTotals.fixProgSettings,
      overallMetrics.downtimeMinutes > 0
        ? `${Math.round((overallMetrics.breakdownTotals.fixProgSettings / overallMetrics.downtimeMinutes) * 100)}%`
        : "0%",
    ],
    [
      "MISC.",
      "Miscellaneous / Shop Floor Unplanned",
      overallMetrics.breakdownTotals.miscellaneous,
      overallMetrics.downtimeMinutes > 0
        ? `${Math.round((overallMetrics.breakdownTotals.miscellaneous / overallMetrics.downtimeMinutes) * 100)}%`
        : "0%",
    ],
  ];
  const dtTotals = ["TOTAL", "Total Plant Downtime", overallMetrics.downtimeMinutes, "100%"];

  const ws1 = buildStyledWorksheet({
    title: "Executive Manufacturing Analytics & OEE Report",
    metadata: metadataList,
    kpiStrip: overviewKpis,
    extraSections: [oeeSection, volumeSection, timeSection],
    sectionTitle: "7-CATEGORY DOWNTIME SUMMARY",
    headers: dtHeaders,
    rows: dtRows,
    totalsRow: dtTotals,
  });
  XLSX.utils.book_append_sheet(wb, ws1, sanitizeSheetName("Overview & Filters", usedNames));

  // --------------------------------------------------------------------------
  // Sheet 2: By Product
  // --------------------------------------------------------------------------
  const products = buildProductLineMachineMatrix(filteredRows, shiftItemTotals);
  const pHeaders = [
    "Product Name",
    "Product Code",
    "Lines",
    "Machine Allocations",
    "Target (Std)",
    "Actual Output",
    "Good Output",
    "Total Prod (Pre-QC)",
    "QC Pass % (Assumed)",
    "Rework",
    "Plan %",
    "Downtime (m)",
    "Avail %",
    "Qual %",
    "OEE %",
  ];
  const pRows = products.map((p) => [
    p.productName,
    p.productCode || "—",
    p.lines.join(", ") || "—",
    p.matrix.length,
    p.metrics.totalStd,
    p.metrics.totalActual,
    p.metrics.goodOutput,
    p.preQcProduction ?? p.finishedProduction ?? 0,
    "100.00%",
    p.metrics.totalRework,
    `${p.metrics.planAchievementPct}%`,
    p.metrics.downtimeMinutes,
    `${p.metrics.availabilityPct}%`,
    `${p.metrics.qualityPct}%`,
    `${p.metrics.oeePct}%`,
  ]);
  const pTotals = [
    "TOTALS / OVERALL",
    "-",
    "-",
    products.reduce((acc, p) => acc + p.matrix.length, 0),
    overallMetrics.totalStd,
    overallMetrics.totalActual,
    overallMetrics.goodOutput,
    products.reduce((acc, p) => acc + (p.preQcProduction ?? p.finishedProduction ?? 0), 0),
    "100.00%",
    overallMetrics.totalRework,
    `${overallMetrics.planAchievementPct}%`,
    overallMetrics.downtimeMinutes,
    `${overallMetrics.availabilityPct}%`,
    `${overallMetrics.qualityPct}%`,
    `${overallMetrics.oeePct}%`,
  ];

  const ws2 = buildStyledWorksheet({
    title: "Manufacturing Analytics By Product",
    metadata: metadataList,
    sectionTitle: "PRODUCT TRACEABILITY & OEE PERFORMANCE",
    headers: pHeaders,
    rows: pRows,
    totalsRow: pTotals,
  });
  XLSX.utils.book_append_sheet(wb, ws2, sanitizeSheetName("By Product", usedNames));

  // --------------------------------------------------------------------------
  // Sheet 3: By Line
  // --------------------------------------------------------------------------
  const lines = groupByLine(filteredRows, shiftItemTotals);
  const lHeaders = [
    "Line Name",
    "Total Machines",
    "Perm Machines",
    "Temp Machines",
    "Target (Std)",
    "Actual Output",
    "Good Output",
    "Total Prod (Pre-QC)",
    "Rework",
    "Plan %",
    "Downtime (m)",
    "Avail %",
    "Qual %",
    "OEE %",
  ];
  const lRows = lines.map((l) => [
    l.line,
    l.machineCount,
    l.permMachineCount,
    l.tempMachineCount,
    l.metrics.totalStd,
    l.metrics.totalActual,
    l.metrics.goodOutput,
    l.preQcProduction ?? l.finishedProduction ?? 0,
    l.metrics.totalRework,
    `${l.metrics.planAchievementPct}%`,
    l.metrics.downtimeMinutes,
    `${l.metrics.availabilityPct}%`,
    `${l.metrics.qualityPct}%`,
    `${l.metrics.oeePct}%`,
  ]);
  const lTotals = [
    "PLANT TOTAL",
    lines.reduce((acc, l) => acc + l.machineCount, 0),
    lines.reduce((acc, l) => acc + l.permMachineCount, 0),
    lines.reduce((acc, l) => acc + l.tempMachineCount, 0),
    overallMetrics.totalStd,
    overallMetrics.totalActual,
    overallMetrics.goodOutput,
    lines.reduce((acc, l) => acc + (l.preQcProduction ?? l.finishedProduction ?? 0), 0),
    overallMetrics.totalRework,
    `${overallMetrics.planAchievementPct}%`,
    overallMetrics.downtimeMinutes,
    `${overallMetrics.availabilityPct}%`,
    `${overallMetrics.qualityPct}%`,
    `${overallMetrics.oeePct}%`,
  ];

  const ws3 = buildStyledWorksheet({
    title: "Manufacturing Analytics By Line",
    metadata: metadataList,
    sectionTitle: "PRODUCTION LINE EFFICIENCY & BALANCING",
    headers: lHeaders,
    rows: lRows,
    totalsRow: lTotals,
  });
  XLSX.utils.book_append_sheet(wb, ws3, sanitizeSheetName("By Line", usedNames));

  // --------------------------------------------------------------------------
  // Sheet 4: By Shift
  // --------------------------------------------------------------------------
  const shifts = groupByShift(filteredRows, shiftItemTotals);
  const sHeaders = [
    "Shift Name",
    "Active Machines",
    "Target (Std)",
    "Actual Output",
    "Good Output",
    "Total Prod (Pre-QC)",
    "Rework",
    "Plan %",
    "Downtime (m)",
    "Avail %",
    "Qual %",
    "OEE %",
  ];
  const sRows = shifts.map((s) => [
    s.shift,
    s.machineCount,
    s.metrics.totalStd,
    s.metrics.totalActual,
    s.metrics.goodOutput,
    s.preQcProduction ?? s.finishedProduction ?? 0,
    s.metrics.totalRework,
    `${s.metrics.planAchievementPct}%`,
    s.metrics.downtimeMinutes,
    `${s.metrics.availabilityPct}%`,
    `${s.metrics.qualityPct}%`,
    `${s.metrics.oeePct}%`,
  ]);
  const sTotals = [
    "PLANT TOTAL",
    "-",
    overallMetrics.totalStd,
    overallMetrics.totalActual,
    overallMetrics.goodOutput,
    shifts.reduce((acc, s) => acc + (s.preQcProduction ?? s.finishedProduction ?? 0), 0),
    overallMetrics.totalRework,
    `${overallMetrics.planAchievementPct}%`,
    overallMetrics.downtimeMinutes,
    `${overallMetrics.availabilityPct}%`,
    `${overallMetrics.qualityPct}%`,
    `${overallMetrics.oeePct}%`,
  ];

  const ws4 = buildStyledWorksheet({
    title: "Manufacturing Analytics By Shift",
    metadata: metadataList,
    sectionTitle: "SHIFT EFFICIENCY & PERFORMANCE COMPARISON",
    headers: sHeaders,
    rows: sRows,
    totalsRow: sTotals,
  });
  XLSX.utils.book_append_sheet(wb, ws4, sanitizeSheetName("By Shift", usedNames));

  // --------------------------------------------------------------------------
  // Sheet 5: By Day / By Week
  // --------------------------------------------------------------------------
  const periods = groupByPeriod(filteredRows, periodGranularity, shiftItemTotals, masterData?.items);
  const periodLabel = periodGranularity === "week" ? "ISO Week Range" : "Date";
  const perHeaders = [
    periodLabel,
    "Items Produced Count",
    "Target (Std)",
    "Actual Output",
    "Good Output",
    "Total Prod (Pre-QC)",
    "Rework",
    "Plan %",
    "Downtime (m)",
    "Avail %",
    "Qual %",
    "OEE %",
  ];
  const perRows = periods.map((p) => [
    p.periodLabel,
    p.itemsProduced.length,
    p.metrics.totalStd,
    p.metrics.totalActual,
    p.metrics.goodOutput,
    p.preQcProduction ?? p.finishedProduction ?? 0,
    p.metrics.totalRework,
    `${p.metrics.planAchievementPct}%`,
    p.metrics.downtimeMinutes,
    `${p.metrics.availabilityPct}%`,
    `${p.metrics.qualityPct}%`,
    `${p.metrics.oeePct}%`,
  ]);
  const perTotals = [
    "TOTAL / OVERALL",
    "-",
    overallMetrics.totalStd,
    overallMetrics.totalActual,
    overallMetrics.goodOutput,
    periods.reduce((acc, p) => acc + (p.preQcProduction ?? p.finishedProduction ?? 0), 0),
    overallMetrics.totalRework,
    `${overallMetrics.planAchievementPct}%`,
    overallMetrics.downtimeMinutes,
    `${overallMetrics.availabilityPct}%`,
    `${overallMetrics.qualityPct}%`,
    `${overallMetrics.oeePct}%`,
  ];

  const ws5 = buildStyledWorksheet({
    title: `Chronological Trends (${periodGranularity === "week" ? "Weekly" : "Daily"})`,
    metadata: metadataList,
    sectionTitle: "CHRONOLOGICAL PERFORMANCE TRENDS",
    headers: perHeaders,
    rows: perRows,
    totalsRow: perTotals,
  });
  XLSX.utils.book_append_sheet(wb, ws5, sanitizeSheetName(periodGranularity === "week" ? "By Week" : "By Day", usedNames));

  // --------------------------------------------------------------------------
  // Sheet 5B: Daily Shift-Item Breakdown
  // --------------------------------------------------------------------------
  appendDailyShiftItemSheet({
    wb,
    usedNames,
    filteredRows,
    shiftItemTotals,
    masterData,
    metadataList,
    overallMetrics,
  });

  // --------------------------------------------------------------------------
  // Sheet 6: By Machine
  // --------------------------------------------------------------------------
  const machines = groupByMachine(filteredRows);
  const mHeaders = [
    "Machine Name",
    "Machine ID",
    "Line",
    "Type",
    "Split Runs Count",
    "Target (Std)",
    "Actual Output",
    "Good Output",
    "Rework",
    "Plan %",
    "Downtime (m)",
    "Avail %",
    "Qual %",
    "OEE %",
  ];
  const mRows = machines.map((m) => [
    m.machineName,
    m.machineId,
    m.line,
    m.isTempMachine ? "TEMP" : "Perm",
    m.splitRunsCount,
    m.metrics.totalStd,
    m.metrics.totalActual,
    m.metrics.goodOutput,
    m.metrics.totalRework,
    `${m.metrics.planAchievementPct}%`,
    m.metrics.downtimeMinutes,
    `${m.metrics.availabilityPct}%`,
    `${m.metrics.qualityPct}%`,
    `${m.metrics.oeePct}%`,
  ]);
  const mTotals = [
    "TOTALS / OVERALL",
    `${machines.length} machines`,
    "-",
    "-",
    machines.reduce((acc, m) => acc + m.splitRunsCount, 0),
    overallMetrics.totalStd,
    overallMetrics.totalActual,
    overallMetrics.goodOutput,
    overallMetrics.totalRework,
    `${overallMetrics.planAchievementPct}%`,
    overallMetrics.downtimeMinutes,
    `${overallMetrics.availabilityPct}%`,
    `${overallMetrics.qualityPct}%`,
    `${overallMetrics.oeePct}%`,
  ];

  const ws6 = buildStyledWorksheet({
    title: "Manufacturing Analytics By Machine",
    metadata: metadataList,
    sectionTitle: "MACHINE RANKING & OEE COMPARISON",
    headers: mHeaders,
    rows: mRows,
    totalsRow: mTotals,
  });
  XLSX.utils.book_append_sheet(wb, ws6, sanitizeSheetName("By Machine", usedNames));

  // --------------------------------------------------------------------------
  // Sheet 7: Filtered Shift Logs
  // --------------------------------------------------------------------------
  const rawLogHeaders = [
    "Date",
    "Shift",
    "Line",
    "Machine",
    "Machine ID",
    "Temp?",
    "Run #",
    "Operator",
    "Item Name",
    "Item Code",
    "Operation",
    "Cycle Time",
    "OT (m)",
    "Planned Mins",
    "Operating Mins",
    "Std Output",
    "Actual Output",
    "Good Output",
    "Rework",
    "Plan %",
    "NO/DISC",
    "CHANGE",
    "POWER",
    "OPERATOR",
    "BREAK DOWN",
    "FIX/PROG",
    "MISC.",
    "Total BD (m)",
    "Avail %",
    "Qual %",
    "OEE %",
    "Remarks",
  ];

  const sortedFiltered = [...filteredRows].sort((a, b) => {
    const dCmp = (b.date || "").localeCompare(a.date || "");
    if (dCmp !== 0) return dCmp;
    const sCmp = (a.shift || "").localeCompare(b.shift || "");
    if (sCmp !== 0) return sCmp;
    return (a.machineName || "").localeCompare(b.machineName || "");
  });

  const rawLogRows: (string | number)[][] = sortedFiltered.map(formatEnrichedLogRow);
  const rawLogTotals: (string | number)[] = [
    "TOTALS / OVERALL",
    "-",
    "-",
    "-",
    "-",
    "-",
    sortedFiltered.length,
    "-",
    "-",
    "-",
    "-",
    "-",
    overallMetrics.totalOvertimeMinutes,
    overallMetrics.plannedMinutes,
    overallMetrics.operatingMinutes,
    overallMetrics.totalStd,
    overallMetrics.totalActual,
    overallMetrics.goodOutput,
    overallMetrics.totalRework,
    `${overallMetrics.planAchievementPct}%`,
    overallMetrics.breakdownTotals.noDisc,
    overallMetrics.breakdownTotals.change,
    overallMetrics.breakdownTotals.power,
    overallMetrics.breakdownTotals.operator,
    overallMetrics.breakdownTotals.machineBreakdown,
    overallMetrics.breakdownTotals.fixProgSettings,
    overallMetrics.breakdownTotals.miscellaneous,
    overallMetrics.downtimeMinutes,
    `${overallMetrics.availabilityPct}%`,
    `${overallMetrics.qualityPct}%`,
    `${overallMetrics.oeePct}%`,
    "-",
  ];

  const ws7 = buildStyledWorksheet({
    title: "Filtered Shift Production Logs",
    metadata: metadataList,
    sectionTitle: "DETAILED AUDIT LOGS FOR ACTIVE FILTER RANGE",
    headers: rawLogHeaders,
    rows: rawLogRows,
    totalsRow: rawLogTotals,
  });
  XLSX.utils.book_append_sheet(wb, ws7, sanitizeSheetName("Filtered Shift Logs", usedNames));

  const filename = `Analytics_Report_${formatDateRangeFileTag(
    activeFilters.fromDate,
    activeFilters.toDate
  )}.xlsx`;
  XLSX.writeFile(wb, filename);
}

// ============================================================================
// EXPORT ACTION 4: Active Analytics Tab Workbook (2 Sheets)
// ============================================================================

export interface ExportActiveAnalyticsTabParams {
  tab: "product" | "line" | "shift" | "period" | "machine";
  filteredRows: EnrichedAnalyticsRow[];
  activeFilters: ActiveFiltersMetadata;
  periodGranularity?: "day" | "week";
  masterData?: MasterDataState;
  shiftItemTotals?: ShiftItemProductionRow[];
  machineGroupBy?: MachineGroupByMode;
  groupedMachines?: MachineMatrixGroup[];
}

export function exportActiveAnalyticsTabExcel(params: ExportActiveAnalyticsTabParams): void {
  const {
    tab,
    filteredRows,
    activeFilters,
    periodGranularity = "day",
    masterData,
    shiftItemTotals,
    machineGroupBy = "none",
    groupedMachines,
  } = params;
  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  const overallMetrics = calculateOeeMetrics(filteredRows);
  const metadataList = buildFilterMetadataList(activeFilters);

  let tabSheetTitle = "Analytics Matrix";
  let tabSectionTitle = "MAIN DATA TABLE";
  let tabHeaders: string[] = [];
  let tabRows: (string | number)[][] = [];
  let tabTotals: (string | number)[] = [];
  let tabRowStyleHints: Record<number, "group_header" | "group_subtotal"> | undefined;

  if (tab === "product") {
    tabSheetTitle = "Product Matrix";
    tabSectionTitle = "PRODUCT TRACEABILITY & SPLIT RUNS MATRIX";
    tabHeaders = [
      "Product Name",
      "Product Code",
      "Line",
      "Machine",
      "Temp?",
      "Split Runs",
      "Operation",
      "Runs",
      "Std Output",
      "Actual Output",
      "Good Output",
      "Rework",
      "Plan %",
      "NO/DISC",
      "CHANGE",
      "POWER",
      "OPERATOR",
      "BREAK DOWN",
      "FIX/PROG",
      "MISC.",
      "Total BD (m)",
      "Avail %",
      "Qual %",
      "OEE %",
    ];

    const products = buildProductLineMachineMatrix(filteredRows, shiftItemTotals);
    for (const p of products) {
      for (const m of p.matrix) {
        tabRows.push([
          p.productName,
          p.productCode || "—",
          m.line,
          m.machineName,
          m.isTempMachine ? "TEMP" : "Perm",
          m.splitRunsCount > 0 ? `Split (${m.runNos.join(",")})` : "1",
          m.operation,
          m.metrics.rowCount,
          m.stdOutput,
          m.actualOutput,
          m.goodOutput,
          m.rework,
          `${m.metrics.planAchievementPct}%`,
          m.metrics.breakdownTotals.noDisc,
          m.metrics.breakdownTotals.change,
          m.metrics.breakdownTotals.power,
          m.metrics.breakdownTotals.operator,
          m.metrics.breakdownTotals.machineBreakdown,
          m.metrics.breakdownTotals.fixProgSettings,
          m.metrics.breakdownTotals.miscellaneous,
          m.breakdownMinutes,
          `${m.metrics.availabilityPct}%`,
          `${m.metrics.qualityPct}%`,
          `${m.metrics.oeePct}%`,
        ]);
      }
    }

    tabTotals = [
      "TOTALS / OVERALL",
      "-",
      "-",
      `${filteredRows.length} runs`,
      "-",
      "-",
      "-",
      overallMetrics.rowCount,
      overallMetrics.totalStd,
      overallMetrics.totalActual,
      overallMetrics.goodOutput,
      overallMetrics.totalRework,
      `${overallMetrics.planAchievementPct}%`,
      overallMetrics.breakdownTotals.noDisc,
      overallMetrics.breakdownTotals.change,
      overallMetrics.breakdownTotals.power,
      overallMetrics.breakdownTotals.operator,
      overallMetrics.breakdownTotals.machineBreakdown,
      overallMetrics.breakdownTotals.fixProgSettings,
      overallMetrics.breakdownTotals.miscellaneous,
      overallMetrics.downtimeMinutes,
      `${overallMetrics.availabilityPct}%`,
      `${overallMetrics.qualityPct}%`,
      `${overallMetrics.oeePct}%`,
    ];
  } else if (tab === "line") {
    tabSheetTitle = "Line Performance";
    tabSectionTitle = "PRODUCTION LINE EFFICIENCY & BALANCING";
    tabHeaders = [
      "Line Name",
      "Total Machines",
      "Perm Machines",
      "Temp Machines",
      "Target (Std)",
      "Actual Output",
      "Good Output",
      "Total Prod (Pre-QC)",
      "Rework",
      "Plan %",
      "Downtime (m)",
      "Avail %",
      "Qual %",
      "Line OEE %",
    ];

    const lines = groupByLine(filteredRows, shiftItemTotals);
    tabRows = lines.map((l) => [
      l.line,
      l.machineCount,
      l.permMachineCount,
      l.tempMachineCount,
      l.metrics.totalStd,
      l.metrics.totalActual,
      l.metrics.goodOutput,
      l.preQcProduction ?? l.finishedProduction ?? 0,
      l.metrics.totalRework,
      `${l.metrics.planAchievementPct}%`,
      l.metrics.downtimeMinutes,
      `${l.metrics.availabilityPct}%`,
      `${l.metrics.qualityPct}%`,
      `${l.metrics.oeePct}%`,
    ]);

    tabTotals = [
      "PLANT TOTAL",
      lines.reduce((acc, l) => acc + l.machineCount, 0),
      lines.reduce((acc, l) => acc + l.permMachineCount, 0),
      lines.reduce((acc, l) => acc + l.tempMachineCount, 0),
      overallMetrics.totalStd,
      overallMetrics.totalActual,
      overallMetrics.goodOutput,
      lines.reduce((acc, l) => acc + (l.preQcProduction ?? l.finishedProduction ?? 0), 0),
      overallMetrics.totalRework,
      `${overallMetrics.planAchievementPct}%`,
      overallMetrics.downtimeMinutes,
      `${overallMetrics.availabilityPct}%`,
      `${overallMetrics.qualityPct}%`,
      `${overallMetrics.oeePct}%`,
    ];
  } else if (tab === "shift") {
    tabSheetTitle = "Shift Efficiency";
    tabSectionTitle = "SHIFT EFFICIENCY & COMPARISON";
    tabHeaders = [
      "Shift Name",
      "Active Machines",
      "Target (Std)",
      "Actual Output",
      "Good Output",
      "Total Prod (Pre-QC)",
      "Rework",
      "Plan %",
      "Downtime (m)",
      "Avail %",
      "Qual %",
      "Shift OEE %",
    ];

    const shifts = groupByShift(filteredRows, shiftItemTotals);
    tabRows = shifts.map((s) => [
      s.shift,
      s.machineCount,
      s.metrics.totalStd,
      s.metrics.totalActual,
      s.metrics.goodOutput,
      s.preQcProduction ?? s.finishedProduction ?? 0,
      s.metrics.totalRework,
      `${s.metrics.planAchievementPct}%`,
      s.metrics.downtimeMinutes,
      `${s.metrics.availabilityPct}%`,
      `${s.metrics.qualityPct}%`,
      `${s.metrics.oeePct}%`,
    ]);

    tabTotals = [
      "PLANT TOTAL",
      "-",
      overallMetrics.totalStd,
      overallMetrics.totalActual,
      overallMetrics.goodOutput,
      shifts.reduce((acc, s) => acc + (s.preQcProduction ?? s.finishedProduction ?? 0), 0),
      overallMetrics.totalRework,
      `${overallMetrics.planAchievementPct}%`,
      overallMetrics.downtimeMinutes,
      `${overallMetrics.availabilityPct}%`,
      `${overallMetrics.qualityPct}%`,
      `${overallMetrics.oeePct}%`,
    ];
  } else if (tab === "period") {
    tabSheetTitle = periodGranularity === "week" ? "Weekly Trends" : "Daily Trends";
    tabSectionTitle = `CHRONOLOGICAL PERFORMANCE TRENDS (${periodGranularity.toUpperCase()})`;
    const periodHeader = periodGranularity === "week" ? "ISO Week Range" : "Date";
    tabHeaders = [
      periodHeader,
      "Items Count",
      "Target (Std)",
      "Actual Output",
      "Good Output",
      "Total Prod (Pre-QC)",
      "Rework",
      "Plan %",
      "Downtime (m)",
      "Avail %",
      "Qual %",
      "Period OEE %",
    ];

    const periods = groupByPeriod(filteredRows, periodGranularity, shiftItemTotals, masterData?.items);
    tabRows = periods.map((p) => [
      p.periodLabel,
      p.itemsProduced.length,
      p.metrics.totalStd,
      p.metrics.totalActual,
      p.metrics.goodOutput,
      p.preQcProduction ?? p.finishedProduction ?? 0,
      p.metrics.totalRework,
      `${p.metrics.planAchievementPct}%`,
      p.metrics.downtimeMinutes,
      `${p.metrics.availabilityPct}%`,
      `${p.metrics.qualityPct}%`,
      `${p.metrics.oeePct}%`,
    ]);

    tabTotals = [
      "TOTAL / OVERALL",
      "-",
      overallMetrics.totalStd,
      overallMetrics.totalActual,
      overallMetrics.goodOutput,
      periods.reduce((acc, p) => acc + (p.preQcProduction ?? p.finishedProduction ?? 0), 0),
      overallMetrics.totalRework,
      `${overallMetrics.planAchievementPct}%`,
      overallMetrics.downtimeMinutes,
      `${overallMetrics.availabilityPct}%`,
      `${overallMetrics.qualityPct}%`,
      `${overallMetrics.oeePct}%`,
    ];
  } else {
    // Machine
    tabSheetTitle = "Machine Matrix";

    if (machineGroupBy !== "none") {
      const groups =
        groupedMachines && groupedMachines.length > 0
          ? groupedMachines
          : buildGroupedMachineMatrix(
              filteredRows,
              machineGroupBy,
              (a, b) => b.metrics.oeePct - a.metrics.oeePct,
              shiftItemTotals,
              masterData?.items
            );

      const groupLabelTitle = machineGroupBy === "line" ? "Line Group" : "Item Group";
      metadataList.push({
        label: "Group Mode",
        value: machineGroupBy === "line" ? "Grouped by Line" : "Grouped by Item",
      });
      tabSectionTitle =
        machineGroupBy === "line"
          ? "MACHINE MATRIX & RANKING (GROUPED BY LINE)"
          : "MACHINE MATRIX & RANKING (GROUPED BY ITEM)";

      tabHeaders = [
        groupLabelTitle,
        "Machine Name",
        "Machine ID",
        "Line",
        "Type",
        "Split Runs",
        "Target (Std)",
        "Actual Output",
        "Good Output",
        "Rework",
        "Plan %",
        "Downtime (m)",
        "Avail %",
        "Qual %",
        "Machine OEE %",
      ];

      tabRowStyleHints = {};
      let totalMachinesAllocated = 0;
      let totalSplitRuns = 0;

      for (const group of groups) {
        const displayGroupName = group.groupSubLabel
          ? `${group.groupLabel} (${group.groupSubLabel})`
          : group.groupLabel;

        const headerRowIdx = tabRows.length;
        tabRowStyleHints[headerRowIdx] = "group_header";
        tabRows.push([
          displayGroupName,
          `${group.machinesCount} Machines`,
          group.groupType === "item" && group.groupKey !== "__unspecified__"
            ? `Pre-QC: ${(group.preQcProduction ?? 0).toLocaleString()} pcs`
            : "—",
          group.groupType === "line" ? group.groupLabel : "—",
          "—",
          group.machines.reduce((acc, m) => acc + m.splitRunsCount, 0),
          group.metrics.totalStd,
          group.metrics.totalActual,
          group.metrics.goodOutput,
          group.metrics.totalRework,
          `${group.metrics.planAchievementPct}%`,
          group.metrics.downtimeMinutes,
          `${group.metrics.availabilityPct}%`,
          `${group.metrics.qualityPct}%`,
          `${group.metrics.oeePct}%`,
        ]);

        for (const m of group.machines) {
          totalMachinesAllocated++;
          totalSplitRuns += m.splitRunsCount;
          tabRows.push([
            displayGroupName,
            m.machineName,
            m.machineId,
            m.line,
            m.isTempMachine ? "TEMP" : "Perm",
            m.splitRunsCount,
            m.metrics.totalStd,
            m.metrics.totalActual,
            m.metrics.goodOutput,
            m.metrics.totalRework,
            `${m.metrics.planAchievementPct}%`,
            m.metrics.downtimeMinutes,
            `${m.metrics.availabilityPct}%`,
            `${m.metrics.qualityPct}%`,
            `${m.metrics.oeePct}%`,
          ]);
        }

        const subIdx = tabRows.length;
        tabRowStyleHints[subIdx] = "group_subtotal";
        tabRows.push([
          `${displayGroupName} — Subtotal`,
          `${group.machinesCount} machines`,
          "—",
          "—",
          "—",
          group.machines.reduce((acc, m) => acc + m.splitRunsCount, 0),
          group.metrics.totalStd,
          group.metrics.totalActual,
          group.metrics.goodOutput,
          group.metrics.totalRework,
          `${group.metrics.planAchievementPct}%`,
          group.metrics.downtimeMinutes,
          `${group.metrics.availabilityPct}%`,
          `${group.metrics.qualityPct}%`,
          `${group.metrics.oeePct}%`,
        ]);
      }

      tabTotals = [
        "TOTALS / OVERALL",
        `${totalMachinesAllocated} machine entries (${groups.length} groups)`,
        "—",
        "—",
        "—",
        totalSplitRuns,
        overallMetrics.totalStd,
        overallMetrics.totalActual,
        overallMetrics.goodOutput,
        overallMetrics.totalRework,
        `${overallMetrics.planAchievementPct}%`,
        overallMetrics.downtimeMinutes,
        `${overallMetrics.availabilityPct}%`,
        `${overallMetrics.qualityPct}%`,
        `${overallMetrics.oeePct}%`,
      ];
    } else {
      tabSectionTitle = "MACHINE MATRIX & RANKING";
      tabHeaders = [
        "Machine Name",
        "Machine ID",
        "Line",
        "Type",
        "Split Runs",
        "Target (Std)",
        "Actual Output",
        "Good Output",
        "Rework",
        "Plan %",
        "Downtime (m)",
        "Avail %",
        "Qual %",
        "Machine OEE %",
      ];

      const machines =
        groupedMachines && groupedMachines[0]
          ? groupedMachines[0].machines
          : groupByMachine(filteredRows);
      tabRows = machines.map((m) => [
        m.machineName,
        m.machineId,
        m.line,
        m.isTempMachine ? "TEMP" : "Perm",
        m.splitRunsCount,
        m.metrics.totalStd,
        m.metrics.totalActual,
        m.metrics.goodOutput,
        m.metrics.totalRework,
        `${m.metrics.planAchievementPct}%`,
        m.metrics.downtimeMinutes,
        `${m.metrics.availabilityPct}%`,
        `${m.metrics.qualityPct}%`,
        `${m.metrics.oeePct}%`,
      ]);

      tabTotals = [
        "TOTALS / OVERALL",
        `${machines.length} machines`,
        "-",
        "-",
        machines.reduce((acc, m) => acc + m.splitRunsCount, 0),
        overallMetrics.totalStd,
        overallMetrics.totalActual,
        overallMetrics.goodOutput,
        overallMetrics.totalRework,
        `${overallMetrics.planAchievementPct}%`,
        overallMetrics.downtimeMinutes,
        `${overallMetrics.availabilityPct}%`,
        `${overallMetrics.qualityPct}%`,
        `${overallMetrics.oeePct}%`,
      ];
    }
  }

  const ws1 = buildStyledWorksheet({
    title: tabSheetTitle,
    metadata: metadataList,
    sectionTitle: tabSectionTitle,
    headers: tabHeaders,
    rows: tabRows,
    totalsRow: tabTotals,
    rowStyleHints: tabRowStyleHints,
  });
  XLSX.utils.book_append_sheet(wb, ws1, sanitizeSheetName(tabSheetTitle, usedNames));

  // Supporting Daily Shift-Item sheet when exporting Chronological Trends (By Day)
  if (tab === "period" && periodGranularity === "day") {
    appendDailyShiftItemSheet({
      wb,
      usedNames,
      filteredRows,
      shiftItemTotals,
      masterData,
      metadataList,
      overallMetrics,
    });
  }

  // Sheet 2: Supporting Shift Logs
  const shiftLogsHeaders = [
    "Date",
    "Shift",
    "Line",
    "Machine",
    "Machine ID",
    "Temp?",
    "Run #",
    "Operator",
    "Item Name",
    "Item Code",
    "Operation",
    "Cycle Time",
    "OT (m)",
    "Planned Mins",
    "Operating Mins",
    "Std Output",
    "Actual Output",
    "Good Output",
    "Rework",
    "Plan %",
    "NO/DISC",
    "CHANGE",
    "POWER",
    "OPERATOR",
    "BREAK DOWN",
    "FIX/PROG",
    "MISC.",
    "Total BD (m)",
    "Avail %",
    "Qual %",
    "OEE %",
    "Remarks",
  ];

  const sortedFiltered = [...filteredRows].sort((a, b) => {
    const dCmp = (b.date || "").localeCompare(a.date || "");
    if (dCmp !== 0) return dCmp;
    const sCmp = (a.shift || "").localeCompare(b.shift || "");
    if (sCmp !== 0) return sCmp;
    return (a.machineName || "").localeCompare(b.machineName || "");
  });

  const shiftLogsRows: (string | number)[][] = sortedFiltered.map(formatEnrichedLogRow);
  const shiftLogsTotals: (string | number)[] = [
    "TOTALS / OVERALL",
    "-",
    "-",
    "-",
    "-",
    "-",
    sortedFiltered.length,
    "-",
    "-",
    "-",
    "-",
    "-",
    overallMetrics.totalOvertimeMinutes,
    overallMetrics.plannedMinutes,
    overallMetrics.operatingMinutes,
    overallMetrics.totalStd,
    overallMetrics.totalActual,
    overallMetrics.goodOutput,
    overallMetrics.totalRework,
    `${overallMetrics.planAchievementPct}%`,
    overallMetrics.breakdownTotals.noDisc,
    overallMetrics.breakdownTotals.change,
    overallMetrics.breakdownTotals.power,
    overallMetrics.breakdownTotals.operator,
    overallMetrics.breakdownTotals.machineBreakdown,
    overallMetrics.breakdownTotals.fixProgSettings,
    overallMetrics.breakdownTotals.miscellaneous,
    overallMetrics.downtimeMinutes,
    `${overallMetrics.availabilityPct}%`,
    `${overallMetrics.qualityPct}%`,
    `${overallMetrics.oeePct}%`,
    "-",
  ];

  const ws2 = buildStyledWorksheet({
    title: "Supporting Shift Production Logs",
    metadata: metadataList,
    sectionTitle: "DETAILED LOGS MATCHING ACTIVE FILTER",
    headers: shiftLogsHeaders,
    rows: shiftLogsRows,
    totalsRow: shiftLogsTotals,
  });
  XLSX.utils.book_append_sheet(wb, ws2, sanitizeSheetName("Supporting Shift Logs", usedNames));

  const cleanTab = sanitizeFileName(tabSheetTitle);
  const filename = `Analytics_${cleanTab}_${formatDateRangeFileTag(
    activeFilters.fromDate,
    activeFilters.toDate
  )}.xlsx`;
  XLSX.writeFile(wb, filename);
}

// ============================================================================
// EXPORT ACTION 5: Machine Drilldown Detail Workbook (5 Sheets)
// ============================================================================

export interface ExportMachineDetailParams {
  machineAnalytics: MachineDetailAnalytics;
  fromDate: string;
  toDate: string;
  shiftFilter?: string;
  activeFilters?: {
    line?: string;
    operator?: string;
  };
}

export function exportMachineDetailExcel(params: ExportMachineDetailParams): void {
  const { machineAnalytics, fromDate, toDate, shiftFilter = "ALL" } = params;
  const {
    machineMeta,
    overallMetrics,
    configuredCapabilities,
    operationsPerformed,
    operatorBreakdown,
    dailySummary,
    shiftLogHistory,
  } = machineAnalytics;

  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  const commonMeta = [
    { label: "MACHINE NAME", value: machineMeta.name },
    { label: "MACHINE ID", value: machineMeta.id },
    { label: "LINE", value: machineMeta.line },
    { label: "MACHINE TYPE", value: machineMeta.isTempMachine ? "Temporary Machine (TEMP)" : "Permanent Machine" },
    {
      label: fromDate && toDate && fromDate === toDate ? "DATE" : "DATE RANGE",
      value: formatDateRangeValue(fromDate, toDate),
    },
    { label: "SHIFT FILTER", value: shiftFilter },
    { label: "EXPORTED AT", value: new Date().toLocaleString() },
  ];

  // --------------------------------------------------------------------------
  // Sheet 1: Machine Summary
  // --------------------------------------------------------------------------
  const summaryKpis = [
    { label: "Machine OEE %", value: `${overallMetrics.oeePct}%` },
    { label: "Availability %", value: `${overallMetrics.availabilityPct}%` },
    { label: "Plan %", value: `${overallMetrics.planAchievementPct}%` },
    { label: "Quality %", value: `${overallMetrics.qualityPct}%` },
    { label: "Actual Output", value: `${overallMetrics.totalActual} pcs` },
    { label: "Target (Std)", value: `${overallMetrics.totalStd} pcs` },
    { label: "Good Output", value: `${overallMetrics.goodOutput} pcs` },
    { label: "Total Downtime", value: `${overallMetrics.downtimeMinutes} mins` },
    {
      label: "Total OT Hours",
      value: `${(overallMetrics.totalOvertimeMinutes / 60).toFixed(1)} hrs (${overallMetrics.totalOvertimeMinutes}m)`,
    },
  ];

  const oeeSection: StyledWorksheetSection = {
    sectionTitle: "OVERALL 4-METRIC OEE KPIS",
    headers: ["Metric", "Value", "Notes / Unit"],
    rows: [
      ["Machine OEE %", `${overallMetrics.oeePct}%`, "Good Run Time / Planned Shift Time"],
      ["Availability %", `${overallMetrics.availabilityPct}%`, "Operating Time / Planned Shift Time"],
      ["Plan Achievement %", `${overallMetrics.planAchievementPct}%`, "Actual Output / Scheduled Target (Std)"],
      ["Quality %", `${overallMetrics.qualityPct}%`, "Good Output / Actual Output"],
    ],
  };

  const volumeSection: StyledWorksheetSection = {
    sectionTitle: "PRODUCTION VOLUME TOTALS",
    headers: ["Metric", "Value", "Unit"],
    rows: [
      ["Scheduled Target (Std)", overallMetrics.totalStd, "pcs"],
      ["Actual Output", overallMetrics.totalActual, "pcs"],
      ["Good Output", overallMetrics.goodOutput, "pcs"],
      ["Rework Output", overallMetrics.totalRework, "pcs"],
    ],
  };

  const timeSection: StyledWorksheetSection = {
    sectionTitle: "TIME UTILIZATION TOTALS",
    headers: ["Metric", "Value", "Unit"],
    rows: [
      ["Planned Shift Time", overallMetrics.plannedMinutes, "mins"],
      ["Overtime Logged", overallMetrics.totalOvertimeMinutes, "mins"],
      ["Operating Time", overallMetrics.operatingMinutes, "mins"],
      ["Total Breakdown Downtime", overallMetrics.downtimeMinutes, "mins"],
      ["Ideal Run Time", overallMetrics.idealRunMinutes, "mins"],
      ["Total Shift Runs", overallMetrics.rowCount, "runs"],
    ],
  };

  const dtHeaders = ["Category Code", "Category Name", "Downtime (mins)", "% of Total Downtime"];
  const dtRows = [
    [
      "NO/DISC",
      "No Operator / Discussion",
      overallMetrics.breakdownTotals.noDisc,
      overallMetrics.downtimeMinutes > 0
        ? `${Math.round((overallMetrics.breakdownTotals.noDisc / overallMetrics.downtimeMinutes) * 100)}%`
        : "0%",
    ],
    [
      "CHANGE",
      "Tool / Insert / Setup Change",
      overallMetrics.breakdownTotals.change,
      overallMetrics.downtimeMinutes > 0
        ? `${Math.round((overallMetrics.breakdownTotals.change / overallMetrics.downtimeMinutes) * 100)}%`
        : "0%",
    ],
    [
      "POWER",
      "Power Interruption / Failure",
      overallMetrics.breakdownTotals.power,
      overallMetrics.downtimeMinutes > 0
        ? `${Math.round((overallMetrics.breakdownTotals.power / overallMetrics.downtimeMinutes) * 100)}%`
        : "0%",
    ],
    [
      "OPERATOR",
      "Operator Absence / Relief Delay",
      overallMetrics.breakdownTotals.operator,
      overallMetrics.downtimeMinutes > 0
        ? `${Math.round((overallMetrics.breakdownTotals.operator / overallMetrics.downtimeMinutes) * 100)}%`
        : "0%",
    ],
    [
      "BREAK DOWN",
      "Mechanical / Electrical Breakdown",
      overallMetrics.breakdownTotals.machineBreakdown,
      overallMetrics.downtimeMinutes > 0
        ? `${Math.round((overallMetrics.breakdownTotals.machineBreakdown / overallMetrics.downtimeMinutes) * 100)}%`
        : "0%",
    ],
    [
      "FIX/PROG",
      "Fixture / Program Settings Adjustment",
      overallMetrics.breakdownTotals.fixProgSettings,
      overallMetrics.downtimeMinutes > 0
        ? `${Math.round((overallMetrics.breakdownTotals.fixProgSettings / overallMetrics.downtimeMinutes) * 100)}%`
        : "0%",
    ],
    [
      "MISC.",
      "Miscellaneous / Shop Floor Unplanned",
      overallMetrics.breakdownTotals.miscellaneous,
      overallMetrics.downtimeMinutes > 0
        ? `${Math.round((overallMetrics.breakdownTotals.miscellaneous / overallMetrics.downtimeMinutes) * 100)}%`
        : "0%",
    ],
  ];
  const dtTotals = ["TOTAL", "Total Machine Downtime", overallMetrics.downtimeMinutes, "100%"];

  const ws1 = buildStyledWorksheet({
    title: `Machine Analytics Drilldown Report — ${machineMeta.name}`,
    metadata: commonMeta,
    kpiStrip: summaryKpis,
    extraSections: [oeeSection, volumeSection, timeSection],
    sectionTitle: "7-CATEGORY DOWNTIME BREAKDOWN",
    headers: dtHeaders,
    rows: dtRows,
    totalsRow: dtTotals,
  });
  XLSX.utils.book_append_sheet(wb, ws1, sanitizeSheetName("Machine Summary", usedNames));

  // --------------------------------------------------------------------------
  // Sheet 2: Capabilities & Ops
  // --------------------------------------------------------------------------
  const capSection: StyledWorksheetSection = {
    sectionTitle: "CONFIGURED MACHINE CAPABILITIES (MASTER DATA)",
    headers: ["Part / Item Name", "Item Code", "Operation", "Cycle Time (mins)"],
    rows:
      configuredCapabilities.length === 0
        ? [["No master capabilities configured for this machine", "-", "-", "-"]]
        : configuredCapabilities.map((c) => [c.itemName, c.itemCode || "—", c.operation, c.cycleTime]),
  };

  const opsHeaders = [
    "Part / Item Name",
    "Item Code",
    "Operation",
    "Runs",
    "Avg CT (mins)",
    "Target (Std)",
    "Actual Output",
    "Good Output",
    "Rework",
    "Downtime (mins)",
    "Avail %",
    "Qual %",
    "OEE %",
  ];
  const opsRows =
    operationsPerformed.length === 0
      ? [["No production recorded for this machine in the selected period", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-"]]
      : operationsPerformed.map((op) => [
          op.itemName,
          op.itemCode || "—",
          op.operation,
          op.runsCount,
          op.avgCycleTime,
          op.stdOutput,
          op.actualOutput,
          op.goodOutput,
          op.rework,
          op.downtimeMinutes,
          `${op.availabilityPct}%`,
          `${op.qualityPct}%`,
          `${op.oeePct}%`,
        ]);
  const opsTotals =
    operationsPerformed.length === 0
      ? undefined
      : [
          "TOTALS / OVERALL",
          "-",
          "-",
          operationsPerformed.reduce((acc, o) => acc + o.runsCount, 0),
          "-",
          overallMetrics.totalStd,
          overallMetrics.totalActual,
          overallMetrics.goodOutput,
          overallMetrics.totalRework,
          overallMetrics.downtimeMinutes,
          `${overallMetrics.availabilityPct}%`,
          `${overallMetrics.qualityPct}%`,
          `${overallMetrics.oeePct}%`,
        ];

  const ws2 = buildStyledWorksheet({
    title: `Machine Capabilities & Operations — ${machineMeta.name}`,
    metadata: commonMeta,
    extraSections: [capSection],
    sectionTitle: "OPERATIONS PERFORMED IN SELECTED PERIOD",
    headers: opsHeaders,
    rows: opsRows,
    totalsRow: opsTotals,
  });
  XLSX.utils.book_append_sheet(wb, ws2, sanitizeSheetName("Capabilities & Ops", usedNames));

  // --------------------------------------------------------------------------
  // Sheet 3: Operators
  // --------------------------------------------------------------------------
  const opHeaders = [
    "Operator Name",
    "Shifts Count",
    "Runs Count",
    "Items Worked",
    "Target (Std)",
    "Actual Output",
    "Good Output",
    "Rework",
    "Downtime (mins)",
    "Plan %",
    "OEE %",
  ];
  const opRows =
    operatorBreakdown.length === 0
      ? [["No operators recorded for this machine", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-"]]
      : operatorBreakdown.map((ob) => [
          ob.operatorName,
          ob.shiftsCount,
          ob.runsCount,
          ob.itemsRun.join(", ") || "—",
          ob.stdOutput,
          ob.actualOutput,
          ob.goodOutput,
          ob.rework,
          ob.downtimeMinutes,
          `${ob.planAchievementPct}%`,
          `${ob.oeePct}%`,
        ]);
  const opTotals =
    operatorBreakdown.length === 0
      ? undefined
      : [
          "TOTALS / OVERALL",
          "-",
          operatorBreakdown.reduce((acc, o) => acc + o.runsCount, 0),
          "-",
          overallMetrics.totalStd,
          overallMetrics.totalActual,
          overallMetrics.goodOutput,
          overallMetrics.totalRework,
          overallMetrics.downtimeMinutes,
          `${overallMetrics.planAchievementPct}%`,
          `${overallMetrics.oeePct}%`,
        ];

  const ws3 = buildStyledWorksheet({
    title: `Operator Performance Breakdown — ${machineMeta.name}`,
    metadata: commonMeta,
    sectionTitle: "OPERATOR PERFORMANCE ON THIS MACHINE",
    headers: opHeaders,
    rows: opRows,
    totalsRow: opTotals,
  });
  XLSX.utils.book_append_sheet(wb, ws3, sanitizeSheetName("Operators", usedNames));

  // --------------------------------------------------------------------------
  // Sheet 4: Daily Breakdown (Separated by Date, Item, Operation)
  // --------------------------------------------------------------------------
  const dailyHeaders = [
    "Date",
    "Item Name",
    "Item Code",
    "Operation",
    "Shifts",
    "Runs",
    "Avg CT (mins)",
    "OT (m)",
    "Target (Std)",
    "Actual Output",
    "Good Output",
    "Rework",
    "Downtime (mins)",
    "Avail %",
    "Qual %",
    "OEE %",
    "Type",
  ];
  const dailyRows =
    dailySummary.length === 0
      ? [["No daily production records found", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-"]]
      : dailySummary.map((d) => [
          d.date,
          d.itemName,
          d.itemCode || "—",
          d.operation,
          d.shiftsRun.join(", "),
          d.runsCount,
          d.avgCycleTime,
          d.overtimeMinutes,
          d.stdOutput,
          d.actualOutput,
          d.goodOutput,
          d.rework,
          d.downtimeMinutes,
          `${d.availabilityPct}%`,
          d.isDowntimeOnly ? "—" : `${d.qualityPct}%`,
          d.isDowntimeOnly ? "—" : `${d.oeePct}%`,
          d.isDowntimeOnly ? "Downtime Only" : "Production",
        ]);
  const dailyTotals =
    dailySummary.length === 0
      ? undefined
      : [
          "TOTALS / OVERALL",
          "-",
          "-",
          "-",
          "-",
          dailySummary.reduce((acc, d) => acc + d.runsCount, 0),
          "-",
          overallMetrics.totalOvertimeMinutes,
          overallMetrics.totalStd,
          overallMetrics.totalActual,
          overallMetrics.goodOutput,
          overallMetrics.totalRework,
          overallMetrics.downtimeMinutes,
          `${overallMetrics.availabilityPct}%`,
          `${overallMetrics.qualityPct}%`,
          `${overallMetrics.oeePct}%`,
          "-",
        ];

  const ws4 = buildStyledWorksheet({
    title: `Daily Manufacturing Breakdown — ${machineMeta.name}`,
    metadata: commonMeta,
    sectionTitle: "DAILY BREAKDOWN SEPARATED BY ITEM & OPERATION",
    headers: dailyHeaders,
    rows: dailyRows,
    totalsRow: dailyTotals,
  });
  XLSX.utils.book_append_sheet(wb, ws4, sanitizeSheetName("Daily Breakdown", usedNames));

  // --------------------------------------------------------------------------
  // Sheet 5: Shift-by-Shift Logs
  // --------------------------------------------------------------------------
  const shiftLogHeaders = [
    "Date",
    "Shift",
    "Line",
    "Run #",
    "Split Run?",
    "Operator",
    "Item Name",
    "Operation",
    "Cycle Time",
    "OT (m)",
    "Target (Std)",
    "Actual Output",
    "Good Output",
    "Rework",
    "NO/DISC",
    "CHANGE",
    "POWER",
    "OPERATOR",
    "BREAK DOWN",
    "FIX/PROG",
    "MISC.",
    "Total BD (m)",
    "OEE %",
    "Remarks",
  ];
  const shiftLogRows =
    shiftLogHistory.length === 0
      ? [["No shift logs found for this machine", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-"]]
      : shiftLogHistory.map((s) => {
          const sGood = Math.max(0, (s.actualOutput || 0) - (s.rework || 0));
          return [
            s.date,
            s.shift,
            s.line,
            s.runNo,
            s.isSplitRun ? "Yes" : "No",
            s.operatorName,
            s.itemName,
            s.operation,
            s.cycleTime,
            s.overtimeMinutes,
            s.stdOutput,
            s.actualOutput,
            sGood,
            s.rework,
            round2(s.breakdown?.noDisc || 0),
            round2(s.breakdown?.change || 0),
            round2(s.breakdown?.power || 0),
            round2(s.breakdown?.operator || 0),
            round2(s.breakdown?.machineBreakdown || 0),
            round2(s.breakdown?.fixProgSettings || 0),
            round2(s.breakdown?.miscellaneous || 0),
            s.totalBdMinutes,
            `${s.oeePct}%`,
            s.remarks || "",
          ];
        });
  const shiftLogTotals =
    shiftLogHistory.length === 0
      ? undefined
      : [
          "TOTALS / OVERALL",
          "-",
          "-",
          "-",
          "-",
          "-",
          "-",
          "-",
          "-",
          overallMetrics.totalOvertimeMinutes,
          overallMetrics.totalStd,
          overallMetrics.totalActual,
          overallMetrics.goodOutput,
          overallMetrics.totalRework,
          overallMetrics.breakdownTotals.noDisc,
          overallMetrics.breakdownTotals.change,
          overallMetrics.breakdownTotals.power,
          overallMetrics.breakdownTotals.operator,
          overallMetrics.breakdownTotals.machineBreakdown,
          overallMetrics.breakdownTotals.fixProgSettings,
          overallMetrics.breakdownTotals.miscellaneous,
          overallMetrics.downtimeMinutes,
          `${overallMetrics.oeePct}%`,
          "-",
        ];

  const ws5 = buildStyledWorksheet({
    title: `Shift-by-Shift Production Logs — ${machineMeta.name}`,
    metadata: commonMeta,
    sectionTitle: "RAW SHIFT-BY-SHIFT EVENT HISTORY",
    headers: shiftLogHeaders,
    rows: shiftLogRows,
    totalsRow: shiftLogTotals,
  });
  XLSX.utils.book_append_sheet(wb, ws5, sanitizeSheetName("Shift-by-Shift Logs", usedNames));

  const cleanName = sanitizeFileName(machineMeta.name);
  const filename = `Machine_${cleanName}_${formatDateRangeFileTag(fromDate, toDate)}.xlsx`;
  XLSX.writeFile(wb, filename);
}

// ============================================================================
// EXPORT ACTION 6: Daily Sheet Tab View Workbook (2 Sheets)
// ============================================================================

export interface ExportDailySheetViewParams {
  date: string;
  line: string;
  shift: string;
  itemLabel: string;
  machineLabel: string;
  operatorLabel: string;
  rows: EnrichedAnalyticsRow[];
  itemProdRows: ShiftItemProductionRow[];
}

function getShiftSortRankExport(shift: string): number {
  const s = (shift || "").trim().toLowerCase();
  if (/^shift\s*a\b/.test(s)) return 1;
  if (/^shift\s*b\b/.test(s)) return 2;
  if (/^shift\s*c\b/.test(s)) return 3;
  return 4;
}

function compareShiftsExport(a: string, b: string): number {
  const rA = getShiftSortRankExport(a);
  const rB = getShiftSortRankExport(b);
  if (rA !== rB) return rA - rB;
  return a.localeCompare(b);
}

export function exportDailySheetViewExcel(params: ExportDailySheetViewParams): void {
  const {
    date,
    line,
    shift,
    itemLabel,
    machineLabel,
    operatorLabel,
    rows,
    itemProdRows,
  } = params;

  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();
  const isAllShifts = shift === "all";

  const metadataList: Array<{ label: string; value: string | number }> = [
    { label: "Report", value: "Daily Shift Sheet View" },
    { label: "Date", value: date || "—" },
    { label: "Line", value: line === "all" ? "All Lines" : line },
    { label: "Shift", value: isAllShifts ? "All Shifts" : shift },
    { label: "Item", value: itemLabel || "All Items" },
    { label: "Machine", value: machineLabel || "All Machines" },
    { label: "Operator", value: operatorLabel || "All Operators" },
    { label: "Quality Basis", value: "Pre-QC (100% Assumed)" },
    { label: "Exported At", value: new Date().toLocaleString() },
  ];

  // --------------------------------------------------------------------------
  // Sheet 1: Daily Shift Sheet
  // --------------------------------------------------------------------------
  const sortedRows = [...rows].sort((a, b) => {
    const dCmp = (a.date || "").localeCompare(b.date || "");
    if (dCmp !== 0) return dCmp;
    const sCmp = compareShiftsExport(a.shift || "", b.shift || "");
    if (sCmp !== 0) return sCmp;
    const lCmp = (a.line || "").localeCompare(b.line || "");
    if (lCmp !== 0) return lCmp;
    const srDiff = (Number(a.srNo) || 0) - (Number(b.srNo) || 0);
    if (srDiff !== 0) return srDiff;
    const mCmp = (a.machineName || "").localeCompare(b.machineName || "");
    if (mCmp !== 0) return mCmp;
    const idCmp = (a.machineId || "").localeCompare(b.machineId || "");
    if (idCmp !== 0) return idCmp;
    return (Number(a.runNo) || 1) - (Number(b.runNo) || 1);
  });

  const overallMetrics = calculateOeeMetrics(sortedRows);
  const overallBdPct =
    overallMetrics.plannedMinutes > 0
      ? round2((overallMetrics.downtimeMinutes / overallMetrics.plannedMinutes) * 100)
      : 0;

  const sheetHeaders = [
    ...(isAllShifts ? ["Shift"] : []),
    "Sr #",
    "Machine Name",
    "Line",
    "Operator",
    "Item",
    "Operation",
    "Cycle Time",
    "OT (m)",
    "Std Output",
    "Actual Output",
    "Rework",
    "NO/DISC",
    "CHANGE",
    "POWER",
    "OPERATOR",
    "BREAK DOWN",
    "FIX/PROG",
    "MISC.",
    "Total BD (m)",
    "BD %",
    "OEE %",
    "Remarks",
  ];

  const shiftColOffset = isAllShifts ? 1 : 0;
  const mergedColIndices = [
    7 + shiftColOffset,  // OT (m)
    11 + shiftColOffset, // NO/DISC
    12 + shiftColOffset, // CHANGE
    13 + shiftColOffset, // POWER
    14 + shiftColOffset, // OPERATOR
    15 + shiftColOffset, // BREAK DOWN
    16 + shiftColOffset, // FIX/PROG
    17 + shiftColOffset, // MISC.
    18 + shiftColOffset, // Total BD (m)
    19 + shiftColOffset, // BD %
  ];
  const sheetDataMerges: Array<{ startRowIndex: number; endRowIndex: number; colIndex: number }> = [];
  const sheetRows: (string | number)[][] = [];

  let i = 0;
  while (i < sortedRows.length) {
    const r0 = sortedRows[i];
    const isTemp = Boolean(r0.isTempMachine || r0.machineId?.startsWith("temp_"));
    const gKey = `${r0.date || ""}__${(r0.shift || "").toLowerCase()}__${(r0.line || "").toLowerCase()}__${r0.machineId || r0.machineName || ""}__${isTemp}`;
    let j = i + 1;
    while (j < sortedRows.length) {
      const next = sortedRows[j];
      const nextIsTemp = Boolean(next.isTempMachine || next.machineId?.startsWith("temp_"));
      const nextKey = `${next.date || ""}__${(next.shift || "").toLowerCase()}__${(next.line || "").toLowerCase()}__${next.machineId || next.machineName || ""}__${nextIsTemp}`;
      if (nextKey !== gKey) break;
      j++;
    }

    const group = sortedRows.slice(i, j);
    const isMergedGroup = isMergedSplitGroup(group);

    if (isMergedGroup) {
      const combined = extractCombinedSplitTotals(group);
      const groupTotalBd = round2(
        combined.noDisc +
          combined.change +
          combined.power +
          combined.operator +
          combined.machineBreakdown +
          combined.fixProgSettings +
          combined.miscellaneous
      );
      const groupWorkingMins = group.reduce(
        (sum, gr) => sum + (Number(gr.allocatedPlannedMinutes || gr.totalWorkingMinutes) || 0),
        0
      );
      const groupBdPct =
        groupWorkingMins > 0 ? round2((groupTotalBd / groupWorkingMins) * 100) : 0;

      const startRowIndex = i;
      const endRowIndex = j - 1;
      for (const colIndex of mergedColIndices) {
        sheetDataMerges.push({ startRowIndex, endRowIndex, colIndex });
      }

      group.forEach((r, splitIdx) => {
        const rowMetrics = calculateOeeMetrics([r]);
        const isFirst = splitIdx === 0;
        sheetRows.push([
          ...(isAllShifts ? [r.shift || "—"] : []),
          Number(r.srNo) || i + splitIdx + 1,
          `${r.isTempMachine ? `${r.machineName} [TEMP]` : r.machineName || "—"} (R${r.runNo || splitIdx + 1})`,
          r.line || "—",
          (r.operatorName || "").trim() || "—",
          r.itemName || r.itemId || "—",
          r.operation || "—",
          Number(r.cycleTime) || 0,
          isFirst ? combined.overtimeMinutes : "",
          Number(r.stdOutput) || 0,
          Number(r.actualOutput) || 0,
          Number(r.rework) || 0,
          isFirst ? combined.noDisc : "",
          isFirst ? combined.change : "",
          isFirst ? combined.power : "",
          isFirst ? combined.operator : "",
          isFirst ? combined.machineBreakdown : "",
          isFirst ? combined.fixProgSettings : "",
          isFirst ? combined.miscellaneous : "",
          isFirst ? groupTotalBd : "",
          isFirst ? `${groupBdPct}%` : "",
          `${rowMetrics.oeePct}%`,
          (r.remarks || "").trim() || "—",
        ]);
      });
    } else {
      group.forEach((r, offset) => {
        const bd = r.breakdown || {
          noDisc: 0,
          change: 0,
          power: 0,
          operator: 0,
          machineBreakdown: 0,
          fixProgSettings: 0,
          miscellaneous: 0,
        };
        const totalBd = round2(Number(r.totalBreakdownMinutes) || calculateTotalBreakdown(bd));
        const bdPct =
          r.allocatedPlannedMinutes > 0
            ? round2((totalBd / r.allocatedPlannedMinutes) * 100)
            : 0;
        const rowMetrics = calculateOeeMetrics([r]);

        sheetRows.push([
          ...(isAllShifts ? [r.shift || "—"] : []),
          Number(r.srNo) || i + offset + 1,
          r.isTempMachine ? `${r.machineName} [TEMP]` : r.machineName || "—",
          r.line || "—",
          (r.operatorName || "").trim() || "—",
          r.itemName || r.itemId || "—",
          r.operation || "—",
          Number(r.cycleTime) || 0,
          Math.max(0, Number(r.overtimeMinutes) || 0),
          Number(r.stdOutput) || 0,
          Number(r.actualOutput) || 0,
          Number(r.rework) || 0,
          round2(bd.noDisc || 0),
          round2(bd.change || 0),
          round2(bd.power || 0),
          round2(bd.operator || 0),
          round2(bd.machineBreakdown || 0),
          round2(bd.fixProgSettings || 0),
          round2(bd.miscellaneous || 0),
          totalBd,
          `${bdPct}%`,
          `${rowMetrics.oeePct}%`,
          (r.remarks || "").trim() || "—",
        ]);
      });
    }
    i = j;
  }

  const sheetTotals: (string | number)[] =
    sortedRows.length === 0
      ? []
      : [
          ...(isAllShifts ? ["TOTALS / OVERALL"] : []),
          isAllShifts ? `${sortedRows.length} runs` : "TOTALS / OVERALL",
          isAllShifts ? "—" : `${sortedRows.length} runs`,
          "—",
          "—",
          "—",
          "—",
          "—",
          overallMetrics.totalOvertimeMinutes,
          overallMetrics.totalStd,
          overallMetrics.totalActual,
          overallMetrics.totalRework,
          overallMetrics.breakdownTotals.noDisc,
          overallMetrics.breakdownTotals.change,
          overallMetrics.breakdownTotals.power,
          overallMetrics.breakdownTotals.operator,
          overallMetrics.breakdownTotals.machineBreakdown,
          overallMetrics.breakdownTotals.fixProgSettings,
          overallMetrics.breakdownTotals.miscellaneous,
          overallMetrics.downtimeMinutes,
          `${overallBdPct}%`,
          `${overallMetrics.oeePct}%`,
          "—",
        ];

  const ws1 = buildStyledWorksheet({
    title: `Daily Shift Sheet — ${date || "All Dates"}`,
    metadata: metadataList,
    sectionTitle: isAllShifts
      ? "DAILY SHIFT SHEET (ALL SHIFTS · SHIFT A → B → C)"
      : `DAILY SHIFT SHEET — ${shift.toUpperCase()}`,
    headers: sheetHeaders,
    rows: sheetRows,
    totalsRow: sheetTotals.length > 0 ? sheetTotals : undefined,
    dataMerges: sheetDataMerges.length > 0 ? sheetDataMerges : undefined,
  });
  XLSX.utils.book_append_sheet(wb, ws1, sanitizeSheetName("Daily Shift Sheet", usedNames));

  // --------------------------------------------------------------------------
  // Sheet 2: Pre-QC Item Production
  // --------------------------------------------------------------------------
  const sortedProd = [...itemProdRows].sort((a, b) => {
    const sCmp = compareShiftsExport(a.shift || "", b.shift || "");
    if (sCmp !== 0) return sCmp;
    const lCmp = (a.line || "").localeCompare(b.line || "");
    if (lCmp !== 0) return lCmp;
    return (a.itemName || a.itemCode || "").localeCompare(b.itemName || b.itemCode || "");
  });

  const prodHeaders = [
    "Date",
    "Line",
    "Shift",
    "Item",
    "Total Prod (Pre-QC)",
    "QC Passed (100%)",
    "Remarks",
  ];

  let sumPreQc = 0;
  let sumQcPassed = 0;

  const prodRows: (string | number)[][] = sortedProd.map((p) => {
    const qc = resolveProductQcMetrics(Number(p.totalProduction) || 0, true);
    sumPreQc += qc.preQcProduction;
    sumQcPassed += qc.qcPassed;
    const itemDisplay =
      p.itemCode &&
      p.itemCode.trim().toLowerCase() !== (p.itemName || "").trim().toLowerCase()
        ? `${p.itemName || p.itemCode} (${p.itemCode})`
        : p.itemName || p.itemCode || p.itemKey;

    return [
      p.date || date || "—",
      p.line || "—",
      p.shift || "—",
      itemDisplay,
      qc.preQcProduction,
      qc.qcPassed,
      (p.remarks || "").trim() || "—",
    ];
  });

  const prodTotals: (string | number)[] =
    sortedProd.length === 0
      ? []
      : [
          "TOTALS",
          "—",
          "—",
          `${sortedProd.length} entries`,
          sumPreQc,
          sumQcPassed,
          "—",
        ];

  const ws2 = buildStyledWorksheet({
    title: `Pre-QC Item Production — ${date || "All Dates"}`,
    metadata: metadataList,
    sectionTitle: "SHIFT FINISHED PRODUCTION (PRE-QC · 100% QC ASSUMED)",
    headers: prodHeaders,
    rows: prodRows,
    totalsRow: prodTotals.length > 0 ? prodTotals : undefined,
  });
  XLSX.utils.book_append_sheet(wb, ws2, sanitizeSheetName("Pre-QC Item Production", usedNames));

  const lineTag = sanitizeFileName(line === "all" ? "AllLines" : line);
  const shiftTag = sanitizeFileName(shift === "all" ? "AllShifts" : shift);
  const filename = `DailySheet_${date || "Report"}_${lineTag}_${shiftTag}.xlsx`;
  XLSX.writeFile(wb, filename);
}
