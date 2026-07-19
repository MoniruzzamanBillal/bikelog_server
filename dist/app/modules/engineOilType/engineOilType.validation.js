"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.engineOilTypeValidations = void 0;
const zod_1 = require("zod");
const createEngineOilTypeSchema = zod_1.z.object({
    body: zod_1.z.object({
        name: zod_1.z.string({ required_error: "Name is required" }),
        suggestedIntervalKm: zod_1.z.number({
            required_error: "Suggested interval is required",
        }).positive(),
    }),
});
//
exports.engineOilTypeValidations = {
    createEngineOilTypeSchema,
};
