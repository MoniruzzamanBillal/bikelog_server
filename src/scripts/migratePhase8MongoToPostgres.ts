/**
 * Phase 8 one-time cutover: copies historical documents from MongoDB into the
 * already-live Neon Postgres database. Idempotent (upsert-by-id), safe to re-run.
 * Source (Mongo) is never written to. Field mapping derived from the deleted
 * Mongoose schemas (git history) + context/specs/31-37 + live *.service.ts reads.
 *
 * Usage: npx ts-node --transpile-only src/scripts/migratePhase8MongoToPostgres.ts
 */
import mongoose from "mongoose";
import { Db, ObjectId } from "mongodb";
import config from "../app/config";
import { prisma } from "../app/lib/prisma";

const oid = (v: unknown): string => (v as ObjectId).toString();
const oidArr = (v: unknown): string[] => ((v as ObjectId[]) ?? []).map(oid);
const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

let migratedCount = 0;
let failedCount = 0;

async function upsertAll<T extends { id: string }>(
  label: string,
  rows: T[],
  fn: (data: T) => Promise<unknown>,
) {
  let ok = 0;
  for (const row of rows) {
    try {
      await fn(row);
      ok++;
    } catch (err) {
      failedCount++;
      console.error(`  [${label}] FAILED id=${row.id}:`, (err as Error).message);
    }
  }
  migratedCount += ok;
  console.log(`  [${label}] ${ok}/${rows.length} upserted`);
}

async function migrateCatalogs(db: Db) {
  // MaintenanceType/EngineOilType were bootstrap-seeded on the fresh Neon DB
  // with brand-new ids (different from Mongo's). MaintenanceLog rows reference
  // the *original* Mongo ids, and `name` is @unique, so the seeded rows must
  // be cleared before inserting the Mongo-sourced rows under their real ids.
  console.log("Resetting seed-bootstrapped MaintenanceType/EngineOilType rows...");
  await prisma.maintenanceType.deleteMany({});
  await prisma.engineOilType.deleteMany({});

  const types = await db.collection("maintenancetypes").find({}).toArray();
  await upsertAll(
    "maintenanceType",
    types.map((t) => ({
      id: oid(t._id),
      name: t.name as string,
      defaultIntervalKm: num(t.defaultIntervalKm),
      defaultIntervalDays: num(t.defaultIntervalDays),
      createdAt: new Date(t.createdAt),
      updatedAt: new Date(t.updatedAt),
    })),
    (d) =>
      prisma.maintenanceType.upsert({
        where: { id: d.id },
        create: d,
        update: d,
      }),
  );

  const oils = await db.collection("engineoiltypes").find({}).toArray();
  await upsertAll(
    "engineOilType",
    oils.map((t) => ({
      id: oid(t._id),
      name: t.name as string,
      suggestedIntervalKm: Number(t.suggestedIntervalKm),
      createdAt: new Date(t.createdAt),
      updatedAt: new Date(t.updatedAt),
    })),
    (d) =>
      prisma.engineOilType.upsert({ where: { id: d.id }, create: d, update: d }),
  );
}

async function migrateUsers(db: Db) {
  const docs = await db.collection("users").find({}).toArray();
  await upsertAll(
    "user",
    docs.map((u) => ({
      id: oid(u._id),
      name: u.name as string,
      email: u.email as string,
      password: u.password as string,
      isDeleted: Boolean(u.isDeleted),
      userRole: u.userRole as string,
      expoPushToken: (u.expoPushToken as string) ?? null,
      createdAt: new Date(u.createdAt),
      updatedAt: new Date(u.updatedAt),
    })),
    (d) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma.user.upsert({ where: { id: d.id }, create: d as any, update: d as any }),
  );
}

