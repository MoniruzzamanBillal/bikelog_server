import { z } from "zod";

// ! reused verbatim from fuelLog.validation.ts — bounded because z.number() alone accepts
// ! Infinity (raw body 1e999) and negatives, both of which Postgres stores happily
// ! (specs 45/48/50)
const odometerReadingField = z
  .number({
    required_error: "Odometer reading is required",
    invalid_type_error: "Odometer reading must be a number",
  })
  .finite("Odometer reading must be a finite number")
  .nonnegative("Odometer reading can't be negative")
  .max(999999, "Odometer reading can't exceed 999,999 km");

const createEngineOilLogSchema = z.object({
  body: z.object({
    // ! D2/H7: REQUIRED here even though the column is nullable. The column is nullable so
    // ! §H's import can carry historical maintenance logs that never had an oil type; a
    // ! row entered through this API always has one. The two rules differ on purpose.
    oilType: z
      .string({ required_error: "Engine oil type is required" })
      .min(1, "Engine oil type is required"),
    odometerReading: odometerReadingField,
    // ! D3: normally sent by the client, pre-filled from the oil type's suggestedIntervalKm
    // ! and editable by the rider. Omitted, the service falls back to the catalog value.
    intervalKmUsed: z.number().finite().positive().max(100000).optional(),
    quantityLiters: z.number().finite().positive().max(20).optional(),
    oilFilterChanged: z.boolean().optional(),
    cost: z
      .number({ required_error: "Cost is required" })
      .finite()
      .nonnegative()
      .max(9999999.99),
    changeDate: z.coerce.date().optional(),
    serviceCenter: z.string().max(100).optional(),
    notes: z.string().max(500).optional(),
  }),
});

// ! every field optional; `oilType` may be re-pointed but never cleared (D2), which `.min(1)`
// ! enforces — there is no way to submit it as empty or null. `nextDueOdometer` is absent
// ! from BOTH schemas: server-derived only (D3).
const updateEngineOilLogSchema = z.object({
  body: z.object({
    oilType: z.string().min(1, "Engine oil type can't be empty").optional(),
    odometerReading: odometerReadingField.optional(),
    intervalKmUsed: z.number().finite().positive().max(100000).optional(),
    quantityLiters: z.number().finite().positive().max(20).optional(),
    oilFilterChanged: z.boolean().optional(),
    cost: z.number().finite().nonnegative().max(9999999.99).optional(),
    changeDate: z.coerce.date().optional(),
    serviceCenter: z.string().max(100).optional(),
    notes: z.string().max(500).optional(),
  }),
});

//
export const engineOilLogValidations = {
  createEngineOilLogSchema,
  updateEngineOilLogSchema,
};
