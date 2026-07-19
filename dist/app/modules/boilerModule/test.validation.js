"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderValidationSchema = void 0;
const mongoose_1 = require("mongoose");
const zod_1 = require("zod");
exports.orderValidationSchema = zod_1.z.object({
    _id: zod_1.z.instanceof(mongoose_1.Types.ObjectId).optional(),
    __v: zod_1.z.number().optional(),
    email: zod_1.z.string().email(),
    productId: zod_1.z.string(),
    price: zod_1.z.number().positive(),
    quantity: zod_1.z.number().int().positive(),
});