async function migrateBikes(db: Db) {
  const docs = await db.collection("bikes").find({}).toArray();
  await upsertAll(
    "bike",
    docs.map((b) => ({
      id: oid(b._id),
      ownerId: oid(b.owner),
      nickname: b.nickname as string,
      brand: b.brand as string,
      model: b.model as string,
      registrationNumber: b.registrationNumber as string,
      purchaseDate: new Date(b.purchaseDate),
      fuelTankCapacityLiters: Number(b.fuelTankCapacityLiters),
      currentOdometer: Number(b.currentOdometer),
      initialOdometer: Number(b.initialOdometer),
      isDeleted: Boolean(b.isDeleted),
      aiSpendingInsight: (b.aiSpendingInsight as string) ?? null,
      aiSpendingInsightLogCount: num(b.aiSpendingInsightLogCount),
      aiMileageInsight: (b.aiMileageInsight as string) ?? null,
      aiMileageInsightFuelLogCount: num(b.aiMileageInsightFuelLogCount),
      manual: b.manual ?? undefined,
      createdAt: new Date(b.createdAt),
      updatedAt: new Date(b.updatedAt),
    })),
    (d) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma.bike.upsert({ where: { id: d.id }, create: d as any, update: d as any }),
  );
}

async function migrateFuelLogs(db: Db) {
  const docs = await db.collection("fuellogs").find({}).toArray();
  await upsertAll(
    "fuelLog",
    docs.map((f) => ({
      id: oid(f._id),
      bikeId: oid(f.bike),
      odometerReading: Number(f.odometerReading),
      litersAdded: Number(f.litersAdded),
      isFullTank: Boolean(f.isFullTank),
      pricePerLiter: Number(f.pricePerLiter),
      totalCost: Number(f.totalCost),
      fuelStation: (f.fuelStation as string) ?? null,
      date: new Date(f.date),
      notes: (f.notes as string) ?? null,
      receiptImage: f.receiptImage ?? undefined,
      isDeleted: Boolean(f.isDeleted),
      createdAt: new Date(f.createdAt),
      updatedAt: new Date(f.updatedAt),
    })),
    (d) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma.fuelLog.upsert({ where: { id: d.id }, create: d as any, update: d as any }),
  );
}

async function migrateMaintenanceLogs(db: Db) {
  const docs = await db.collection("maintenancelogs").find({}).toArray();
  await upsertAll(
    "maintenanceLog",
    docs.map((m) => ({
      id: oid(m._id),
      bikeId: oid(m.bike),
      maintenanceTypeId: oid(m.maintenanceType),
      oilTypeId: m.oilType ? oid(m.oilType) : null,
      odometerReading: Number(m.odometerReading),
      intervalKmUsed: num(m.intervalKmUsed),
      nextDueOdometer: num(m.nextDueOdometer),
      nextDueDate: m.nextDueDate ? new Date(m.nextDueDate) : null,
      cost: Number(m.cost),
      serviceDate: new Date(m.serviceDate),
      serviceCenter: (m.serviceCenter as string) ?? null,
      partsReplaced: (m.partsReplaced as string[]) ?? [],
      notes: (m.notes as string) ?? null,
      serviceImage: m.serviceImage ?? undefined,
      isDeleted: Boolean(m.isDeleted),
      createdAt: new Date(m.createdAt),
      updatedAt: new Date(m.updatedAt),
    })),
    (d) =>
      prisma.maintenanceLog.upsert({
        where: { id: d.id },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: d as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        update: d as any,
      }),
  );
}

async function migrateMileageRecords(db: Db) {
  const docs = await db.collection("mileagerecords").find({}).toArray();
  await upsertAll(
    "mileageRecord",
    docs.map((m) => ({
      id: oid(m._id),
      bikeId: oid(m.bike),
      startOdometer: Number(m.startOdometer),
      endOdometer: Number(m.endOdometer),
      distanceKm: Number(m.distanceKm),
      litersConsumed: Number(m.litersConsumed),
      mileageKmPerLiter: Number(m.mileageKmPerLiter),
      periodStartDate: new Date(m.periodStartDate),
      periodEndDate: new Date(m.periodEndDate),
      fuelLogIds: oidArr(m.fuelLogIds),
      createdAt: new Date(m.createdAt),
      updatedAt: new Date(m.updatedAt),
    })),
    (d) =>
      prisma.mileageRecord.upsert({
        where: { id: d.id },
        create: d,
        update: d,
      }),
  );
}

