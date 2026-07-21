"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bikeIssueValidations = void 0;
const zod_1 = require("zod");
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
const resolveBikeIssueSchema = zod_1.z.object({
    body: zod_1.z.object({
        resolvedInMaintenanceLog: zod_1.z.string().optional(),
    }),
});
const reopenBikeIssueSchema = zod_1.z.object({
    body: zod_1.z.object({}),
});
//
exports.bikeIssueValidations = {
    createBikeIssueSchema,
    updateBikeIssueSchema,
    resolveBikeIssueSchema,
    reopenBikeIssueSchema,
};
