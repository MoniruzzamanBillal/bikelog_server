"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.maintenanceLogValidations = void 0;
const zod_1 = require("zod");
const createMaintenanceLogSchema = zod_1.z.object({
    body: zod_1.z.object({
        maintenanceType: zod_1.z.string({
            required_error: "Maintenance type is required",
        }),
        odometerReading: zod_1.z.number({
            required_error: "Odometer reading is required",
        }),
        oilType: zod_1.z.string().optional(),
        intervalKmUsed: zod_1.z.number({
            required_error: "Interval km used is required",
        }),
        nextDueDate: zod_1.z.coerce.date().optional(),
        cost: zod_1.z.number({ required_error: "Cost is required" }).nonnegative(),
        serviceDate: zod_1.z.coerce.date().optional(),
        serviceCenter: zod_1.z.string().optional(),
        partsReplaced: zod_1.z.array(zod_1.z.string()).optional(),
        notes: zod_1.z.string().optional(),
    }),
});
const updateMaintenanceLogSchema = zod_1.z.object({
    body: zod_1.z.object({
        maintenanceType: zod_1.z.string().optional(),
        odometerReading: zod_1.z.number().optional(),
        oilType: zod_1.z.string().optional(),
        intervalKmUsed: zod_1.z.number().optional(),
        nextDueDate: zod_1.z.coerce.date().optional(),
        cost: zod_1.z.number().nonnegative().optional(),
        serviceDate: zod_1.z.coerce.date().optional(),
        serviceCenter: zod_1.z.string().optional(),
        partsReplaced: zod_1.z.array(zod_1.z.string()).optional(),
        notes: zod_1.z.string().optional(),
    }),
});
//
exports.maintenanceLogValidations = {
    createMaintenanceLogSchema,
    updateMaintenanceLogSchema,
};
