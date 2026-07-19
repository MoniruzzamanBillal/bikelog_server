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
const engineOilTypeSchema = new mongoose_1.default.Schema({
    name: { type: String, required: true, unique: true },
    suggestedIntervalKm: { type: Number, required: true },
}, { timestamps: true });
const EngineOilType = mongoose_1.default.model("EngineOilType", engineOilTypeSchema);
const seedData = [
    { name: "Mineral", suggestedIntervalKm: 800 },
    { name: "Semi-Synthetic", suggestedIntervalKm: 1000 },
    { name: "Synthetic", suggestedIntervalKm: 1250 },
];
function seed() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield mongoose_1.default.connect(DATABASE_URL);
            console.log("Connected to DB");
            for (const type of seedData) {
                const existing = yield EngineOilType.findOne({ name: type.name });
                if (existing) {
                    console.log(`Skipped (already exists): ${type.name}`);
                }
                else {
                    yield EngineOilType.create(type);
                    console.log(`Created: ${type.name} (${type.suggestedIntervalKm} km)`);
                }
            }
            console.log("Engine oil types seeding complete");
            process.exit(0);
        }
        catch (error) {
            console.error("Seeding failed:", error);
            process.exit(1);
        }
    });
}
seed();
