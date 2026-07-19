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

//
export const bikeValidations = {
  createBikeSchema,
  updateBikeSchema,
};