async function migrateBikeIssues(db: Db) {
  const docs = await db.collection("bikeissues").find({}).toArray();
  await upsertAll(
    "bikeIssue",
    docs.map((i) => ({
      id: oid(i._id),
      bikeId: oid(i.bike),
      title: i.title as string,
      description: (i.description as string) ?? null,
      dateReported: new Date(i.dateReported),
      status: i.status as string,
      images: (i.images ?? []).map((img: Record<string, unknown>) => ({
        ...img,
        _id: oid(img._id),
      })),
      isDeleted: Boolean(i.isDeleted),
      createdAt: new Date(i.createdAt),
      updatedAt: new Date(i.updatedAt),
    })),
    (d) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma.bikeIssue.upsert({ where: { id: d.id }, create: d as any, update: d as any }),
  );
}

async function migrateBikeAccessories(db: Db) {
  const docs = await db.collection("bikeaccessories").find({}).toArray();
  await upsertAll(
    "bikeAccessory",
    docs.map((a) => ({
      id: oid(a._id),
      bikeId: oid(a.bike),
      name: a.name as string,
      urgency: a.urgency as string,
      status: a.status as string,
      price: num(a.price),
      purchaseDate: a.purchaseDate ? new Date(a.purchaseDate) : null,
      productImage: a.productImage ?? undefined,
      isDeleted: Boolean(a.isDeleted),
      createdAt: new Date(a.createdAt),
      updatedAt: new Date(a.updatedAt),
    })),
    (d) =>
      prisma.bikeAccessory.upsert({
        where: { id: d.id },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: d as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        update: d as any,
      }),
  );
}

async function migrateBikeDocuments(db: Db) {
  const docs = await db.collection("bikedocuments").find({}).toArray();
  await upsertAll(
    "bikeDocument",
    docs.map((doc) => ({
      id: oid(doc._id),
      bikeId: oid(doc.bike),
      title: doc.title as string,
      description: (doc.description as string) ?? null,
      expiryDate: doc.expiryDate ? new Date(doc.expiryDate) : null,
      files: (doc.files ?? []).map((f: Record<string, unknown>) => ({
        ...f,
        _id: oid(f._id),
      })),
      isDeleted: Boolean(doc.isDeleted),
      createdAt: new Date(doc.createdAt),
      updatedAt: new Date(doc.updatedAt),
    })),
    (d) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma.bikeDocument.upsert({ where: { id: d.id }, create: d as any, update: d as any }),
  );
}

async function migrateBikeManualChunks(db: Db) {
  const docs = await db.collection("bikemanualchunks").find({}).toArray();
  await upsertAll(
    "bikeManualChunk",
    docs.map((c) => ({
      id: oid(c._id),
      bikeId: oid(c.bike),
      chunkIndex: Number(c.chunkIndex),
      chunkText: c.chunkText as string,
      createdAt: new Date(c.createdAt),
      updatedAt: new Date(c.updatedAt),
    })),
    (d) =>
      prisma.bikeManualChunk.upsert({
        where: { id: d.id },
        create: d,
        update: d,
      }),
  );
}

async function main() {
  console.log("Connecting to MongoDB (source)...");
  await mongoose.connect(config.mongo_database_url as string);
  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo connection has no db handle");

  console.log("Connected. Migrating in FK-safe order...");

  await migrateUsers(db);
  await migrateCatalogs(db);
  await migrateBikes(db);
  await migrateFuelLogs(db);
  await migrateMaintenanceLogs(db);
  await migrateMileageRecords(db);
  await migrateBikeIssues(db);
  await migrateBikeAccessories(db);
  await migrateBikeDocuments(db);
  await migrateBikeManualChunks(db);

  // ErrorLog historical rows are intentionally skipped (spec 36a's own default:
  // operational debris on a 30-day TTL, not user data). Re-enable here if desired.

  console.log(`\nDone. Migrated ${migratedCount} rows, ${failedCount} failures.`);
}

main()
  .catch((e) => {
    console.error("Migration crashed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
    await prisma.$disconnect();
  });
