import { z } from "zod";

const createBikeSchema = z.object({
  body: z.object({
    nickname: z.string({ required_error: "Nickname is required" }),
    brand: z.string({ required_error: "Brand is required" }),
    model: z.string({ required_error: "Model is required" }),
    registrationNumber: z.string({
      required_error: "Registration number is required",
    }),
    purchaseDate: z.coerce.date({
      required_error: "Purchase date is required",
    }),
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
    purchaseDate: z.coerce.date().optional(),
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
