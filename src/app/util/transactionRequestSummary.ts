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

// Spec 54 §C: sits next to buildMaintenanceLogSummary because the push still goes out as
// `sourceType: "maintenance"` (D8) — only the copy is oil-specific.
export const buildEngineOilLogSummary = (
  // ! not a `Pick<TEngineOilLog, …>` like its two neighbours: the caller passes a Prisma
  // ! row, where every optional column reads back as `null` rather than `undefined`, and
  // ! TEngineOilLog is the request-payload type (optional, never null).
  log: {
    odometerReading: number;
    serviceCenter?: string | null;
    quantityLiters?: number | null;
    oilFilterChanged?: boolean;
    notes?: string | null;
  },
  oilTypeName: string | undefined,
  bikeNickname?: string,
) => {
  const typeName = oilTypeName || "Engine oil";
  const title = `Engine oil: ${typeName}`;
  const description =
    `Engine oil change with ${typeName}${bikeNickname ? ` for ${bikeNickname}` : ""}${
      log.serviceCenter ? ` at ${log.serviceCenter}` : ""
    }, at ${log.odometerReading} km.` +
    (log.quantityLiters ? ` ${log.quantityLiters}L used.` : "") +
    (log.oilFilterChanged ? " Oil filter changed." : "") +
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
