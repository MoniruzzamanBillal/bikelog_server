import { Router } from "express";
import authCheck from "../../middleware/authCheck";
import validateRequest from "../../middleware/validateRequest";
import { upload } from "../../middleware/upload";
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

// ! for adding one or more evidence images (up to 5 per request)
router.post(
  "/:id/images",
  authCheck,
  upload.array("images", 5),
  bikeIssueController.addBikeIssueImages,
);

// ! for removing a single evidence image by its own subdocument id
router.delete(
  "/:id/images/:imageId",
  authCheck,
  bikeIssueController.deleteBikeIssueImage,
);

//
export const bikeIssueRouter = router;
