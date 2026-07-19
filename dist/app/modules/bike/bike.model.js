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
exports.bikeModel = void 0;
const mongoose_1 = require("mongoose");
const bikeSchema = new mongoose_1.Schema({
    owner: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
        required: [true, "owner is required "],
    },
    nickname: {
        type: String,
        required: [true, "bike nickname is required "],
    },
    brand: {
        type: String,
        required: [true, "bike brand is required "],
    },
    model: {
        type: String,
        required: [true, "bike model is required "],
    },
    registrationNumber: {
        type: String,
        required: [true, "registration number is required "],
    },
    purchaseDate: {
        type: Date,
        required: [true, "purchase date is required "],
    },
    fuelTankCapacityLiters: {
        type: Number,
        required: [true, "fuel tank capacity is required "],
    },
    currentOdometer: {
        type: Number,
        required: [true, "current odometer reading is required "],
        default: 0,
    },
    // ! immutable snapshot of currentOdometer at creation time — currentOdometer gets bumped by
    // ! every later fuel/maintenance log, so this is the only stable anchor for "since the start" math
    initialOdometer: {
        type: Number,
        required: [true, "initial odometer reading is required "],
        default: 0,
    },
    isDeleted: {
        type: Boolean,
        default: false,
    },
}, { timestamps: true });
// ! filter out soft-deleted bikes
bikeSchema.pre("find", function (next) {
    return __awaiter(this, void 0, void 0, function* () {
        this.where({ isDeleted: false });
        next();
    });
});
bikeSchema.pre("findOne", function (next) {
    return __awaiter(this, void 0, void 0, function* () {
        this.where({ isDeleted: false });
        next();
    });
});
//
exports.bikeModel = (0, mongoose_1.model)("Bike", bikeSchema);
