import { Router } from "express";
import authCheck from "../../middleware/authCheck";
import validateRequest from "../../middleware/validateRequest";
import { maintenanceTypeController } from "./maintenanceType.controller";
import { maintenanceTypeValidations } from "./maintenanceType.validation";

const router = Router();

// ! for creating a custom maintenance type
router.post(
  "/",
  authCheck,
  validateRequest(maintenanceTypeValidations.createMaintenanceTypeSchema),
  maintenanceTypeController.createMaintenanceType,
);

// ! for getting all maintenance types
router.get("/", authCheck, maintenanceTypeController.getMaintenanceTypes);

//
export const maintenanceTypeRouter = router;
