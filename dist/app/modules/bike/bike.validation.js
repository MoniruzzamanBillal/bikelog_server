"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bikeValidations = void 0;
const zod_1 = require("zod");
const createBikeSchema = zod_1.z.object({
    body: zod_1.z.object({
        nickname: zod_1.z.string({ required_error: "Nickname is required" }),
        brand: zod_1.z.string({ required_error: "Brand is required" }),
        model: zod_1.z.string({ required_error: "Model is required" }),
        registrationNumber: zod_1.z.string({
            required_error: "Registration number is required",
        }),
        purchaseDate: zod_1.z.coerce.date({
            required_error: "Purchase date is required",
        }),
        fuelTankCapacityLiters: zod_1.z
            .number({ required_error: "Fuel tank capacity is required" })
            .positive(),
        currentOdometer: zod_1.z.number().nonnegative().optional(),
    }),
});
const updateBikeSchema = zod_1.z.object({
    body: zod_1.z.object({
        nickname: zod_1.z.string().optional(),
        brand: zod_1.z.string().optional(),
        model: zod_1.z.string().optional(),
        registrationNumber: zod_1.z.string().optional(),
        purchaseDate: zod_1.z.coerce.date().optional(),
        fuelTankCapacityLiters: zod_1.z.number().positive().optional(),
        currentOdometer: zod_1.z.number().nonnegative().optional(),
    }),
});
//
exports.bikeValidations = {
    createBikeSchema,
    updateBikeSchema,
};
