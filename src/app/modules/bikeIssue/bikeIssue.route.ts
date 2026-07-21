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

// router.patch(
//   "/:id/resolve",
//   authCheck,
//   validateRequest(bikeIssueValidations.resolveBikeIssueSchema),
//   bikeIssueController.resolveBikeIssue,
// );

router.patch(
  "/:id/reopen",
  authCheck,
  validateRequest(bikeIssueValidations.reopenBikeIssueSchema),
  bikeIssueController.reopenBikeIssue,
);

//
export const bikeIssueRouter = router;
