"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fuelLogValidations = void 0;
const zod_1 = require("zod");
const createFuelLogSchema = zod_1.z.object({
    body: zod_1.z.object({
        odometerReading: zod_1.z.number({
            required_error: "Odometer reading is required",
        }),
        litersAdded: zod_1.z.number({ required_error: "Liters added is required" }).positive(),
        isFullTank: zod_1.z.boolean({ required_error: "isFullTank is required" }),
        pricePerLiter: zod_1.z
            .number({ required_error: "Price per liter is required" })
            .positive(),
        totalCost: zod_1.z.number().positive().optional(),
        fuelStation: zod_1.z.string().optional(),
        date: zod_1.z.coerce.date().optional(),
        notes: zod_1.z.string().optional(),
    }),
});
const updateFuelLogSchema = zod_1.z.object({
    body: zod_1.z.object({
        odometerReading: zod_1.z.number().optional(),
        litersAdded: zod_1.z.number().positive().optional(),
        isFullTank: zod_1.z.boolean().optional(),
        pricePerLiter: zod_1.z.number().positive().optional(),
        totalCost: zod_1.z.number().positive().optional(),
        fuelStation: zod_1.z.string().optional(),
        date: zod_1.z.coerce.date().optional(),
        notes: zod_1.z.string().optional(),
    }),
});
//
exports.fuelLogValidations = {
    createFuelLogSchema,
    updateFuelLogSchema,
};
