"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.maintenanceLogModel = void 0;
const mongoose_1 = require("mongoose");
const maintenanceLogSchema = new mongoose_1.Schema({
    bike: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "Bike",
        required: [true, "bike is required "],
    },
    maintenanceType: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "MaintenanceType",
        required: [true, "maintenance type is required "],
    },
    odometerReading: {
        type: Number,
        required: [true, "odometer reading is required "],
    },
    oilType: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "EngineOilType",
    },
    intervalKmUsed: {
        type: Number,
        required: [true, "interval km used is required "],
    },
    nextDueOdometer: {
        type: Number,
        required: [true, "next due odometer is required "],
    },
    nextDueDate: {
        type: Date,
    },
    cost: {
        type: Number,
        required: [true, "cost is required "],
    },
    serviceDate: {
        type: Date,
        required: [true, "service date is required "],
        default: Date.now,
    },
    serviceCenter: {
        type: String,
    },
    partsReplaced: [
        {
            type: String,
        },
    ],
    notes: {
        type: String,
    },
    isDeleted: {
        type: Boolean,
        default: false,
    },
}, { timestamps: true });
// ! filter out soft-deleted maintenance logs
maintenanceLogSchema.pre("find", function (next) {
    return __awaiter(this, void 0, void 0, function* () {
        this.where({ isDeleted: false });
        next();
    });
});
maintenanceLogSchema.pre("findOne", function (next) {
    return __awaiter(this, void 0, void 0, function* () {
        this.where({ isDeleted: false });
        next();
    });
});
//
exports.maintenanceLogModel = (0, mongoose_1.model)("MaintenanceLog", maintenanceLogSchema);
