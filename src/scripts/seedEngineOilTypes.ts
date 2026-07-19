import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), ".env") });

const DATABASE_URL = process.env.DATABASE_URL!;

if (!DATABASE_URL) {
  console.error("DATABASE_URL not found in .env");
  process.exit(1);
}

const engineOilTypeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    suggestedIntervalKm: { type: Number, required: true },
  },
  { timestamps: true },
);

const EngineOilType = mongoose.model("EngineOilType", engineOilTypeSchema);

const seedData = [
  { name: "Mineral", suggestedIntervalKm: 800 },
  { name: "Semi-Synthetic", suggestedIntervalKm: 1000 },
  { name: "Synthetic", suggestedIntervalKm: 1250 },
];

async function seed() {
  try {
    await mongoose.connect(DATABASE_URL);
    console.log("Connected to DB");

    for (const type of seedData) {
      const existing = await EngineOilType.findOne({ name: type.name });
      if (existing) {
        console.log(`Skipped (already exists): ${type.name}`);
      } else {
        await EngineOilType.create(type);
        console.log(`Created: ${type.name} (${type.suggestedIntervalKm} km)`);
      }
    }

    console.log("Engine oil types seeding complete");
    process.exit(0);
  } catch (error) {
    console.error("Seeding failed:", error);
    process.exit(1);
  }
}

seed();