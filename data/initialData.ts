import { ItemMaster, MachineMaster, MachineShiftRow, ShiftType } from '@/types';

export const PRODUCTION_LINES = ['Line 1', 'Line 2', 'Line 3'];

export const INITIAL_MACHINES: MachineMaster[] = [
  // Line 1: Primary CNC & Heavy Machining (The 16 Client Machines in exact order)
  { id: 'm1', name: 'JIUH YEH-8', code: 'JY-08', line: 'Line 1', type: 'Milling', status: 'active' },
  { id: 'm2', name: 'WMW(V)-102', code: 'WMW-102', line: 'Line 1', type: 'Vertical Milling', status: 'active' },
  { id: 'm3', name: 'JIUH YEH-13', code: 'JY-13', line: 'Line 1', type: 'Milling', status: 'active' },
  { id: 'm4', name: 'FEELER-2', code: 'FL-02', line: 'Line 1', type: 'VMC', status: 'active' },
  { id: 'm5', name: 'DUPLEX-97', code: 'DP-97', line: 'Line 1', type: 'Duplex Milling', status: 'active' },
  { id: 'm6', name: 'WMW-45', code: 'WMW-45', line: 'Line 1', type: 'Horizontal Milling', status: 'active' },
  { id: 'm7', name: 'MWM-31', code: 'MWM-31', line: 'Line 1', type: 'Radial Drill', status: 'active' },
  { id: 'm8', name: 'MAZAK-121', code: 'MZ-121', line: 'Line 1', type: 'CNC Turning', status: 'active' },
  { id: 'm9', name: 'MAKINO-128', code: 'MK-128', line: 'Line 1', type: 'Machining Center', status: 'active' },
  { id: 'm10', name: 'LOKESH-27', code: 'LK-27', line: 'Line 1', type: 'CNC Lathe', status: 'active' },
  { id: 'm11', name: 'SPM. ESCOL-35', code: 'SPM-35', line: 'Line 1', type: 'Special Purpose Machine', status: 'active' },
  { id: 'm12', name: 'RD-64', code: 'RD-64', line: 'Line 1', type: 'Radial Drilling', status: 'active' },
  { id: 'm13', name: 'RD-56', code: 'RD-56', line: 'Line 1', type: 'Radial Drilling', status: 'active' },
  { id: 'm14', name: 'MAKINO-129', code: 'MK-129', line: 'Line 1', type: 'HMC', status: 'active' },
  { id: 'm15', name: 'BFW-106', code: 'BFW-106', line: 'Line 1', type: 'VMC Center', status: 'active' },
  { id: 'm16', name: 'SUPERMAX-11', code: 'SM-11', line: 'Line 1', type: 'VMC Supermax', status: 'active' },

  // Line 2: VMC & High-Speed Milling Cell
  { id: 'm17', name: 'HAAS-VF2', code: 'HS-02', line: 'Line 2', type: 'VMC 3-Axis', status: 'active' },
  { id: 'm18', name: 'BFW-AGNI-45', code: 'AG-45', line: 'Line 2', type: 'VMC Center', status: 'active' },
  { id: 'm19', name: 'DMG-MORI-50', code: 'DM-50', line: 'Line 2', type: '5-Axis Machining', status: 'active' },
  { id: 'm20', name: 'DOOSAN-PUMA-210', code: 'DP-210', line: 'Line 2', type: 'CNC Turning', status: 'active' },
  { id: 'm21', name: 'MAKINO-SLIM-3', code: 'MK-03', line: 'Line 2', type: 'Machining Center', status: 'active' },
  { id: 'm22', name: 'CITIZEN-L20', code: 'CZ-20', line: 'Line 2', type: 'Swiss Lathe', status: 'active' },
  { id: 'm23', name: 'BROTHER-TC32', code: 'BR-32', line: 'Line 2', type: 'Tapping Center', status: 'active' },
  { id: 'm24', name: 'HARDINGE-GS150', code: 'HD-150', line: 'Line 2', type: 'CNC Turning', status: 'active' },

  // Line 3: Heavy SPM & Grinding Line
  { id: 'm25', name: 'SPM-BORING-01', code: 'SPM-01', line: 'Line 3', type: 'Deep Hole Boring', status: 'active' },
  { id: 'm26', name: 'WMW-HEAVY-02', code: 'WM-02', line: 'Line 3', type: 'Heavy Planomiller', status: 'active' },
  { id: 'm27', name: 'HMT-RADIAL-12', code: 'HM-12', line: 'Line 3', type: 'Heavy Radial Drill', status: 'active' },
  { id: 'm28', name: 'KIRLOSKAR-TURN-04', code: 'KL-04', line: 'Line 3', type: 'Heavy Duty Lathe', status: 'active' },
  { id: 'm29', name: 'TOS-KURIM-05', code: 'TK-05', line: 'Line 3', type: 'Bed Milling Machine', status: 'active' },
  { id: 'm30', name: 'CHURCHILL-GRIND-06', code: 'CH-06', line: 'Line 3', type: 'Cylindrical Grinder', status: 'active' },
];

