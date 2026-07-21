import { z } from "zod";
import { AccessoryStatus, AccessoryUrgency } from "./bikeAccessory.constant";

const urgencyEnum = Object.values(AccessoryUrgency) as [string, ...string[]];
const statusEnum = Object.values(AccessoryStatus) as [string, ...string[]];

const createBikeAccessorySchema = z.object({
  body: z.object({
    name: z.string({ required_error: "name is required" }),
    urgency: z.enum(urgencyEnum, {
      required_error: "urgency is required",
    }),
    status: z.enum(statusEnum).optional(),
  }),
});

const updateBikeAccessorySchema = z.object({
  body: z.object({
    name: z.string().optional(),
    urgency: z.enum(urgencyEnum).optional(),
    status: z.enum(statusEnum).optional(),
  }),
});

//
export const bikeAccessoryValidations = {
  createBikeAccessorySchema,
  updateBikeAccessorySchema,
};
