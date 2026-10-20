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
// ! Spec 53 — validation schema for updating the logged-in user's own display name.
// ! `trim()` runs BEFORE `min(1)`, so "   " is a 400 and never a saved blank name (its H1).
// ! `name` is `String` NOT NULL in the schema, so a null/empty write would either throw a raw
// ! Prisma error or leave a user with no name in every screen that renders one.
const updateProfileSchema = zod_1.z.object({
    body: zod_1.z.object({
        name: zod_1.z
            .string({ required_error: "User name is required" })
            .trim()
            .min(1, { message: "Name cannot be empty" })
            .max(60, { message: "Name must be 60 characters or fewer" }),
        // ! Spec 55 — the email is deliberately NOT editable, and this line is what makes a
        // ! client that tries say so out loud. `z.undefined()` accepts an ABSENT key and refuses
        // ! a present one with `invalid_type_error`, so the honest request (`{ name }`) is
        // ! unaffected while `{ name, email }` is a 400 naming the reason.
        // !
        // ! Why this needs a line at all: a plain Zod object **strips** unknown keys silently, so
        // ! before this the API answered `200 Profile updated successfully!!!` to a request that
        // ! asked to change the address and changed nothing. A client could not tell a refusal
        // ! from a success, which is the worst of the three possible behaviours.
        // !
        // ! This is the OUTER of two layers and the only one that produces a message. The real
        // ! guarantee is in the service: `updateProfile` writes `data: { name }` and nothing
        // ! else, so no field on `users` except `name` is reachable through this route even if
        // ! this schema were bypassed. Same for `password`, `userRole` and `isDeleted` — they
        // ! have no line here because they were never even plausible, whereas `email` sits
        // ! visibly on the Settings screen right next to the name.
        email: zod_1.z.undefined({
            invalid_type_error: "Email can't be changed. It is the account's login identifier.",
        }),
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
    updateProfileSchema,
    pushTokenSchema,
};
