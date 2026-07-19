import { Router } from "express";
import { bikeRouter } from "../modules/bike/bike.route";
import { engineOilTypeRouter } from "../modules/engineOilType/engineOilType.route";
import { fuelLogRouter } from "../modules/fuelLog/fuelLog.route";
import {
  maintenanceLogRouter,
  reminderRouter,
} from "../modules/maintenanceLog/maintenanceLog.route";
import { maintenanceTypeRouter } from "../modules/maintenanceType/maintenanceType.route";
import { mileageRecordRouter } from "../modules/mileageRecord/mileageRecord.route";
import { spendingRouter } from "../modules/spending/spending.route";
import { userRouter } from "../modules/user/user.route";

const router = Router();

const routeArray = [
  {
    path: "/auth",
    route: userRouter,
  },
  {
    path: "/bikes",
    route: bikeRouter,
  },
  {
    path: "/bikes/:bikeId/fuel-logs",
    route: fuelLogRouter,
  },
  {
    path: "/bikes/:bikeId/mileage",
    route: mileageRecordRouter,
  },
  {
    path: "/maintenance-types",
    route: maintenanceTypeRouter,
  },
  {
    path: "/engine-oil-types",
    route: engineOilTypeRouter,
  },
  {
    path: "/bikes/:bikeId/maintenance-logs",
    route: maintenanceLogRouter,
  },
  {
    path: "/bikes/:bikeId/reminders",
    route: reminderRouter,
  },
  {
    path: "/bikes/:bikeId/spending-summary",
    route: spendingRouter,
  },
];

routeArray.forEach((item) => {
  router.use(item.path, item.route);
});

export const MainRouter = router;
