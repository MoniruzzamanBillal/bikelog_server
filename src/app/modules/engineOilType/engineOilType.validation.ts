import { z } from "zod";

const createEngineOilTypeSchema = z.object({
  body: z.object({
    // ! trimmed + non-empty, same rule as the maintenance catalog (spec 50)
    name: z.string({ required_error: "Name is required" }).trim().min(1, "Name is required"),
    suggestedIntervalKm: z.number({
      required_error: "Suggested interval is required",
    }).positive(),
  }),
});

const updateEngineOilTypeSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, "Name can't be empty").optional(),
    suggestedIntervalKm: z.number().positive().optional(),
  }),
});

//
export const engineOilTypeValidations = {
  createEngineOilTypeSchema,
  updateEngineOilTypeSchema,
};
