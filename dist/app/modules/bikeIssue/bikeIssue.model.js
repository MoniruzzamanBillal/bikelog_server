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
exports.bikeIssueModel = void 0;
const mongoose_1 = require("mongoose");
const bikeIssue_constant_1 = require("./bikeIssue.constant");
const bikeIssueSchema = new mongoose_1.Schema({
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
    dateReported: {
        type: Date,
        required: [true, "dateReported is required "],
        default: Date.now,
    },
    status: {
        type: String,
        enum: Object.values(bikeIssue_constant_1.BikeIssueStatus),
        default: bikeIssue_constant_1.BikeIssueStatus.open,
    },
    statusRank: {
        type: Number,
        default: 0,
    },
    isDeleted: {
        type: Boolean,
        default: false,
    },
}, { timestamps: true });
// ! keep statusRank in sync with status so the list endpoint can sort open-before-resolved
// ! at the DB-query level (see context/specs/12-bike-issue-list-sort-order.md)
bikeIssueSchema.pre("save", function (next) {
    this.statusRank = Object.values(bikeIssue_constant_1.BikeIssueStatus).indexOf(this.status);
    next();
});
// ! filter out soft-deleted bike issues
bikeIssueSchema.pre("find", function (next) {
    return __awaiter(this, void 0, void 0, function* () {
        this.where({ isDeleted: false });
        next();
    });
});
bikeIssueSchema.pre("findOne", function (next) {
    return __awaiter(this, void 0, void 0, function* () {
        this.where({ isDeleted: false });
        next();
    });
});
//
exports.bikeIssueModel = (0, mongoose_1.model)("BikeIssue", bikeIssueSchema);
