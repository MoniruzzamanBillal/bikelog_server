import { Router } from "express";
import authCheck from "../../middleware/authCheck";
import validateRequest from "../../middleware/validateRequest";
import { upload } from "../../middleware/upload";
import { engineOilLogController } from "./engineOilLog.controller";
import { engineOilLogValidations } from "./engineOilLog.validation";

const router = Router({ mergeParams: true });

// ! §0 H1 — MUST stay above `GET /:id`. Express matches in registration order, so
// ! `router.get("/:id")` happily matches the literal path `status`: the service would look
// ! for an engine oil log with id "status", find none, and throw
// ! `404 Engine oil log not found` with no hint that routing is the problem.
// ! for the oil-change forecast — km on this oil, km remaining, projected due date
router.get("/status", authCheck, engineOilLogController.getEngineOilStatus);

// ! for creating an engine oil log
router.post(
  "/",
  authCheck,
  validateRequest(engineOilLogValidations.createEngineOilLogSchema),
  engineOilLogController.createEngineOilLog,
);

// ! for getting all engine oil logs for a bike
router.get("/", authCheck, engineOilLogController.getEngineOilLogs);

// ! for getting a single engine oil log by id
router.get("/:id", authCheck, engineOilLogController.getEngineOilLogById);

// ! for updating an engine oil log
router.patch(
  "/:id",
  authCheck,
  validateRequest(engineOilLogValidations.updateEngineOilLogSchema),
  engineOilLogController.updateEngineOilLog,
);

// ! for deleting an engine oil log
router.delete("/:id", authCheck, engineOilLogController.deleteEngineOilLog);

// ! for uploading/replacing the receipt image
router.put(
  "/:id/image",
  authCheck,
  upload.single("image"),
  engineOilLogController.uploadEngineOilLogImage,
);

// ! for removing the receipt image
router.delete(
  "/:id/image",
  authCheck,
  engineOilLogController.deleteEngineOilLogImage,
);

//
export const engineOilLogRouter = router;
