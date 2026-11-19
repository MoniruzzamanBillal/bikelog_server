import { Router } from "express";
import authCheck from "../../middleware/authCheck";
import { bikeStatsController } from "./bikeStats.controller";

const router = Router({ mergeParams: true });

// ! Spec 68: one call for the bike stat strip — avg mileage, month/lifetime spend,
// ! cost/km and oil scalars, composed server-side from the four existing endpoints.
router.get("/", authCheck, bikeStatsController.getBikeStatStrip);

export const bikeStatsRouter = router;
