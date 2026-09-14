"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
const adapter_neon_1 = require("@prisma/adapter-neon");
const config_1 = __importDefault(require("../config"));
const globalForPrisma = globalThis;
const adapter = new adapter_neon_1.PrismaNeon({
    connectionString: config_1.default.database_url,
});
exports.prisma = (_a = globalForPrisma.prisma) !== null && _a !== void 0 ? _a : new client_1.PrismaClient({
    adapter,
    log: config_1.default.node_env === "development" ? ["query", "error", "warn"] : ["error"],
});
if (config_1.default.node_env !== "production") {
    globalForPrisma.prisma = exports.prisma;
}
