import { z } from "zod";

const createEngineOilTypeSchema = z.object({
  body: z.object({
    name: z.string({ required_error: "Name is required" }),
    suggestedIntervalKm: z.number({
      required_error: "Suggested interval is required",
    }).positive(),
  }),
});

const updateEngineOilTypeSchema = z.object({
  body: z.object({
    name: z.string().optional(),
    suggestedIntervalKm: z.number().positive().optional(),
  }),
});

//
export const engineOilTypeValidations = {
  createEngineOilTypeSchema,
  updateEngineOilTypeSchema,
};
