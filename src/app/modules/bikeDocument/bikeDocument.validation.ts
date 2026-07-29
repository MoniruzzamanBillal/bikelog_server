import { z } from "zod";

const createBikeDocumentSchema = z.object({
  body: z.object({
    title: z.string({ required_error: "Title is required" }),
    description: z.string().optional(),
    expiryDate: z.coerce.date().optional(),
  }),
});

const updateBikeDocumentSchema = z.object({
  body: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    expiryDate: z.coerce.date().optional(),
  }),
});

//
export const bikeDocumentValidations = {
  createBikeDocumentSchema,
  updateBikeDocumentSchema,
};
