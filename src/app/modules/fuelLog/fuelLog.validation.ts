import { z } from "zod";

// ! bounded like the manual odometer endpoint (spec 45): z.number() alone accepts Infinity
// ! (raw body 1e999) and negatives, both of which Postgres stores happily (spec 48)
const odometerReadingField = z
  .number({
    required_error: "Odometer reading is required",
    invalid_type_error: "Odometer reading must be a number",
  })
  .finite("Odometer reading must be a finite number")
  .nonnegative("Odometer reading can't be negative")
  .max(999999, "Odometer reading can't exceed 999,999 km");

const createFuelLogSchema = z.object({
  body: z.object({
    odometerReading: odometerReadingField,
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
    odometerReading: odometerReadingField.optional(),
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
