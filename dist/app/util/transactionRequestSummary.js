"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAccessorySummary = exports.buildMaintenanceLogSummary = exports.buildFuelLogSummary = void 0;
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
const buildAccessorySummary = (accessory, bikeNickname) => {
    const title = `Accessory: ${accessory.name}`;
    const description = `Purchased ${accessory.name}${bikeNickname ? ` for ${bikeNickname}` : ""} (${accessory.urgency} priority).`;
    return { title, description };
};
exports.buildAccessorySummary = buildAccessorySummary;
