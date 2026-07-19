"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.maintenanceLogServices = void 0;
// TODO: implement maintenance-log creation, scoped to bikeId, computes nextDueOdometer
const createMaintenanceLogIntoDB = (bikeId, payload) => __awaiter(void 0, void 0, void 0, function* () {
    return { bikeId, payload };
});
// TODO: implement fetching all maintenance logs for a bike
const getMaintenanceLogsFromDB = (bikeId) => __awaiter(void 0, void 0, void 0, function* () {
    return { bikeId };
});
// TODO: implement fetching a single maintenance log, scoped to bikeId
const getMaintenanceLogByIdFromDB = (bikeId, id) => __awaiter(void 0, void 0, void 0, function* () {
    return { bikeId, id };
});
// TODO: implement updating a maintenance log, scoped to bikeId
const updateMaintenanceLogInDB = (bikeId, id, payload) => __awaiter(void 0, void 0, void 0, function* () {
    return { bikeId, id, payload };
});
// TODO: implement soft-deleting a maintenance log, scoped to bikeId
const deleteMaintenanceLogFromDB = (bikeId, id) => __awaiter(void 0, void 0, void 0, function* () {
    return { bikeId, id };
});
// TODO: implement due/overdue/upcoming reminders, computed on read from Bike.currentOdometer vs
// each MaintenanceLog.nextDueOdometer (bike-log-plan.md §2.2)
const getRemindersFromDB = (bikeId) => __awaiter(void 0, void 0, void 0, function* () {
    return { bikeId };
});
//
exports.maintenanceLogServices = {
    createMaintenanceLogIntoDB,
    getMaintenanceLogsFromDB,
    getMaintenanceLogByIdFromDB,
    updateMaintenanceLogInDB,
    deleteMaintenanceLogFromDB,
    getRemindersFromDB,
};
