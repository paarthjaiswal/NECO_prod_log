// Allow dynamic shift names from public.shifts while keeping autocomplete for defaults
export type ShiftType =
  | 'Shift A (7AM-3:30PM)'
  | 'Shift B (3:30PM-12AM)'
  | 'Shift C (12AM-7AM)'
  | (string & {});

export interface ProductionLineMaster {
  id: string;                  // e.g. 'line_1'
  name: string;                // e.g. 'Line 1'
  description?: string;
  dailyWorkingMinutes: number; // Default 1305
  isActive: boolean;
  sortOrder: number;
}

export interface ShiftMaster {
  id: string;
  shiftCode: string;
  displayName: ShiftType;
  startTime: string;
  endTime: string;
  restBreakMinutes?: number;
  cleaningBreakMinutes?: number;
  shiftWorkingMinutes: number;
  totalWorkingMinutesRef: number;
  isActive: boolean;
  sortOrder: number;
}

export interface MachineItemCycleTime {
  id?: number;
  machineId: string;
  itemId: string;
  operation: string;
  cycleTime: number; // Time to produce 1 unit
  stdOutput?: number; // Specific target output for this Machine + Item + Operation
  isActive?: boolean;
}

export interface ItemMaster {
  id: string;
  itemCode: string;
  itemName: string;
  operation: string;
  stdOutput?: number;
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
  productionLine?: string; // Line alias
  srNo: number;
  machineId: string;
  machineCode?: string;
  machineName: string;
  operatorName: string;
  itemId: string;
  itemName: string;
  operation: string;
  cycleTime: number;           // NEW: Snapshotted cycle time
  totalWorkingMinutes: number; // NEW: Snapshotted working time (default 1305)
  shiftWorkingMinutes?: number;
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

export interface ShiftLockInfo {
  isEditable: boolean;
  status: 'open' | 'grace_period' | 'locked' | 'future' | 'admin_override';
  reason: string | null;
  lockDeadlineText?: string;
  remainingMinutes?: number;
}

export interface FactoryTimeContext {
  serverNowIst: string; // ISO/timestamp string from Supabase in Asia/Kolkata
  activeDate: string;   // YYYY-MM-DD
  autoSelectedShift: ShiftType;
}
