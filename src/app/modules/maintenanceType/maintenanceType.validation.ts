import { z } from "zod";

const createMaintenanceTypeSchema = z.object({
  body: z.object({
    // ! trimmed + non-empty (spec 50): "" and "   " used to create an unnamed catalog row, and
    // ! trimming keeps a trailing space from slipping past the case-insensitive duplicate check
    name: z.string({ required_error: "Name is required" }).trim().min(1, "Name is required"),
    defaultIntervalKm: z.number().positive().nullable().optional(),
    defaultIntervalDays: z.number().positive().nullable().optional(),
    // ! Spec 46 §G. No `ownerId` key here or below — it comes from the JWT, never the body.
    requiresOilType: z.boolean().optional(),
  }),
});

const updateMaintenanceTypeSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, "Name can't be empty").optional(),
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
