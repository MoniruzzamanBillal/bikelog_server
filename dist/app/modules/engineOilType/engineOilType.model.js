"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.engineOilTypeModel = void 0;
const mongoose_1 = require("mongoose");
// ! no soft delete — small shared reference table, only used to pre-fill the Engine Oil form
const engineOilTypeSchema = new mongoose_1.Schema({
    name: {
        type: String,
        required: [true, "engine oil type name is required "],
        unique: true,
    },
    suggestedIntervalKm: {
        type: Number,
        required: [true, "suggested interval is required "],
    },
}, { timestamps: true });
//
exports.engineOilTypeModel = (0, mongoose_1.model)("EngineOilType", engineOilTypeSchema);
