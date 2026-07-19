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
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config({ path: path_1.default.join(process.cwd(), ".env") });
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    console.error("DATABASE_URL not found in .env");
    process.exit(1);
}
const maintenanceTypeSchema = new mongoose_1.default.Schema({
    name: { type: String, required: true, unique: true },
    defaultIntervalKm: { type: Number, default: null },
    defaultIntervalDays: { type: Number, default: null },
}, { timestamps: true });
const MaintenanceType = mongoose_1.default.model("MaintenanceType", maintenanceTypeSchema);
const seedData = [
    { name: "Engine Oil", defaultIntervalKm: null, defaultIntervalDays: null },
    { name: "Chain Lube", defaultIntervalKm: 500, defaultIntervalDays: null },
    { name: "Tire Change", defaultIntervalKm: null, defaultIntervalDays: null },
    { name: "Brake Pads", defaultIntervalKm: null, defaultIntervalDays: null },
    { name: "General Service", defaultIntervalKm: 3000, defaultIntervalDays: null },
    { name: "Insurance", defaultIntervalKm: null, defaultIntervalDays: 365 },
    { name: "Registration/Tax", defaultIntervalKm: null, defaultIntervalDays: 365 },
    { name: "Other", defaultIntervalKm: null, defaultIntervalDays: null },
];
function seed() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield mongoose_1.default.connect(DATABASE_URL);
            console.log("Connected to DB");
            for (const type of seedData) {
                const existing = yield MaintenanceType.findOne({ name: type.name });
                if (existing) {
                    console.log(`Skipped (already exists): ${type.name}`);
                }
                else {
                    yield MaintenanceType.create(type);
                    console.log(`Created: ${type.name}`);
                }
            }
            console.log("Maintenance types seeding complete");
            process.exit(0);
        }
        catch (error) {
            console.error("Seeding failed:", error);
            process.exit(1);
        }
    });
}
seed();
