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
const prisma_1 = require("../app/lib/prisma");
const generateObjectId_1 = require("../app/util/generateObjectId");
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
function seed() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            for (const type of seedData) {
                const result = yield prisma_1.prisma.maintenanceType.upsert({
                    where: { name: type.name },
                    update: {},
                    create: {
                        id: (0, generateObjectId_1.generateObjectId)(),
                        name: type.name,
                        defaultIntervalKm: type.defaultIntervalKm,
                        defaultIntervalDays: type.defaultIntervalDays,
                    },
                });
                console.log(`Upserted: ${result.name}`);
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
