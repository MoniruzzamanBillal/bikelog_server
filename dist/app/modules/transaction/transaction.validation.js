"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transactionValidationSchemas = void 0;
const zod_1 = require("zod");
const createTransactionSchema = zod_1.z.object({
    body: zod_1.z.object({
        type: zod_1.z.enum(["income", "expense"]),
        title: zod_1.z.string().min(1, "Title is required"),
        description: zod_1.z.string().optional(),
        amount: zod_1.z.number().positive("Amount must be greater than 0"),
    }),
});
const updateTransactionSchema = zod_1.z.object({
    body: zod_1.z.object({
        type: zod_1.z.enum(["income", "expense"]).optional(),
        title: zod_1.z.string().min(1).optional(),
        description: zod_1.z.string().optional(),
        amount: zod_1.z.number().positive().optional(),
    }),
});
//
exports.transactionValidationSchemas = {
    createTransactionSchema,
    updateTransactionSchema,
};
