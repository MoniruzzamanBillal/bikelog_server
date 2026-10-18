-- Spec 54 §B — additive only. No existing row is read or written by this migration;
-- the historical oil changes are carried over afterwards by
-- src/scripts/importOilMaintenanceLogsToEngineOilLogs.ts (§H), never by this file.

-- CreateTable
CREATE TABLE "engine_oil_logs" (
  "id"                           TEXT NOT NULL,
  "bikeId"                       TEXT NOT NULL,
  "oilTypeId"                    TEXT,
  "odometerReading"              DOUBLE PRECISION NOT NULL,
  "intervalKmUsed"               DOUBLE PRECISION,
  "nextDueOdometer"              DOUBLE PRECISION,
  "quantityLiters"               DOUBLE PRECISION,
  "oilFilterChanged"             BOOLEAN NOT NULL DEFAULT false,
  "cost"                         DECIMAL(12,2) NOT NULL,
  "changeDate"                   TIMESTAMP(3) NOT NULL,
  "serviceCenter"                TEXT,
  "notes"                        TEXT,
  "receiptImage"                 JSONB,
  "importedFromMaintenanceLogId" TEXT,
  "isDeleted"                    BOOLEAN NOT NULL DEFAULT false,
  "createdAt"                    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "engine_oil_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "engine_oil_logs_importedFromMaintenanceLogId_key"
  ON "engine_oil_logs"("importedFromMaintenanceLogId");

-- CreateIndex
CREATE INDEX "engine_oil_logs_bikeId_idx" ON "engine_oil_logs"("bikeId");

-- CreateIndex
CREATE INDEX "engine_oil_logs_bikeId_changeDate_idx" ON "engine_oil_logs"("bikeId", "changeDate");

-- AddForeignKey
ALTER TABLE "engine_oil_logs" ADD CONSTRAINT "engine_oil_logs_bikeId_fkey"
  FOREIGN KEY ("bikeId") REFERENCES "bikes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- ! §0 H2: RESTRICT, deliberately unlike maintenance_logs_oilTypeId_fkey's SET NULL.
-- ! There, hard-deleting a still-referenced oil type silently nulls every log pointing
-- ! at it (spec 46 H1). This table does not inherit that.
ALTER TABLE "engine_oil_logs" ADD CONSTRAINT "engine_oil_logs_oilTypeId_fkey"
  FOREIGN KEY ("oilTypeId") REFERENCES "engine_oil_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
