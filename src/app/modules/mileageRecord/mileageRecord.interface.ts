export type TMileageRecord = {
  bikeId: string;
  startOdometer: number;
  endOdometer: number;
  distanceKm: number;
  litersConsumed: number;
  mileageKmPerLiter: number;
  periodStartDate: Date;
  periodEndDate: Date;
  fuelLogIds: string[];
};
