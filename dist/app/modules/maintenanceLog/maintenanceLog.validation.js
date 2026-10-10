"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.maintenanceLogValidations = void 0;
const zod_1 = require("zod");
// ! bounded like the fuel-log and manual odometer fields (specs 45/48): z.number() alone accepts
// ! Infinity (raw body 1e999), which would wedge the bike's odometer for good (spec 50 §E)
const odometerReadingField = zod_1.z
    .number({
    required_error: "Odometer reading is required",
    invalid_type_error: "Odometer reading must be a number",
})
    .finite("Odometer reading must be a finite number")
    .nonnegative("Odometer reading can't be negative")
    .max(999999, "Odometer reading can't exceed 999,999 km");
const createMaintenanceLogSchema = zod_1.z.object({
    body: zod_1.z.object({
        maintenanceType: zod_1.z.string({
            required_error: "Maintenance type is required",
        }),
        odometerReading: odometerReadingField,
        oilType: zod_1.z.string().optional(),
        intervalKmUsed: zod_1.z.number().optional(),
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
        odometerReading: odometerReadingField.optional(),
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
