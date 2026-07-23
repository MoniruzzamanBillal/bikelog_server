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
exports.bikeAccessoryModel = void 0;
const mongoose_1 = require("mongoose");
const bikeAccessory_constant_1 = require("./bikeAccessory.constant");
const bikeAccessorySchema = new mongoose_1.Schema({
    bike: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "Bike",
        required: [true, "bike is required "],
    },
    name: {
        type: String,
        required: [true, "name is required "],
    },
    urgency: {
        type: String,
        enum: Object.values(bikeAccessory_constant_1.AccessoryUrgency),
        required: [true, "urgency is required "],
    },
    status: {
        type: String,
        enum: Object.values(bikeAccessory_constant_1.AccessoryStatus),
        default: bikeAccessory_constant_1.AccessoryStatus.pending,
    },
    price: {
        type: Number,
    },
    isDeleted: {
        type: Boolean,
        default: false,
    },
}, { timestamps: true });
// ! filter out soft-deleted bike accessories
bikeAccessorySchema.pre("find", function (next) {
    return __awaiter(this, void 0, void 0, function* () {
        this.where({ isDeleted: false });
        next();
    });
});
bikeAccessorySchema.pre("findOne", function (next) {
    return __awaiter(this, void 0, void 0, function* () {
        this.where({ isDeleted: false });
        next();
    });
});
//
exports.bikeAccessoryModel = (0, mongoose_1.model)("BikeAccessory", bikeAccessorySchema);
