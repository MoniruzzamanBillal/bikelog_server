import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import config from "../config";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const adapter = new PrismaNeon({
  connectionString: config.database_url as string,
});

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: config.node_env === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (config.node_env !== "production") {
  globalForPrisma.prisma = prisma;
}
