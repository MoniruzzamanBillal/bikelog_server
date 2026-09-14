-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'user');

-- CreateEnum
CREATE TYPE "AccessoryUrgency" AS ENUM ('immediate', 'medium', 'low');

-- CreateEnum
CREATE TYPE "AccessoryStatus" AS ENUM ('pending', 'purchased', 'cancelled');

-- CreateEnum
CREATE TYPE "BikeIssueStatus" AS ENUM ('open', 'resolved');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "userRole" "Role" NOT NULL DEFAULT 'user',
    "expoPushToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bikes" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "purchaseDate" TIMESTAMP(3) NOT NULL,
    "fuelTankCapacityLiters" DOUBLE PRECISION NOT NULL,
    "currentOdometer" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "initialOdometer" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "aiSpendingInsight" TEXT,
    "aiSpendingInsightLogCount" INTEGER,
    "aiMileageInsight" TEXT,
    "aiMileageInsightFuelLogCount" INTEGER,
    "manual" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bikes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultIntervalKm" INTEGER,
    "defaultIntervalDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_oil_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "suggestedIntervalKm" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engine_oil_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_logs" (
    "id" TEXT NOT NULL,
    "bikeId" TEXT NOT NULL,
    "odometerReading" DOUBLE PRECISION NOT NULL,
    "litersAdded" DOUBLE PRECISION NOT NULL,
    "isFullTank" BOOLEAN NOT NULL,
    "pricePerLiter" DECIMAL(12,2) NOT NULL,
    "totalCost" DECIMAL(12,2) NOT NULL,
    "fuelStation" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "receiptImage" JSONB,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fuel_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_logs" (
    "id" TEXT NOT NULL,
    "bikeId" TEXT NOT NULL,
    "maintenanceTypeId" TEXT NOT NULL,
    "oilTypeId" TEXT,
    "odometerReading" DOUBLE PRECISION NOT NULL,
    "intervalKmUsed" DOUBLE PRECISION,
    "nextDueOdometer" DOUBLE PRECISION,
    "nextDueDate" TIMESTAMP(3),
    "cost" DECIMAL(12,2) NOT NULL,
    "serviceDate" TIMESTAMP(3) NOT NULL,
    "serviceCenter" TEXT,
    "partsReplaced" TEXT[],
    "notes" TEXT,
    "serviceImage" JSONB,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mileage_records" (
    "id" TEXT NOT NULL,
    "bikeId" TEXT NOT NULL,
    "startOdometer" DOUBLE PRECISION NOT NULL,
    "endOdometer" DOUBLE PRECISION NOT NULL,
    "distanceKm" DOUBLE PRECISION NOT NULL,
    "litersConsumed" DOUBLE PRECISION NOT NULL,
    "mileageKmPerLiter" DOUBLE PRECISION NOT NULL,
    "periodStartDate" TIMESTAMP(3) NOT NULL,
    "periodEndDate" TIMESTAMP(3) NOT NULL,
    "fuelLogIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mileage_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bike_issues" (
    "id" TEXT NOT NULL,
    "bikeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dateReported" TIMESTAMP(3) NOT NULL,
    "status" "BikeIssueStatus" NOT NULL DEFAULT 'open',
    "images" JSONB,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bike_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bike_accessories" (
    "id" TEXT NOT NULL,
    "bikeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "urgency" "AccessoryUrgency" NOT NULL,
    "status" "AccessoryStatus" NOT NULL DEFAULT 'pending',
    "price" DECIMAL(12,2),
    "purchaseDate" TIMESTAMP(3),
    "productImage" JSONB,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bike_accessories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bike_documents" (
    "id" TEXT NOT NULL,
    "bikeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "expiryDate" TIMESTAMP(3),
    "files" JSONB,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bike_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bike_manual_chunks" (
    "id" TEXT NOT NULL,
    "bikeId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "chunkText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bike_manual_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_logs" (
    "id" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "errorName" TEXT,
    "errorSources" JSONB,
    "stack" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "bikes_ownerId_idx" ON "bikes"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_types_name_key" ON "maintenance_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "engine_oil_types_name_key" ON "engine_oil_types"("name");

-- CreateIndex
CREATE INDEX "fuel_logs_bikeId_idx" ON "fuel_logs"("bikeId");

-- CreateIndex
CREATE INDEX "maintenance_logs_bikeId_idx" ON "maintenance_logs"("bikeId");

-- CreateIndex
CREATE INDEX "mileage_records_bikeId_idx" ON "mileage_records"("bikeId");

-- CreateIndex
CREATE INDEX "bike_issues_bikeId_idx" ON "bike_issues"("bikeId");

-- CreateIndex
CREATE INDEX "bike_accessories_bikeId_idx" ON "bike_accessories"("bikeId");

-- CreateIndex
CREATE INDEX "bike_documents_bikeId_idx" ON "bike_documents"("bikeId");

-- CreateIndex
CREATE INDEX "bike_manual_chunks_bikeId_idx" ON "bike_manual_chunks"("bikeId");

-- CreateIndex
CREATE INDEX "error_logs_status_createdAt_idx" ON "error_logs"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "bikes" ADD CONSTRAINT "bikes_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_logs" ADD CONSTRAINT "fuel_logs_bikeId_fkey" FOREIGN KEY ("bikeId") REFERENCES "bikes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_logs" ADD CONSTRAINT "maintenance_logs_bikeId_fkey" FOREIGN KEY ("bikeId") REFERENCES "bikes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_logs" ADD CONSTRAINT "maintenance_logs_maintenanceTypeId_fkey" FOREIGN KEY ("maintenanceTypeId") REFERENCES "maintenance_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_logs" ADD CONSTRAINT "maintenance_logs_oilTypeId_fkey" FOREIGN KEY ("oilTypeId") REFERENCES "engine_oil_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mileage_records" ADD CONSTRAINT "mileage_records_bikeId_fkey" FOREIGN KEY ("bikeId") REFERENCES "bikes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bike_issues" ADD CONSTRAINT "bike_issues_bikeId_fkey" FOREIGN KEY ("bikeId") REFERENCES "bikes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bike_accessories" ADD CONSTRAINT "bike_accessories_bikeId_fkey" FOREIGN KEY ("bikeId") REFERENCES "bikes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bike_documents" ADD CONSTRAINT "bike_documents_bikeId_fkey" FOREIGN KEY ("bikeId") REFERENCES "bikes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bike_manual_chunks" ADD CONSTRAINT "bike_manual_chunks_bikeId_fkey" FOREIGN KEY ("bikeId") REFERENCES "bikes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
