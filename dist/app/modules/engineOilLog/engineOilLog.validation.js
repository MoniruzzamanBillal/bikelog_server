"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.engineOilLogValidations = void 0;
const zod_1 = require("zod");
// ! reused verbatim from fuelLog.validation.ts — bounded because z.number() alone accepts
// ! Infinity (raw body 1e999) and negatives, both of which Postgres stores happily
// ! (specs 45/48/50)
const odometerReadingField = zod_1.z
    .number({
    required_error: "Odometer reading is required",
    invalid_type_error: "Odometer reading must be a number",
})
    .finite("Odometer reading must be a finite number")
    .nonnegative("Odometer reading can't be negative")
    .max(999999, "Odometer reading can't exceed 999,999 km");
const createEngineOilLogSchema = zod_1.z.object({
    body: zod_1.z.object({
        // ! D2/H7: REQUIRED here even though the column is nullable. The column is nullable so
        // ! §H's import can carry historical maintenance logs that never had an oil type; a
        // ! row entered through this API always has one. The two rules differ on purpose.
        oilType: zod_1.z
            .string({ required_error: "Engine oil type is required" })
            .min(1, "Engine oil type is required"),
        odometerReading: odometerReadingField,
        // ! D3: normally sent by the client, pre-filled from the oil type's suggestedIntervalKm
        // ! and editable by the rider. Omitted, the service falls back to the catalog value.
        intervalKmUsed: zod_1.z.number().finite().positive().max(100000).optional(),
        quantityLiters: zod_1.z.number().finite().positive().max(20).optional(),
        oilFilterChanged: zod_1.z.boolean().optional(),
        cost: zod_1.z
            .number({ required_error: "Cost is required" })
            .finite()
            .nonnegative()
            .max(9999999.99),
        changeDate: zod_1.z.coerce.date().optional(),
        serviceCenter: zod_1.z.string().max(100).optional(),
        notes: zod_1.z.string().max(500).optional(),
    }),
});
// ! every field optional; `oilType` may be re-pointed but never cleared (D2), which `.min(1)`
// ! enforces — there is no way to submit it as empty or null. `nextDueOdometer` is absent
// ! from BOTH schemas: server-derived only (D3).
const updateEngineOilLogSchema = zod_1.z.object({
    body: zod_1.z.object({
        oilType: zod_1.z.string().min(1, "Engine oil type can't be empty").optional(),
        odometerReading: odometerReadingField.optional(),
        intervalKmUsed: zod_1.z.number().finite().positive().max(100000).optional(),
        quantityLiters: zod_1.z.number().finite().positive().max(20).optional(),
        oilFilterChanged: zod_1.z.boolean().optional(),
        cost: zod_1.z.number().finite().nonnegative().max(9999999.99).optional(),
        changeDate: zod_1.z.coerce.date().optional(),
        serviceCenter: zod_1.z.string().max(100).optional(),
        notes: zod_1.z.string().max(500).optional(),
    }),
});
//
exports.engineOilLogValidations = {
    createEngineOilLogSchema,
    updateEngineOilLogSchema,
};
