export type TFuelLog = {
  odometerReading: number;
  litersAdded: number;
  isFullTank: boolean;
  pricePerLiter: number;
  totalCost?: number;
  fuelStation?: string | null;
  date?: Date;
  notes?: string | null;
};
