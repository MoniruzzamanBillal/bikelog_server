"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bikeAccessoryValidations = void 0;
const zod_1 = require("zod");
const bikeAccessory_constant_1 = require("./bikeAccessory.constant");
const urgencyEnum = Object.values(bikeAccessory_constant_1.AccessoryUrgency);
const statusEnum = Object.values(bikeAccessory_constant_1.AccessoryStatus);
const createBikeAccessorySchema = zod_1.z.object({
    body: zod_1.z.object({
        name: zod_1.z.string({ required_error: "name is required" }),
        urgency: zod_1.z.enum(urgencyEnum, {
            required_error: "urgency is required",
        }),
        status: zod_1.z.enum(statusEnum).optional(),
    }),
});
const updateBikeAccessorySchema = zod_1.z.object({
    body: zod_1.z.object({
        name: zod_1.z.string().optional(),
        urgency: zod_1.z.enum(urgencyEnum).optional(),
        status: zod_1.z.enum(statusEnum).optional(),
    }),
});
//
exports.bikeAccessoryValidations = {
    createBikeAccessorySchema,
    updateBikeAccessorySchema,
};
