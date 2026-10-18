"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAccessorySummary = exports.buildEngineOilLogSummary = exports.buildMaintenanceLogSummary = exports.buildFuelLogSummary = void 0;
const buildFuelLogSummary = (fuelLog, bikeNickname) => {
    const title = `Fuel: ${fuelLog.fuelStation || "Fuel top-up"}`;
    const description = `Took ${fuelLog.litersAdded}L fuel${bikeNickname ? ` for ${bikeNickname}` : ""} from ${fuelLog.fuelStation || "the fuel station"}, ${fuelLog.isFullTank ? "full tank" : "partial tank"}, at ${fuelLog.odometerReading} km.` +
        (fuelLog.notes ? ` ${fuelLog.notes}` : "");
    return { title, description };
};
exports.buildFuelLogSummary = buildFuelLogSummary;
const buildMaintenanceLogSummary = (log, maintenanceTypeName, bikeNickname) => {
    var _a;
    const typeName = maintenanceTypeName || "Service";
    const title = `Maintenance: ${typeName}`;
    const description = `${typeName}${bikeNickname ? ` for ${bikeNickname}` : ""}${log.serviceCenter ? ` at ${log.serviceCenter}` : ""}, at ${log.odometerReading} km.` +
        (((_a = log.partsReplaced) === null || _a === void 0 ? void 0 : _a.length)
            ? ` Parts replaced: ${log.partsReplaced.join(", ")}.`
            : "") +
        (log.notes ? ` ${log.notes}` : "");
    return { title, description };
};
exports.buildMaintenanceLogSummary = buildMaintenanceLogSummary;
// Spec 54 §C: sits next to buildMaintenanceLogSummary because the push still goes out as
// `sourceType: "maintenance"` (D8) — only the copy is oil-specific.
const buildEngineOilLogSummary = (
// ! not a `Pick<TEngineOilLog, …>` like its two neighbours: the caller passes a Prisma
// ! row, where every optional column reads back as `null` rather than `undefined`, and
// ! TEngineOilLog is the request-payload type (optional, never null).
log, oilTypeName, bikeNickname) => {
    const typeName = oilTypeName || "Engine oil";
    const title = `Engine oil: ${typeName}`;
    const description = `Engine oil change with ${typeName}${bikeNickname ? ` for ${bikeNickname}` : ""}${log.serviceCenter ? ` at ${log.serviceCenter}` : ""}, at ${log.odometerReading} km.` +
        (log.quantityLiters ? ` ${log.quantityLiters}L used.` : "") +
        (log.oilFilterChanged ? " Oil filter changed." : "") +
        (log.notes ? ` ${log.notes}` : "");
    return { title, description };
};
exports.buildEngineOilLogSummary = buildEngineOilLogSummary;
const buildAccessorySummary = (accessory, bikeNickname) => {
    const title = `Accessory: ${accessory.name}`;
    const description = `Purchased ${accessory.name}${bikeNickname ? ` for ${bikeNickname}` : ""} (${accessory.urgency} priority).`;
    return { title, description };
};
exports.buildAccessorySummary = buildAccessorySummary;
