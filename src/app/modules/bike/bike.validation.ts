import { z } from "zod";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// ! up to 24h ahead, not "<= now": "YYYY-MM-DD" parses as midnight UTC, so a user east of UTC
// ! entering today's date just after their local midnight is still "tomorrow" in UTC. 2099 is
// ! refused. Evaluated per request because refine runs at parse time (spec 50)
const notInTheFuture = (d: Date) => d.getTime() <= Date.now() + ONE_DAY_MS;

const createBikeSchema = z.object({
  body: z.object({
    nickname: z.string({ required_error: "Nickname is required" }),
    brand: z.string({ required_error: "Brand is required" }),
    model: z.string({ required_error: "Model is required" }),
    registrationNumber: z.string({
      required_error: "Registration number is required",
    }),
    purchaseDate: z.coerce
      .date({ required_error: "Purchase date is required" })
      .refine(notInTheFuture, "Purchase date can't be in the future"),
    fuelTankCapacityLiters: z
      .number({ required_error: "Fuel tank capacity is required" })
      .positive(),
    currentOdometer: z.number().nonnegative().optional(),
  }),
});

const updateBikeSchema = z.object({
  body: z.object({
    nickname: z.string().optional(),
    brand: z.string().optional(),
    model: z.string().optional(),
    registrationNumber: z.string().optional(),
    purchaseDate: z.coerce
      .date()
      .refine(notInTheFuture, "Purchase date can't be in the future")
      .optional(),
    fuelTankCapacityLiters: z.number().positive().optional(),
    currentOdometer: z.number().nonnegative().optional(),
  }),
});

const updateOdometerSchema = z.object({
  body: z.object({
    // ! finite + max: z.number() accepts Infinity and Postgres stores it, which would wedge the
    // ! bike's odometer for good (lower values are refused). 999999 matches the clients' create cap.
    currentOdometer: z
      .number({ required_error: "Odometer reading is required" })
      .finite("Odometer reading must be a finite number")
      .nonnegative()
      .max(999999, "Odometer reading can't exceed 999,999 km"),
  }),
});

//
export const bikeValidations = {
  createBikeSchema,
  updateBikeSchema,
  updateOdometerSchema,
};
