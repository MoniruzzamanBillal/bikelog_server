import { TMaintenanceLog } from "./maintenanceLog.interface";

// TODO: implement maintenance-log creation, scoped to bikeId, computes nextDueOdometer
const createMaintenanceLogIntoDB = async (
  bikeId: string,
  payload: Partial<TMaintenanceLog>,
) => {
  return { bikeId, payload };
};

// TODO: implement fetching all maintenance logs for a bike
const getMaintenanceLogsFromDB = async (bikeId: string) => {
  return { bikeId };
};

// TODO: implement fetching a single maintenance log, scoped to bikeId
const getMaintenanceLogByIdFromDB = async (bikeId: string, id: string) => {
  return { bikeId, id };
};

// TODO: implement updating a maintenance log, scoped to bikeId
const updateMaintenanceLogInDB = async (
  bikeId: string,
  id: string,
  payload: Partial<TMaintenanceLog>,
) => {
  return { bikeId, id, payload };
};

// TODO: implement soft-deleting a maintenance log, scoped to bikeId
const deleteMaintenanceLogFromDB = async (bikeId: string, id: string) => {
  return { bikeId, id };
};

// TODO: implement due/overdue/upcoming reminders, computed on read from Bike.currentOdometer vs
// each MaintenanceLog.nextDueOdometer (bike-log-plan.md §2.2)
const getRemindersFromDB = async (bikeId: string) => {
  return { bikeId };
};

//
export const maintenanceLogServices = {
  createMaintenanceLogIntoDB,
  getMaintenanceLogsFromDB,
  getMaintenanceLogByIdFromDB,
  updateMaintenanceLogInDB,
  deleteMaintenanceLogFromDB,
  getRemindersFromDB,
};
