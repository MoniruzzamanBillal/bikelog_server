import { z } from "zod";

const createMaintenanceLogSchema = z.object({
  body: z.object({
    maintenanceType: z.string({
      required_error: "Maintenance type is required",
    }),
    odometerReading: z.number({
      required_error: "Odometer reading is required",
    }),
    oilType: z.string().optional(),
    intervalKmUsed: z.number({
      required_error: "Interval km used is required",
    }),
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
    odometerReading: z.number().optional(),
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
