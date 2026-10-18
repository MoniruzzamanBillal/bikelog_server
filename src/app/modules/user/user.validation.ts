import { z } from "zod";

// Validation schema for creating a new user
const createUserSchema = z.object({
  body: z.object({
    name: z.string({ required_error: "User name is required" }),
    email: z
      .string({ required_error: "User email is required" })
      .email({ message: "Invalid email address" }),
    password: z
      .string({ required_error: "User password is required" })
      .min(6, { message: "Password must be at least 6 characters long" }),
  }),
});

// Validation schema for login
const loginValidationSchema = z.object({
  body: z.object({
    email: z.string().email({ message: "Invalid email address" }),
    password: z.string().min(1, { message: "Password cannot be empty" }),
  }),
});

// ! Spec 51 — validation schema for the refresh-token exchange. A missing or non-string
// ! `refreshToken` is a 400 from validateRequest, never the 401 that means "your session is
// ! over": the client must not log the user out over its own malformed request.
const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z
      .string({ required_error: "refreshToken is required" })
      .min(1, { message: "refreshToken cannot be empty" }),
  }),
});

// ! Spec 53 — validation schema for updating the logged-in user's own display name.
// ! `trim()` runs BEFORE `min(1)`, so "   " is a 400 and never a saved blank name (its H1).
// ! `name` is `String` NOT NULL in the schema, so a null/empty write would either throw a raw
// ! Prisma error or leave a user with no name in every screen that renders one.
const updateProfileSchema = z.object({
  body: z.object({
    name: z
      .string({ required_error: "User name is required" })
      .trim()
      .min(1, { message: "Name cannot be empty" })
      .max(60, { message: "Name must be 60 characters or fewer" }),
  }),
});

// Validation schema for registering/updating this device's Expo push token
const pushTokenSchema = z.object({
  body: z.object({
    expoPushToken: z.string({
      required_error: "expoPushToken is required",
    }).min(1, { message: "expoPushToken cannot be empty" }),
  }),
});

//
export const userValidations = {
  createUserSchema,
  loginValidationSchema,
  refreshTokenSchema,
  updateProfileSchema,
  pushTokenSchema,
};
