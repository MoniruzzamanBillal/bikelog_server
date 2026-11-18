"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serviceLogValidations = void 0;
const zod_1 = require("zod");
// ! bounded like fuelLog/engineOilLog: z.number() alone accepts Infinity (raw body 1e999)
// ! and negatives, both of which Postgres stores happily (specs 45/48/50).
const odometerReadingField = zod_1.z
    .number()
    .finite("Odometer reading must be a finite number")
    .nonnegative("Odometer reading can't be negative")
    .max(999999, "Odometer reading can't exceed 999,999 km");
const itemSchema = zod_1.z.object({
    // ! id accepted but not trusted — the service regenerates any missing one and preserves a
    // ! provided one (so a recommendation/item survives a round-trip edit).
    id: zod_1.z.string().optional(),
    name: zod_1.z.string().min(1, "Item name is required").max(100),
    cost: zod_1.z.number().finite().nonnegative().max(9999999.99).optional(),
});
const recommendationSchema = zod_1.z.object({
    id: zod_1.z.string().optional(),
    text: zod_1.z.string().min(1, "Recommendation text is required").max(300),
    targetDate: zod_1.z.coerce.date().optional().nullable(),
    targetOdometer: zod_1.z
        .number()
        .finite()
        .nonnegative()
        .max(999999)
        .optional()
        .nullable(),
    done: zod_1.z.boolean().optional(),
});
const serviceKindField = zod_1.z.enum(["warranty", "regular"]);
const centerTypeField = zod_1.z.enum(["official", "local"]);
// ! 1..5: the plan's five warranty services. Optional — auto-assigned on create when a
// ! warranty service omits it. `status` is deliberately NOT a field in either schema: it is
// ! server-derived from serviceDate presence (spec 67 §Decisions 5).
const warrantyNumberField = zod_1.z.number().int().min(1).max(5);
const createServiceLogSchema = zod_1.z.object({
    body: zod_1.z
        .object({
        serviceKind: serviceKindField.optional(),
        warrantyNumber: warrantyNumberField.optional(),
        dueDate: zod_1.z.coerce.date().optional(),
        serviceDate: zod_1.z.coerce.date().optional(),
        odometerReading: odometerReadingField.optional(),
        serviceCenter: zod_1.z.string().max(100).optional(),
        centerType: centerTypeField.optional(),
        items: zod_1.z.array(itemSchema).max(50).optional(),
        recommendations: zod_1.z.array(recommendationSchema).max(50).optional(),
        notes: zod_1.z.string().max(1000).optional(),
    })
        // ! a service is either scheduled (dueDate) or already done (serviceDate) — an entry
        // ! with neither has no place on the timeline and no way to derive a status.
        .refine((b) => b.dueDate != null || b.serviceDate != null, {
        message: "A service needs a due date or a service date",
        path: ["dueDate"],
    }),
});
const updateServiceLogSchema = zod_1.z.object({
    body: zod_1.z.object({
        serviceKind: serviceKindField.optional(),
        warrantyNumber: warrantyNumberField.optional(),
        dueDate: zod_1.z.coerce.date().optional().nullable(),
        serviceDate: zod_1.z.coerce.date().optional().nullable(),
        odometerReading: odometerReadingField.optional().nullable(),
        serviceCenter: zod_1.z.string().max(100).optional().nullable(),
        centerType: centerTypeField.optional().nullable(),
        items: zod_1.z.array(itemSchema).max(50).optional(),
        recommendations: zod_1.z.array(recommendationSchema).max(50).optional(),
        notes: zod_1.z.string().max(1000).optional().nullable(),
    }),
});
exports.serviceLogValidations = {
    createServiceLogSchema,
    updateServiceLogSchema,
};
