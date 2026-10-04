-- DropIndex
DROP INDEX "maintenance_types_name_key";

-- DropIndex
DROP INDEX "engine_oil_types_name_key";

-- AlterTable
ALTER TABLE "maintenance_types" ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "requiresOilType" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "engine_oil_types" ADD COLUMN     "ownerId" TEXT;

-- CreateIndex
CREATE INDEX "maintenance_types_ownerId_idx" ON "maintenance_types"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_types_ownerId_name_key" ON "maintenance_types"("ownerId", "name");

-- CreateIndex
CREATE INDEX "engine_oil_types_ownerId_idx" ON "engine_oil_types"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "engine_oil_types_ownerId_name_key" ON "engine_oil_types"("ownerId", "name");

-- AddForeignKey
ALTER TABLE "maintenance_types" ADD CONSTRAINT "maintenance_types_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_oil_types" ADD CONSTRAINT "engine_oil_types_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

