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
const updateOdometerSchema = zod_1.z.object({
    body: zod_1.z.object({
        // ! finite + max: z.number() accepts Infinity and Postgres stores it, which would wedge the
        // ! bike's odometer for good (lower values are refused). 999999 matches the clients' create cap.
        currentOdometer: zod_1.z
            .number({ required_error: "Odometer reading is required" })
            .finite("Odometer reading must be a finite number")
            .nonnegative()
            .max(999999, "Odometer reading can't exceed 999,999 km"),
    }),
});
//
exports.bikeValidations = {
    createBikeSchema,
    updateBikeSchema,
    updateOdometerSchema,
};
