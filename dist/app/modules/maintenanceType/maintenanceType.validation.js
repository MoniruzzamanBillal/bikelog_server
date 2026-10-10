"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.maintenanceTypeValidations = void 0;
const zod_1 = require("zod");
const createMaintenanceTypeSchema = zod_1.z.object({
    body: zod_1.z.object({
        // ! trimmed + non-empty (spec 50): "" and "   " used to create an unnamed catalog row, and
        // ! trimming keeps a trailing space from slipping past the case-insensitive duplicate check
        name: zod_1.z.string({ required_error: "Name is required" }).trim().min(1, "Name is required"),
        defaultIntervalKm: zod_1.z.number().positive().nullable().optional(),
        defaultIntervalDays: zod_1.z.number().positive().nullable().optional(),
        // ! Spec 46 §G. No `ownerId` key here or below — it comes from the JWT, never the body.
        requiresOilType: zod_1.z.boolean().optional(),
    }),
});
const updateMaintenanceTypeSchema = zod_1.z.object({
    body: zod_1.z.object({
        name: zod_1.z.string().trim().min(1, "Name can't be empty").optional(),
        defaultIntervalKm: zod_1.z.number().positive().nullable().optional(),
        defaultIntervalDays: zod_1.z.number().positive().nullable().optional(),
        requiresOilType: zod_1.z.boolean().optional(),
    }),
});
//
exports.maintenanceTypeValidations = {
    createMaintenanceTypeSchema,
    updateMaintenanceTypeSchema,
};
