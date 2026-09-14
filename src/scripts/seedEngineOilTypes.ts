import { prisma } from "../app/lib/prisma";
import { generateObjectId } from "../app/util/generateObjectId";

const seedData = [
  { name: "Mineral", suggestedIntervalKm: 1000 },
  { name: "Semi-Synthetic", suggestedIntervalKm: 1500 },
  { name: "Synthetic", suggestedIntervalKm: 2500 },
];

async function seed() {
  try {
    for (const type of seedData) {
      const result = await prisma.engineOilType.upsert({
        where: { name: type.name },
        update: {},
        create: {
          id: generateObjectId(),
          name: type.name,
          suggestedIntervalKm: type.suggestedIntervalKm,
        },
      });
      console.log(`Upserted: ${result.name} (${result.suggestedIntervalKm} km)`);
    }

    console.log("Engine oil types seeding complete");
    process.exit(0);
  } catch (error) {
    console.error("Seeding failed:", error);
    process.exit(1);
  }
}

seed();
