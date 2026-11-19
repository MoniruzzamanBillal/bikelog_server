import { z } from "zod";

// ! bounded like fuelLog/engineOilLog: z.number() alone accepts Infinity (raw body 1e999)
// ! and negatives, both of which Postgres stores happily (specs 45/48/50).
const odometerReadingField = z
  .number()
  .finite("Odometer reading must be a finite number")
  .nonnegative("Odometer reading can't be negative")
  .max(999999, "Odometer reading can't exceed 999,999 km");

const itemSchema = z.object({
  // ! id accepted but not trusted — the service regenerates any missing one and preserves a
  // ! provided one (so a recommendation/item survives a round-trip edit).
  id: z.string().optional(),
  name: z.string().min(1, "Item name is required").max(100),
  cost: z.number().finite().nonnegative().max(9999999.99).optional(),
});

const recommendationSchema = z.object({
  id: z.string().optional(),
  text: z.string().min(1, "Recommendation text is required").max(300),
  targetDate: z.coerce.date().optional().nullable(),
  targetOdometer: z
    .number()
    .finite()
    .nonnegative()
    .max(999999)
    .optional()
    .nullable(),
  done: z.boolean().optional(),
});

const serviceKindField = z.enum(["warranty", "regular"]);
const centerTypeField = z.enum(["official", "local"]);
// ! 1..5: the plan's five warranty services. Optional — auto-assigned on create when a
// ! warranty service omits it. `status` is deliberately NOT a field in either schema: it is
// ! server-derived from serviceDate presence (spec 67 §Decisions 5).
const warrantyNumberField = z.number().int().min(1).max(5);

const createServiceLogSchema = z.object({
  body: z
    .object({
      serviceKind: serviceKindField.optional(),
      warrantyNumber: warrantyNumberField.optional(),
      dueDate: z.coerce.date().optional(),
      serviceDate: z.coerce.date().optional(),
      odometerReading: odometerReadingField.optional(),
      serviceCenter: z.string().max(100).optional(),
      centerType: centerTypeField.optional(),
      items: z.array(itemSchema).max(50).optional(),
      recommendations: z.array(recommendationSchema).max(50).optional(),
      notes: z.string().max(1000).optional(),
    })
    // ! a service is either scheduled (dueDate) or already done (serviceDate) — an entry
    // ! with neither has no place on the timeline and no way to derive a status.
    .refine((b) => b.dueDate != null || b.serviceDate != null, {
      message: "A service needs a due date or a service date",
      path: ["dueDate"],
    }),
});

const updateServiceLogSchema = z.object({
  body: z.object({
    serviceKind: serviceKindField.optional(),
    warrantyNumber: warrantyNumberField.optional(),
    dueDate: z.coerce.date().optional().nullable(),
    serviceDate: z.coerce.date().optional().nullable(),
    odometerReading: odometerReadingField.optional().nullable(),
    serviceCenter: z.string().max(100).optional().nullable(),
    centerType: centerTypeField.optional().nullable(),
    items: z.array(itemSchema).max(50).optional(),
    recommendations: z.array(recommendationSchema).max(50).optional(),
    notes: z.string().max(1000).optional().nullable(),
  }),
});

export const serviceLogValidations = {
  createServiceLogSchema,
  updateServiceLogSchema,
};
