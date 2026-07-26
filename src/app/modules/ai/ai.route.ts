import { Router } from "express";
import authCheck from "../../middleware/authCheck";
import validateRequest from "../../middleware/validateRequest";
import { aiController } from "./ai.controller";
import { aiValidations } from "./ai.validation";

// ! mounted at /bikes/:bikeId/ai
const router = Router({ mergeParams: true });

router.get("/spending-insight", authCheck, aiController.getSpendingInsight);

router.get("/mileage-insight", authCheck, aiController.getMileageInsight);

router.post(
  "/chat",
  authCheck,
  validateRequest(aiValidations.bikeChatSchema),
  aiController.bikeChat,
);

//
export const aiRouter = router;
