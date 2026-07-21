import { Router } from "express";
import authCheck from "../../middleware/authCheck";
import validateRequest from "../../middleware/validateRequest";
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

//
export const bikeAccessoryRouter = router;
