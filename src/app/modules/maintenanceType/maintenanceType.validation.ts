import { z } from "zod";

const createMaintenanceTypeSchema = z.object({
  body: z.object({
    name: z.string({ required_error: "Name is required" }),
    defaultIntervalKm: z.number().positive().nullable().optional(),
    defaultIntervalDays: z.number().positive().nullable().optional(),
    // ! Spec 46 §G. No `ownerId` key here or below — it comes from the JWT, never the body.
    requiresOilType: z.boolean().optional(),
  }),
});

const updateMaintenanceTypeSchema = z.object({
  body: z.object({
    name: z.string().optional(),
    defaultIntervalKm: z.number().positive().nullable().optional(),
    defaultIntervalDays: z.number().positive().nullable().optional(),
    requiresOilType: z.boolean().optional(),
  }),
});

//
export const maintenanceTypeValidations = {
  createMaintenanceTypeSchema,
  updateMaintenanceTypeSchema,
};
