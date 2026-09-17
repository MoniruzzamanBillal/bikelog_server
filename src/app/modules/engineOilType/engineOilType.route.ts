import { Router } from "express";
import authCheck from "../../middleware/authCheck";
import validateRequest from "../../middleware/validateRequest";
import { engineOilTypeController } from "./engineOilType.controller";
import { engineOilTypeValidations } from "./engineOilType.validation";

const router = Router();

// ! for creating a custom engine oil type
router.post(
  "/",
  authCheck,
  validateRequest(engineOilTypeValidations.createEngineOilTypeSchema),
  engineOilTypeController.createEngineOilType,
);

// ! for getting all engine oil types
router.get("/", authCheck, engineOilTypeController.getEngineOilTypes);

// ! for updating an engine oil type
router.patch(
  "/:id",
  authCheck,
  validateRequest(engineOilTypeValidations.updateEngineOilTypeSchema),
  engineOilTypeController.updateEngineOilType,
);

//
export const engineOilTypeRouter = router;
