import { Router } from "express";
import authCheck from "../../middleware/authCheck";
import validateRequest from "../../middleware/validateRequest";
import { upload } from "../../middleware/upload";
import { serviceLogController } from "./serviceLog.controller";
import { serviceLogValidations } from "./serviceLog.validation";

const router = Router({ mergeParams: true });

// ! MUST stay above `GET /:id` — Express matches in registration order, so `/:id` would
// ! otherwise swallow the literal `status` and the service would 404 looking for a log with
// ! id "status" (same trap as the oil module's §0 H1).
router.get("/status", authCheck, serviceLogController.getServiceStatus);

router.post(
  "/",
  authCheck,
  validateRequest(serviceLogValidations.createServiceLogSchema),
  serviceLogController.createServiceLog,
);

router.get("/", authCheck, serviceLogController.getServiceLogs);

router.get("/:id", authCheck, serviceLogController.getServiceLogById);

router.patch(
  "/:id",
  authCheck,
  validateRequest(serviceLogValidations.updateServiceLogSchema),
  serviceLogController.updateServiceLog,
);

router.delete("/:id", authCheck, serviceLogController.deleteServiceLog);

router.put(
  "/:id/image",
  authCheck,
  upload.single("image"),
  serviceLogController.uploadServiceLogImage,
);

router.delete(
  "/:id/image",
  authCheck,
  serviceLogController.deleteServiceLogImage,
);

export const serviceLogRouter = router;
