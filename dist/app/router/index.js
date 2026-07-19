"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MainRouter = void 0;
const express_1 = require("express");
const bike_route_1 = require("../modules/bike/bike.route");
const engineOilType_route_1 = require("../modules/engineOilType/engineOilType.route");
const fuelLog_route_1 = require("../modules/fuelLog/fuelLog.route");
const maintenanceLog_route_1 = require("../modules/maintenanceLog/maintenanceLog.route");
const maintenanceType_route_1 = require("../modules/maintenanceType/maintenanceType.route");
const mileageRecord_route_1 = require("../modules/mileageRecord/mileageRecord.route");
const spending_route_1 = require("../modules/spending/spending.route");
const user_route_1 = require("../modules/user/user.route");
const router = (0, express_1.Router)();
const routeArray = [
    {
        path: "/auth",
        route: user_route_1.userRouter,
    },
    {
        path: "/bikes",
        route: bike_route_1.bikeRouter,
    },
    {
        path: "/bikes/:bikeId/fuel-logs",
        route: fuelLog_route_1.fuelLogRouter,
    },
    {
        path: "/bikes/:bikeId/mileage",
        route: mileageRecord_route_1.mileageRecordRouter,
    },
    {
        path: "/maintenance-types",
        route: maintenanceType_route_1.maintenanceTypeRouter,
    },
    {
        path: "/engine-oil-types",
        route: engineOilType_route_1.engineOilTypeRouter,
    },
    {
        path: "/bikes/:bikeId/maintenance-logs",
        route: maintenanceLog_route_1.maintenanceLogRouter,
    },
    {
        path: "/bikes/:bikeId/reminders",
        route: maintenanceLog_route_1.reminderRouter,
    },
    {
        path: "/bikes/:bikeId/spending-summary",
        route: spending_route_1.spendingRouter,
    },
];
routeArray.forEach((item) => {
    router.use(item.path, item.route);
});
exports.MainRouter = router;
