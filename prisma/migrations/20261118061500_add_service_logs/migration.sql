-- Spec 67 §Data model — additive only. No existing row is read or written by this
-- migration; it only creates the three enums, the service_logs table, its two indexes and
-- the bike foreign key. Apply with `yarn db:migrate` (prisma migrate deploy). NEVER
-- `prisma migrate dev` against this Neon database — it offers to reset on drift.

-- CreateEnum
CREATE TYPE "ServiceKind" AS ENUM ('warranty', 'regular');

-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('upcoming', 'completed');

-- CreateEnum
CREATE TYPE "ServiceCenterType" AS ENUM ('official', 'local');

-- CreateTable
CREATE TABLE "service_logs" (
  "id"              TEXT NOT NULL,
  "bikeId"          TEXT NOT NULL,
  "serviceKind"     "ServiceKind" NOT NULL DEFAULT 'regular',
  "warrantyNumber"  INTEGER,
  "status"          "ServiceStatus" NOT NULL DEFAULT 'upcoming',
  "dueDate"         TIMESTAMP(3),
  "serviceDate"     TIMESTAMP(3),
  "odometerReading" DOUBLE PRECISION,
  "serviceCenter"   TEXT,
  "centerType"      "ServiceCenterType",
  "items"           JSONB,
  "recommendations" JSONB,
  "notes"           TEXT,
  "serviceImage"    JSONB,
  "isDeleted"       BOOLEAN NOT NULL DEFAULT false,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "service_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_logs_bikeId_idx" ON "service_logs"("bikeId");

-- CreateIndex
CREATE INDEX "service_logs_bikeId_dueDate_idx" ON "service_logs"("bikeId", "dueDate");

-- AddForeignKey
-- ! RESTRICT, matching engine_oil_logs: a bike with service history cannot be hard-deleted.
ALTER TABLE "service_logs" ADD CONSTRAINT "service_logs_bikeId_fkey"
  FOREIGN KEY ("bikeId") REFERENCES "bikes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
