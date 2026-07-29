"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bikeManualChunkModel = void 0;
const mongoose_1 = require("mongoose");
// ! derived data (regenerated whenever the manual is replaced/removed) — no soft delete,
// ! no pre-find hooks, same convention as mileageRecord
const bikeManualChunkSchema = new mongoose_1.Schema({
    bike: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "Bike",
        required: [true, "bike is required "],
        index: true,
    },
    chunkIndex: {
        type: Number,
        required: [true, "chunkIndex is required "],
    },
    chunkText: {
        type: String,
        required: [true, "chunkText is required "],
    },
}, { timestamps: true });
//
exports.bikeManualChunkModel = (0, mongoose_1.model)("BikeManualChunk", bikeManualChunkSchema);