export const INITIAL_OPERATORS: string[] = [
  'Rajesh Kumar',
  'Suresh Patel',
  'Vikram Singh',
  'Amit Sharma',
  'Manoj Verma',
  'Deepak Yadav',
  'Santosh Nair',
  'Ramesh Gupta',
  'Kailash Chand',
  'Arun Joshi',
];

export const INITIAL_ITEMS: ItemMaster[] = [
  {
    id: 'it1',
    itemCode: 'SG-204',
    itemName: 'Shaft Gear SG-204',
    operation: 'OP-10 Rough Turning',
    stdOutput: 120,
  },
  {
    id: 'it2',
    itemCode: 'FH-108',
    itemName: 'Flange Hub FH-108',
    operation: 'OP-20 CNC Milling',
    stdOutput: 85,
  },
  {
    id: 'it3',
    itemCode: 'SB-44',
    itemName: 'Steel Bush SB-44',
    operation: 'OP-30 Drilling & Boring',
    stdOutput: 200,
  },
  {
    id: 'it4',
    itemCode: 'AP-90',
    itemName: 'Axle Pin AP-90',
    operation: 'OP-15 Finish Grinding',
    stdOutput: 150,
  },
  {
    id: 'it5',
    itemCode: 'VB-310',
    itemName: 'Valve Body VB-310',
    operation: 'OP-40 VMC Machining',
    stdOutput: 60,
  },
];

export const SHIFTS: ShiftType[] = [
  'Shift A (6AM-2PM)',
  'Shift B (2PM-10PM)',
  'Shift C (10PM-6AM)',
];

export const getTodayDateString = (): string => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getYesterdayDateString = (): string => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Generates default shift rows for a specific production line
export const generateDefaultShiftRows = (
  date: string,
  shift: ShiftType,
  line: string = 'Line 1'
): MachineShiftRow[] => {
  const targetLine = line || 'Line 1';
  const lineMachines = INITIAL_MACHINES.filter((m) => (m.line || 'Line 1') === targetLine);

  return lineMachines.map((machine, index) => {
    const defaultItem = INITIAL_ITEMS[index % INITIAL_ITEMS.length];
    return {
      id: `${date}_${shift}_${targetLine}_${machine.id}`,
      date,
      shift,
      line: targetLine,
      srNo: index + 1,
      machineId: machine.id,
      machineName: machine.name,
      operatorName: INITIAL_OPERATORS[index % INITIAL_OPERATORS.length] || "",
      itemId: defaultItem?.id || "",
      itemName: defaultItem?.itemName || "",
      operation: defaultItem?.operation || "",
      cycleTime: 0,
      totalWorkingMinutes: 1350,
      stdOutput: defaultItem?.stdOutput || 0,
      actualOutput: 0,
      rework: 0,
      breakdown: {
        noDisc: 0,
        change: 0,
        power: 0,
        operator: 0,
      },
      remarks: "",
    };
  });
};

// Generates sample historical logs for all production lines
export const generateSampleHistoricalLogs = (): MachineShiftRow[] => {
  const yesterday = getYesterdayDateString();
  const shifts: ShiftType[] = ['Shift A (6AM-2PM)', 'Shift B (2PM-10PM)'];
  const historicalRows: MachineShiftRow[] = [];

  PRODUCTION_LINES.forEach((line) => {
    const lineMachines = INITIAL_MACHINES.filter((m) => (m.line || 'Line 1') === line);

    shifts.forEach((shift) => {
      lineMachines.forEach((machine, idx) => {
        const srNo = idx + 1;
        const rowId = `${yesterday}_${shift}_${line}_${machine.id}`;
        const item = INITIAL_ITEMS[(idx + (line === 'Line 2' ? 1 : 2)) % INITIAL_ITEMS.length];
        const operator = INITIAL_OPERATORS[(idx + (line === 'Line 2' ? 2 : 4)) % INITIAL_OPERATORS.length];

        const variance = idx % 3 === 0 ? -15 : idx % 2 === 0 ? 4 : -2;
        const actualOutput = Math.max(0, (item.stdOutput ?? 100) + variance);
        const rework = idx % 4 === 0 ? 3 : 1;
        const noDisc = idx === 3 || idx === 7 ? 20 : 0;
        const change = idx % 3 === 0 ? 15 : 5;
        const power = idx === 5 ? 30 : 0;
        const opDowntime = idx === 2 ? 15 : 0;

        historicalRows.push({
          id: rowId,
          date: yesterday,
          shift,
          line,
          srNo,
          machineId: machine.id,
          machineName: machine.name,
          operatorName: operator,
          itemId: item.id,
          itemName: item.itemName,
          operation: item.operation,
          cycleTime: 0,
          totalWorkingMinutes: 1350,
          stdOutput: item.stdOutput ?? 0,
          actualOutput,
          rework,
          breakdown: {
            noDisc,
            change,
            power,
            operator: opDowntime,
          },
          remarks: `${line} shift verified and archived`,
        });
      });
    });
  });

  return historicalRows;
};