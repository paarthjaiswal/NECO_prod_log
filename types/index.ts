// Allow dynamic shift names from public.shifts while keeping autocomplete for defaults
export type ShiftType =
  | 'Shift A (6AM-2PM)'
  | 'Shift B (2PM-10PM)'
  | 'Shift C (10PM-6AM)'
  | (string & {});

export interface ProductionLineMaster {
  id: string;                  // e.g. 'line_1'
  name: string;                // e.g. 'Line 1'
  description?: string;
  dailyWorkingMinutes: number; // Default 1350
  isActive: boolean;
  sortOrder: number;
}

export interface ShiftMaster {
  id: string;                     // e.g. 'shift_a'
  shiftCode: string;              // e.g. 'Shift A'
  displayName: ShiftType;         // e.g. 'Shift A (6AM-2PM)'
  startTime: string;              // e.g. '06:00:00'
  endTime: string;                // e.g. '14:00:00'
  shiftWorkingMinutes: number;    // Default 450
  totalWorkingMinutesRef: number; // Default 1350
  isActive: boolean;
  sortOrder: number;
}

export interface MachineItemCycleTime {
  id?: number;
  machineId: string;
  itemId: string;
  operation: string;
  cycleTime: number; // Time to produce 1 unit
  stdOutput: number; // Specific target output for this Machine + Item + Operation
  isActive?: boolean;
}

export interface ItemMaster {
  id: string;
  itemCode: string;
  itemName: string;
  operation: string;
  stdOutput: number;
}

export interface BreakdownMinutes {
  noDisc: number;
  change: number;
  power: number;
  operator: number;
}

export interface BreakdownPercentages {
  noDiscPct: number;
  changePct: number;
  powerPct: number;
  operatorPct: number;
  totalBdMinutes: number;
  totalBdPct: number;
}

export interface MachineShiftRow {
  id: string;
  date: string;
  shift: ShiftType;
  line: string;
  srNo: number;
  machineId: string;
  machineName: string;
  operatorName: string;
  itemId: string;
  itemName: string;
  operation: string;
  cycleTime: number;           // NEW: Snapshotted cycle time
  totalWorkingMinutes: number; // NEW: Snapshotted working time (default 1350)
  stdOutput: number;
  actualOutput: number;
  rework: number;
  breakdown: BreakdownMinutes;
  breakdownPct?: BreakdownPercentages; // NEW: Read-only generated % from Postgres
  remarks: string;
  updatedAt?: string;
}

export interface MachineMaster {
  id: string;
  name: string;
  code: string;
  line?: string;
  type?: string;
  status?: 'active' | 'maintenance' | 'idle';
}

export interface MasterDataState {
  machines: MachineMaster[];
  operators: string[];
  items: ItemMaster[];
  lines?: ProductionLineMaster[];           // NEW: Dynamic lines from DB
  shifts?: ShiftMaster[];                   // NEW: Dynamic shifts from DB
  cycleTimes?: MachineItemCycleTime[];      // NEW: M:N cycle time lookup array
}

export type ActiveTab = 'sheet' | 'kiosk' | 'analytics' | 'settings';