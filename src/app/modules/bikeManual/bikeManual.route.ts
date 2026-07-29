import { Router } from "express";
import authCheck from "../../middleware/authCheck";
import { uploadManual } from "../../middleware/uploadManual";
import { bikeManualController } from "./bikeManual.controller";

// ! mounted at /bikes/:bikeId/manual
const router = Router({ mergeParams: true });

// ! upload-or-replace, upsert semantics — no separate PUT
router.post(
  "/",
  authCheck,
  uploadManual.single("manual"),
  bikeManualController.uploadBikeManual,
);

router.get("/", authCheck, bikeManualController.getBikeManual);

router.delete("/", authCheck, bikeManualController.deleteBikeManual);

//
export const bikeManualRouter = router;
