"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.testRouter = void 0;
const express_1 = __importDefault(require("express"));
const test_controller_1 = require("./test.controller");
const router = express_1.default.Router();
router.get("/orders", test_controller_1.orderController.getAllOrder);
router.post("/orders", test_controller_1.orderController.createOrder);
exports.testRouter = router;
