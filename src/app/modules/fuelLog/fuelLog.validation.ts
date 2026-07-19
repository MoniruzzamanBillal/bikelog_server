import { z } from "zod";

const createFuelLogSchema = z.object({
  body: z.object({
    odometerReading: z.number({
      required_error: "Odometer reading is required",
    }),
    litersAdded: z.number({ required_error: "Liters added is required" }).positive(),
    isFullTank: z.boolean({ required_error: "isFullTank is required" }),
    pricePerLiter: z
      .number({ required_error: "Price per liter is required" })
      .positive(),
    totalCost: z.number().positive().optional(),
    fuelStation: z.string().optional(),
    date: z.coerce.date().optional(),
    notes: z.string().optional(),
  }),
});

const updateFuelLogSchema = z.object({
  body: z.object({
    odometerReading: z.number().optional(),
    litersAdded: z.number().positive().optional(),
    isFullTank: z.boolean().optional(),
    pricePerLiter: z.number().positive().optional(),
    totalCost: z.number().positive().optional(),
    fuelStation: z.string().optional(),
    date: z.coerce.date().optional(),
    notes: z.string().optional(),
  }),
});

//
export const fuelLogValidations = {
  createFuelLogSchema,
  updateFuelLogSchema,
};
