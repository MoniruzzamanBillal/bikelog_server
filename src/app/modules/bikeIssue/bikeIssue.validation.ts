import { z } from "zod";
import { BikeIssueStatus } from "./bikeIssue.constant";

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
    status: z.enum(Object.values(BikeIssueStatus) as [string, ...string[]], {
      required_error: "status is required",
    }),
  }),
});

//
export const bikeIssueValidations = {
  createBikeIssueSchema,
  updateBikeIssueSchema,
  updateBikeIssueStatusSchema,
};
