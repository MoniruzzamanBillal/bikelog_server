import { Router } from "express";
import authCheck from "../../middleware/authCheck";
import validateRequest from "../../middleware/validateRequest";
import { bikeController } from "./bike.controller";
import { bikeValidations } from "./bike.validation";

const router = Router();

// ! for creating a bike
router.post(
  "/",
  authCheck,
  validateRequest(bikeValidations.createBikeSchema),
  bikeController.createBike,
);

// ! for getting all bikes owned by the logged-in user
router.get("/", authCheck, bikeController.getBikes);

// ! for getting a single bike by id
router.get("/:id", authCheck, bikeController.getBikeById);

// ! for updating a bike
router.patch(
  "/:id",
  authCheck,
  validateRequest(bikeValidations.updateBikeSchema),
  bikeController.updateBike,
);

// ! for deleting a bike
router.delete("/:id", authCheck, bikeController.deleteBike);

//
export const bikeRouter = router;
