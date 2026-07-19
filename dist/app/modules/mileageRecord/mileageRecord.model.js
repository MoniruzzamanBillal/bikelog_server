"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mileageRecordModel = void 0;
const mongoose_1 = require("mongoose");
// ! no soft delete here — MileageRecord is derived/auto-generated from FuelLog closures, not directly user-managed
const mileageRecordSchema = new mongoose_1.Schema({
    bike: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "Bike",
        required: [true, "bike is required "],
    },
    startOdometer: {
        type: Number,
        required: [true, "start odometer is required "],
    },
    endOdometer: {
        type: Number,
        required: [true, "end odometer is required "],
    },
    distanceKm: {
        type: Number,
        required: [true, "distance is required "],
    },
    litersConsumed: {
        type: Number,
        required: [true, "liters consumed is required "],
    },
    mileageKmPerLiter: {
        type: Number,
        required: [true, "mileage is required "],
    },
    periodStartDate: {
        type: Date,
        required: [true, "period start date is required "],
    },
    periodEndDate: {
        type: Date,
        required: [true, "period end date is required "],
    },
    fuelLogIds: [
        {
            type: mongoose_1.Schema.Types.ObjectId,
            ref: "FuelLog",
        },
    ],
}, { timestamps: true });
//
exports.mileageRecordModel = (0, mongoose_1.model)("MileageRecord", mileageRecordSchema);
