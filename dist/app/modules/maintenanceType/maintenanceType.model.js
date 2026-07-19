"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.maintenanceTypeModel = void 0;
const mongoose_1 = require("mongoose");
// ! no soft delete — small shared/seeded catalog, not user-owned data
const maintenanceTypeSchema = new mongoose_1.Schema({
    name: {
        type: String,
        required: [true, "maintenance type name is required "],
        unique: true,
    },
    defaultIntervalKm: {
        type: Number,
        default: null,
    },
    defaultIntervalDays: {
        type: Number,
        default: null,
    },
}, { timestamps: true });
//
exports.maintenanceTypeModel = (0, mongoose_1.model)("MaintenanceType", maintenanceTypeSchema);
