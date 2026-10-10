"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.engineOilTypeValidations = void 0;
const zod_1 = require("zod");
const createEngineOilTypeSchema = zod_1.z.object({
    body: zod_1.z.object({
        // ! trimmed + non-empty, same rule as the maintenance catalog (spec 50)
        name: zod_1.z.string({ required_error: "Name is required" }).trim().min(1, "Name is required"),
        suggestedIntervalKm: zod_1.z.number({
            required_error: "Suggested interval is required",
        }).positive(),
    }),
});
const updateEngineOilTypeSchema = zod_1.z.object({
    body: zod_1.z.object({
        name: zod_1.z.string().trim().min(1, "Name can't be empty").optional(),
        suggestedIntervalKm: zod_1.z.number().positive().optional(),
    }),
});
//
exports.engineOilTypeValidations = {
    createEngineOilTypeSchema,
    updateEngineOilTypeSchema,
};
