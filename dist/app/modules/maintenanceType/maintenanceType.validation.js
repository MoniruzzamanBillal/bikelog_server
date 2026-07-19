"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.maintenanceTypeValidations = void 0;
const zod_1 = require("zod");
const createMaintenanceTypeSchema = zod_1.z.object({
    body: zod_1.z.object({
        name: zod_1.z.string({ required_error: "Name is required" }),
        defaultIntervalKm: zod_1.z.number().positive().nullable().optional(),
        defaultIntervalDays: zod_1.z.number().positive().nullable().optional(),
    }),
});
//
exports.maintenanceTypeValidations = {
    createMaintenanceTypeSchema,
};
