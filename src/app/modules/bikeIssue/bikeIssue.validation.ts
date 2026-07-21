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

const resolveBikeIssueSchema = z.object({
  body: z.object({
    resolvedInMaintenanceLog: z.string().optional(),
  }),
});

const reopenBikeIssueSchema = z.object({
  body: z.object({}),
});

//
export const bikeIssueValidations = {
  createBikeIssueSchema,
  updateBikeIssueSchema,
  resolveBikeIssueSchema,
  reopenBikeIssueSchema,
};
