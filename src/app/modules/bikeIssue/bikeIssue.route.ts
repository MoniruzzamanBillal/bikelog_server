import { Router } from "express";
import authCheck from "../../middleware/authCheck";
import validateRequest from "../../middleware/validateRequest";
import { bikeIssueController } from "./bikeIssue.controller";
import { bikeIssueValidations } from "./bikeIssue.validation";

// ! mounted at /bikes/:bikeId/issues
const router = Router({ mergeParams: true });

router.post(
  "/",
  authCheck,
  validateRequest(bikeIssueValidations.createBikeIssueSchema),
  bikeIssueController.createBikeIssue,
);

router.get("/", authCheck, bikeIssueController.getBikeIssues);

router.get("/:id", authCheck, bikeIssueController.getBikeIssueById);

router.patch(
  "/:id",
  authCheck,
  validateRequest(bikeIssueValidations.updateBikeIssueSchema),
  bikeIssueController.updateBikeIssue,
);

router.delete("/:id", authCheck, bikeIssueController.deleteBikeIssue);

router.patch(
  "/:id/status",
  authCheck,
  validateRequest(bikeIssueValidations.updateBikeIssueStatusSchema),
  bikeIssueController.updateBikeIssueStatus,
);

//
export const bikeIssueRouter = router;
