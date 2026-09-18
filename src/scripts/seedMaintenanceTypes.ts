import { prisma } from "../app/lib/prisma";
import { generateObjectId } from "../app/util/generateObjectId";

const seedData = [
  { name: "Engine Oil", defaultIntervalKm: null, defaultIntervalDays: null },
  { name: "Chain Lube", defaultIntervalKm: 150, defaultIntervalDays: null },
  { name: "Tire Change", defaultIntervalKm: null, defaultIntervalDays: null },
  { name: "Brake Pads", defaultIntervalKm: null, defaultIntervalDays: null },
  {
    name: "General Service",
    defaultIntervalKm: 4000,
    defaultIntervalDays: null,
  },
  { name: "Insurance", defaultIntervalKm: null, defaultIntervalDays: 365 },
  {
    name: "Registration/Tax",
    defaultIntervalKm: null,
    defaultIntervalDays: 730,
  },
  { name: "Other", defaultIntervalKm: null, defaultIntervalDays: null },
];

async function seed() {
  try {
    for (const type of seedData) {
      const result = await prisma.maintenanceType.upsert({
        where: { name: type.name },
        update: {},
        create: {
          id: generateObjectId(),
          name: type.name,
          defaultIntervalKm: type.defaultIntervalKm,
          defaultIntervalDays: type.defaultIntervalDays,
        },
      });
      console.log(`Upserted: ${result.name}`);
    }

    console.log("Maintenance types seeding complete");
    process.exit(0);
  } catch (error) {
    console.error("Seeding failed:", error);
    process.exit(1);
  }
}

seed();
