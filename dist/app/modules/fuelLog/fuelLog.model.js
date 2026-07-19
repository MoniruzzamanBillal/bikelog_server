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
exports.fuelLogModel = void 0;
const mongoose_1 = require("mongoose");
const fuelLogSchema = new mongoose_1.Schema({
    bike: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "Bike",
        required: [true, "bike is required "],
    },
    odometerReading: {
        type: Number,
        required: [true, "odometer reading is required "],
    },
    litersAdded: {
        type: Number,
        required: [true, "liters added is required "],
    },
    isFullTank: {
        type: Boolean,
        required: [true, "isFullTank flag is required "],
    },
    pricePerLiter: {
        type: Number,
        required: [true, "price per liter is required "],
    },
    totalCost: {
        type: Number,
        required: [true, "total cost is required "],
    },
    fuelStation: {
        type: String,
    },
    date: {
        type: Date,
        required: [true, "date is required "],
        default: Date.now,
    },
    notes: {
        type: String,
    },
    isDeleted: {
        type: Boolean,
        default: false,
    },
}, { timestamps: true });
// ! filter out soft-deleted fuel logs
fuelLogSchema.pre("find", function (next) {
    return __awaiter(this, void 0, void 0, function* () {
        this.where({ isDeleted: false });
        next();
    });
});
fuelLogSchema.pre("findOne", function (next) {
    return __awaiter(this, void 0, void 0, function* () {
        this.where({ isDeleted: false });
        next();
    });
});
//
exports.fuelLogModel = (0, mongoose_1.model)("FuelLog", fuelLogSchema);
