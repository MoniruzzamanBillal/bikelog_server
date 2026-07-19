import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), ".env") });

const DATABASE_URL = process.env.DATABASE_URL!;

if (!DATABASE_URL) {
  console.error("DATABASE_URL not found in .env");
  process.exit(1);
}

const maintenanceTypeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    defaultIntervalKm: { type: Number, default: null },
    defaultIntervalDays: { type: Number, default: null },
  },
  { timestamps: true },
);

const MaintenanceType = mongoose.model("MaintenanceType", maintenanceTypeSchema);

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

async function seed() {
  try {
    await mongoose.connect(DATABASE_URL);
    console.log("Connected to DB");

    for (const type of seedData) {
      const existing = await MaintenanceType.findOne({ name: type.name });
      if (existing) {
        console.log(`Skipped (already exists): ${type.name}`);
      } else {
        await MaintenanceType.create(type);
        console.log(`Created: ${type.name}`);
      }
    }

    console.log("Maintenance types seeding complete");
    process.exit(0);
  } catch (error) {
    console.error("Seeding failed:", error);
    process.exit(1);
  }
}

seed();