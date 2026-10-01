-- AlterTable
ALTER TABLE "engine_oil_types" ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "maintenance_types" ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;
