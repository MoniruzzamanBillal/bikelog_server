import { Router } from "express";
import authCheck from "../../middleware/authCheck";
import validateRequest from "../../middleware/validateRequest";
import { upload } from "../../middleware/upload";
import { bikeAccessoryController } from "./bikeAccessory.controller";
import { bikeAccessoryValidations } from "./bikeAccessory.validation";

// ! mounted at /bikes/:bikeId/accessories
const router = Router({ mergeParams: true });

router.post(
  "/",
  authCheck,
  validateRequest(bikeAccessoryValidations.createBikeAccessorySchema),
  bikeAccessoryController.createBikeAccessory,
);

router.get("/", authCheck, bikeAccessoryController.getBikeAccessories);

router.get("/:id", authCheck, bikeAccessoryController.getBikeAccessoryById);

router.patch(
  "/:id",
  authCheck,
  validateRequest(bikeAccessoryValidations.updateBikeAccessorySchema),
  bikeAccessoryController.updateBikeAccessory,
);

router.delete("/:id", authCheck, bikeAccessoryController.deleteBikeAccessory);

// ! for uploading/replacing the product image
router.put(
  "/:id/image",
  authCheck,
  upload.single("image"),
  bikeAccessoryController.uploadBikeAccessoryImage,
);

// ! for removing the product image
router.delete(
  "/:id/image",
  authCheck,
  bikeAccessoryController.deleteBikeAccessoryImage,
);

//
export const bikeAccessoryRouter = router;
