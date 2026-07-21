"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bikeIssueValidations = void 0;
const zod_1 = require("zod");
const bikeIssue_constant_1 = require("./bikeIssue.constant");
const createBikeIssueSchema = zod_1.z.object({
    body: zod_1.z.object({
        title: zod_1.z.string({ required_error: "Title is required" }),
        description: zod_1.z.string().optional(),
        dateReported: zod_1.z.coerce.date().optional(),
    }),
});
const updateBikeIssueSchema = zod_1.z.object({
    body: zod_1.z.object({
        title: zod_1.z.string().optional(),
        description: zod_1.z.string().optional(),
        dateReported: zod_1.z.coerce.date().optional(),
    }),
});
const updateBikeIssueStatusSchema = zod_1.z.object({
    body: zod_1.z.object({
        status: zod_1.z.enum(Object.values(bikeIssue_constant_1.BikeIssueStatus), {
            required_error: "status is required",
        }),
    }),
});
//
exports.bikeIssueValidations = {
    createBikeIssueSchema,
    updateBikeIssueSchema,
    updateBikeIssueStatusSchema,
};
