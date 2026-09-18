export type TMaintenanceLog = {
  maintenanceType: string;
  odometerReading: number;
  oilType?: string;
  intervalKmUsed?: number;
  nextDueDate?: Date;
  cost: number;
  serviceDate?: Date;
  serviceCenter?: string | null;
  partsReplaced?: string[];
  notes?: string | null;
};
