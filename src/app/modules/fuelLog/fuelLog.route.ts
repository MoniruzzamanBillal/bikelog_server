import { Router } from "express";
import authCheck from "../../middleware/authCheck";
import validateRequest from "../../middleware/validateRequest";
import { fuelLogController } from "./fuelLog.controller";
import { fuelLogValidations } from "./fuelLog.validation";

const router = Router({ mergeParams: true });

// ! for creating a fuel log
router.post(
  "/",
  authCheck,
  validateRequest(fuelLogValidations.createFuelLogSchema),
  fuelLogController.createFuelLog,
);

// ! for getting all fuel logs for a bike
router.get("/", authCheck, fuelLogController.getFuelLogs);

// ! for getting a single fuel log by id
router.get("/:id", authCheck, fuelLogController.getFuelLogById);

// ! for updating a fuel log
router.patch(
  "/:id",
  authCheck,
  validateRequest(fuelLogValidations.updateFuelLogSchema),
  fuelLogController.updateFuelLog,
);

// ! for deleting a fuel log
router.delete("/:id", authCheck, fuelLogController.deleteFuelLog);

//
export const fuelLogRouter = router;
