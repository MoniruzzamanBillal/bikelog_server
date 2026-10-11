"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userValidations = void 0;
const zod_1 = require("zod");
// Validation schema for creating a new user
const createUserSchema = zod_1.z.object({
    body: zod_1.z.object({
        name: zod_1.z.string({ required_error: "User name is required" }),
        email: zod_1.z
            .string({ required_error: "User email is required" })
            .email({ message: "Invalid email address" }),
        password: zod_1.z
            .string({ required_error: "User password is required" })
            .min(6, { message: "Password must be at least 6 characters long" }),
    }),
});
// Validation schema for login
const loginValidationSchema = zod_1.z.object({
    body: zod_1.z.object({
        email: zod_1.z.string().email({ message: "Invalid email address" }),
        password: zod_1.z.string().min(1, { message: "Password cannot be empty" }),
    }),
});
// ! Spec 51 — validation schema for the refresh-token exchange. A missing or non-string
// ! `refreshToken` is a 400 from validateRequest, never the 401 that means "your session is
// ! over": the client must not log the user out over its own malformed request.
const refreshTokenSchema = zod_1.z.object({
    body: zod_1.z.object({
        refreshToken: zod_1.z
            .string({ required_error: "refreshToken is required" })
            .min(1, { message: "refreshToken cannot be empty" }),
    }),
});
// Validation schema for registering/updating this device's Expo push token
const pushTokenSchema = zod_1.z.object({
    body: zod_1.z.object({
        expoPushToken: zod_1.z.string({
            required_error: "expoPushToken is required",
        }).min(1, { message: "expoPushToken cannot be empty" }),
    }),
});
//
exports.userValidations = {
    createUserSchema,
    loginValidationSchema,
    refreshTokenSchema,
    pushTokenSchema,
};
