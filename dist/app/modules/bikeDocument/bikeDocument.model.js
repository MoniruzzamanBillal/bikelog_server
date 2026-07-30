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
exports.bikeDocumentModel = void 0;
const mongoose_1 = require("mongoose");
const bikeDocumentSchema = new mongoose_1.Schema({
    bike: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "Bike",
        required: [true, "bike is required "],
    },
    title: {
        type: String,
        required: [true, "title is required "],
    },
    description: {
        type: String,
    },
    expiryDate: {
        type: Date,
    },
    files: [
        {
            url: { type: String },
            publicId: { type: String },
            resourceType: { type: String, enum: ["image", "raw"] },
            originalName: { type: String },
            mimeType: { type: String },
        },
    ],
    isDeleted: {
        type: Boolean,
        default: false,
    },
}, { timestamps: true });
// ! filter out soft-deleted bike documents
bikeDocumentSchema.pre("find", function (next) {
    return __awaiter(this, void 0, void 0, function* () {
        this.where({ isDeleted: false });
        next();
    });
});
bikeDocumentSchema.pre("findOne", function (next) {
    return __awaiter(this, void 0, void 0, function* () {
        this.where({ isDeleted: false });
        next();
    });
});
//
exports.bikeDocumentModel = (0, mongoose_1.model)("BikeDocument", bikeDocumentSchema);
