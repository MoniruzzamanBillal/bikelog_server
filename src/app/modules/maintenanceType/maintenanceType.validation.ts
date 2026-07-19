import { z } from "zod";

const createMaintenanceTypeSchema = z.object({
  body: z.object({
    name: z.string({ required_error: "Name is required" }),
    defaultIntervalKm: z.number().positive().nullable().optional(),
    defaultIntervalDays: z.number().positive().nullable().optional(),
  }),
});

//
export const maintenanceTypeValidations = {
  createMaintenanceTypeSchema,
};
