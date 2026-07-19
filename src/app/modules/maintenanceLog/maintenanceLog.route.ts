import { Router } from "express";
import authCheck from "../../middleware/authCheck";
import validateRequest from "../../middleware/validateRequest";
import { maintenanceLogController } from "./maintenanceLog.controller";
import { maintenanceLogValidations } from "./maintenanceLog.validation";

// ! CRUD router — mounted at /bikes/:bikeId/maintenance-logs
const crudRouter = Router({ mergeParams: true });

crudRouter.post(
  "/",
  authCheck,
  validateRequest(maintenanceLogValidations.createMaintenanceLogSchema),
  maintenanceLogController.createMaintenanceLog,
);

crudRouter.get("/", authCheck, maintenanceLogController.getMaintenanceLogs);

crudRouter.get(
  "/:id",
  authCheck,
  maintenanceLogController.getMaintenanceLogById,
);

crudRouter.patch(
  "/:id",
  authCheck,
  validateRequest(maintenanceLogValidations.updateMaintenanceLogSchema),
  maintenanceLogController.updateMaintenanceLog,
);

crudRouter.delete(
  "/:id",
  authCheck,
  maintenanceLogController.deleteMaintenanceLog,
);

// ! reminders router — mounted separately at /bikes/:bikeId/reminders
const remindersRouter = Router({ mergeParams: true });

remindersRouter.get("/", authCheck, maintenanceLogController.getReminders);

//
export const maintenanceLogRouter = crudRouter;
export const reminderRouter = remindersRouter;
