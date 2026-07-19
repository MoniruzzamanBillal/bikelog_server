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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.userModel = void 0;
const argon2_1 = __importDefault(require("argon2"));
const mongoose_1 = require("mongoose");
const user_interface_1 = require("./user.interface");
const userSchema = new mongoose_1.Schema({
    name: {
        type: String,
        required: [true, "user name is required "],
    },
    email: {
        type: String,
        required: [true, "user email is required "],
        unique: true,
    },
    password: {
        type: String,
        required: [true, "user password is required "],
    },
    isDeleted: {
        type: Boolean,
        default: false,
    },
    userRole: {
        type: String,
        default: user_interface_1.UserRole.user,
    },
    expoPushToken: {
        type: String,
        default: null,
    },
}, {
    timestamps: true,
});
// ! hash password before save
userSchema.pre("save", function (next) {
    return __awaiter(this, void 0, void 0, function* () {
        const user = this;
        if (user.isModified("password")) {
            user.password = yield argon2_1.default.hash(user === null || user === void 0 ? void 0 : user.password);
        }
        next();
    });
});
//
exports.userModel = (0, mongoose_1.model)("User", userSchema);
