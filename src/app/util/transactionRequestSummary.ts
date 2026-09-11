import { TFuelLog } from "../modules/fuelLog/fuelLog.interface";
import { TMaintenanceLog } from "../modules/maintenanceLog/maintenanceLog.interface";
import { TBikeAccessory } from "../modules/bikeAccessory/bikeAccessory.interface";

export const buildFuelLogSummary = (
  fuelLog: Pick<
    TFuelLog,
    "litersAdded" | "fuelStation" | "isFullTank" | "odometerReading" | "notes"
  >,
  bikeNickname?: string,
) => {
  const title = `Fuel: ${fuelLog.fuelStation || "Fuel top-up"}`;
  const description =
    `Took ${fuelLog.litersAdded}L fuel${bikeNickname ? ` for ${bikeNickname}` : ""} from ${fuelLog.fuelStation || "the fuel station"}, ${fuelLog.isFullTank ? "full tank" : "partial tank"}, at ${fuelLog.odometerReading} km.` +
    (fuelLog.notes ? ` ${fuelLog.notes}` : "");

  return { title, description };
};

export const buildMaintenanceLogSummary = (
  log: Pick<
    TMaintenanceLog,
    "odometerReading" | "serviceCenter" | "partsReplaced" | "notes"
  >,
  maintenanceTypeName: string | undefined,
  bikeNickname?: string,
) => {
  const typeName = maintenanceTypeName || "Service";
  const title = `Maintenance: ${typeName}`;
  const description =
    `${typeName}${bikeNickname ? ` for ${bikeNickname}` : ""}${log.serviceCenter ? ` at ${log.serviceCenter}` : ""}, at ${log.odometerReading} km.` +
    (log.partsReplaced?.length
      ? ` Parts replaced: ${log.partsReplaced.join(", ")}.`
      : "") +
    (log.notes ? ` ${log.notes}` : "");

  return { title, description };
};

export const buildAccessorySummary = (
  accessory: Pick<TBikeAccessory, "name" | "urgency">,
  bikeNickname?: string,
) => {
  const title = `Accessory: ${accessory.name}`;
  const description = `Purchased ${accessory.name}${bikeNickname ? ` for ${bikeNickname}` : ""} (${accessory.urgency} priority).`;

  return { title, description };
};
