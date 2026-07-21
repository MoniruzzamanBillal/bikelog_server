import { z } from "zod";

const createBikeIssueSchema = z.object({
  body: z.object({
    title: z.string({ required_error: "Title is required" }),
    description: z.string().optional(),
    dateReported: z.coerce.date().optional(),
  }),
});

const updateBikeIssueSchema = z.object({
  body: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    dateReported: z.coerce.date().optional(),
  }),
});

const updateBikeIssueStatusSchema = z.object({
  body: z.object({
    status: z.string(),
  }),
});

const reopenBikeIssueSchema = z.object({
  body: z.object({}),
});

//
export const bikeIssueValidations = {
  createBikeIssueSchema,
  updateBikeIssueSchema,
  updateBikeIssueStatusSchema,
  reopenBikeIssueSchema,
};
