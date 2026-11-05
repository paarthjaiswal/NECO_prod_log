export type ShiftType = 'Shift A (6AM-2PM)' | 'Shift B (2PM-10PM)' | 'Shift C (10PM-6AM)';

export interface ItemMaster {
  id: string;
  itemCode: string;
  itemName: string;
  operation: string;
  stdOutput: number;
}

export interface BreakdownMinutes {
  noDisc: number;   // NO/DISC: Material / Disc shortage
  change: number;   // CHANGE: Tool change / setup
  power: number;    // POWER: Power cut / electrical
  operator: number; // OPERATOR: Absenteeism / operator delay
}

export interface MachineShiftRow {
  id: string; // unique row id (e.g., date_shift_line_machineId)
  date: string; // YYYY-MM-DD
  shift: ShiftType;
  line: string; // e.g. 'Line 1', 'Line 2', 'Line 3'
  srNo: number; // 1 to 16
  machineId: string;
  machineName: string;
  operatorName: string;
  itemId: string;
  itemName: string;
  operation: string;
  stdOutput: number;
  actualOutput: number;
  rework: number;
  breakdown: BreakdownMinutes;
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
}

export type ActiveTab = 'sheet' | 'kiosk' | 'analytics' | 'settings';