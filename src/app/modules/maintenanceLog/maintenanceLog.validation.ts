import { z } from "zod";

// ! bounded like the fuel-log and manual odometer fields (specs 45/48): z.number() alone accepts
// ! Infinity (raw body 1e999), which would wedge the bike's odometer for good (spec 50 §E)
const odometerReadingField = z
  .number({
    required_error: "Odometer reading is required",
    invalid_type_error: "Odometer reading must be a number",
  })
  .finite("Odometer reading must be a finite number")
  .nonnegative("Odometer reading can't be negative")
  .max(999999, "Odometer reading can't exceed 999,999 km");

const createMaintenanceLogSchema = z.object({
  body: z.object({
    maintenanceType: z.string({
      required_error: "Maintenance type is required",
    }),
    odometerReading: odometerReadingField,
    oilType: z.string().optional(),
    intervalKmUsed: z.number().optional(),
    nextDueDate: z.coerce.date().optional(),
    cost: z.number({ required_error: "Cost is required" }).nonnegative(),
    serviceDate: z.coerce.date().optional(),
    serviceCenter: z.string().optional(),
    partsReplaced: z.array(z.string()).optional(),
    notes: z.string().optional(),
  }),
});

const updateMaintenanceLogSchema = z.object({
  body: z.object({
    maintenanceType: z.string().optional(),
    odometerReading: odometerReadingField.optional(),
    oilType: z.string().optional(),
    intervalKmUsed: z.number().optional(),
    nextDueDate: z.coerce.date().optional(),
    cost: z.number().nonnegative().optional(),
    serviceDate: z.coerce.date().optional(),
    serviceCenter: z.string().optional(),
    partsReplaced: z.array(z.string()).optional(),
    notes: z.string().optional(),
  }),
});

//
export const maintenanceLogValidations = {
  createMaintenanceLogSchema,
  updateMaintenanceLogSchema,
};
