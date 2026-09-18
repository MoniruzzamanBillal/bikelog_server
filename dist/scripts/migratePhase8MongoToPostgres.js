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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Phase 8 one-time cutover: copies historical documents from MongoDB into the
 * already-live Neon Postgres database. Idempotent (upsert-by-id), safe to re-run.
 * Source (Mongo) is never written to. Field mapping derived from the deleted
 * Mongoose schemas (git history) + context/specs/31-37 + live *.service.ts reads.
 *
 * Usage: npx ts-node --transpile-only src/scripts/migratePhase8MongoToPostgres.ts
 */
const mongoose_1 = __importDefault(require("mongoose"));
const config_1 = __importDefault(require("../app/config"));
const prisma_1 = require("../app/lib/prisma");
const oid = (v) => v.toString();
const oidArr = (v) => { var _a; return ((_a = v) !== null && _a !== void 0 ? _a : []).map(oid); };
const num = (v) => v === null || v === undefined ? null : Number(v);
let migratedCount = 0;
let failedCount = 0;
function upsertAll(label, rows, fn) {
    return __awaiter(this, void 0, void 0, function* () {
        let ok = 0;
        for (const row of rows) {
            try {
                yield fn(row);
                ok++;
            }
            catch (err) {
                failedCount++;
                console.error(`  [${label}] FAILED id=${row.id}:`, err.message);
            }
        }
        migratedCount += ok;
        console.log(`  [${label}] ${ok}/${rows.length} upserted`);
    });
}
function migrateCatalogs(db) {
    return __awaiter(this, void 0, void 0, function* () {
        // MaintenanceType/EngineOilType were bootstrap-seeded on the fresh Neon DB
        // with brand-new ids (different from Mongo's). MaintenanceLog rows reference
        // the *original* Mongo ids, and `name` is @unique, so the seeded rows must
        // be cleared before inserting the Mongo-sourced rows under their real ids.
        console.log("Resetting seed-bootstrapped MaintenanceType/EngineOilType rows...");
        yield prisma_1.prisma.maintenanceType.deleteMany({});
        yield prisma_1.prisma.engineOilType.deleteMany({});
        const types = yield db.collection("maintenancetypes").find({}).toArray();
        yield upsertAll("maintenanceType", types.map((t) => ({
            id: oid(t._id),
            name: t.name,
            defaultIntervalKm: num(t.defaultIntervalKm),
            defaultIntervalDays: num(t.defaultIntervalDays),
            createdAt: new Date(t.createdAt),
            updatedAt: new Date(t.updatedAt),
        })), (d) => prisma_1.prisma.maintenanceType.upsert({
            where: { id: d.id },
            create: d,
            update: d,
        }));
        const oils = yield db.collection("engineoiltypes").find({}).toArray();
        yield upsertAll("engineOilType", oils.map((t) => ({
            id: oid(t._id),
            name: t.name,
            suggestedIntervalKm: Number(t.suggestedIntervalKm),
            createdAt: new Date(t.createdAt),
            updatedAt: new Date(t.updatedAt),
        })), (d) => prisma_1.prisma.engineOilType.upsert({ where: { id: d.id }, create: d, update: d }));
    });
}
function migrateUsers(db) {
    return __awaiter(this, void 0, void 0, function* () {
        const docs = yield db.collection("users").find({}).toArray();
        yield upsertAll("user", docs.map((u) => {
            var _a;
            return ({
                id: oid(u._id),
                name: u.name,
                email: u.email,
                password: u.password,
                isDeleted: Boolean(u.isDeleted),
                userRole: u.userRole,
                expoPushToken: (_a = u.expoPushToken) !== null && _a !== void 0 ? _a : null,
                createdAt: new Date(u.createdAt),
                updatedAt: new Date(u.updatedAt),
            });
        }), (d) => 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prisma_1.prisma.user.upsert({ where: { id: d.id }, create: d, update: d }));
    });
}
function migrateBikes(db) {
    return __awaiter(this, void 0, void 0, function* () {
        const docs = yield db.collection("bikes").find({}).toArray();
        yield upsertAll("bike", docs.map((b) => {
            var _a, _b, _c;
            return ({
                id: oid(b._id),
                ownerId: oid(b.owner),
                nickname: b.nickname,
                brand: b.brand,
                model: b.model,
                registrationNumber: b.registrationNumber,
                purchaseDate: new Date(b.purchaseDate),
                fuelTankCapacityLiters: Number(b.fuelTankCapacityLiters),
                currentOdometer: Number(b.currentOdometer),
                initialOdometer: Number(b.initialOdometer),
                isDeleted: Boolean(b.isDeleted),
                aiSpendingInsight: (_a = b.aiSpendingInsight) !== null && _a !== void 0 ? _a : null,
                aiSpendingInsightLogCount: num(b.aiSpendingInsightLogCount),
                aiMileageInsight: (_b = b.aiMileageInsight) !== null && _b !== void 0 ? _b : null,
                aiMileageInsightFuelLogCount: num(b.aiMileageInsightFuelLogCount),
                manual: (_c = b.manual) !== null && _c !== void 0 ? _c : undefined,
                createdAt: new Date(b.createdAt),
                updatedAt: new Date(b.updatedAt),
            });
        }), (d) => 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prisma_1.prisma.bike.upsert({ where: { id: d.id }, create: d, update: d }));
    });
}
function migrateFuelLogs(db) {
    return __awaiter(this, void 0, void 0, function* () {
        const docs = yield db.collection("fuellogs").find({}).toArray();
        yield upsertAll("fuelLog", docs.map((f) => {
            var _a, _b, _c;
            return ({
                id: oid(f._id),
                bikeId: oid(f.bike),
                odometerReading: Number(f.odometerReading),
                litersAdded: Number(f.litersAdded),
                isFullTank: Boolean(f.isFullTank),
                pricePerLiter: Number(f.pricePerLiter),
                totalCost: Number(f.totalCost),
                fuelStation: (_a = f.fuelStation) !== null && _a !== void 0 ? _a : null,
                date: new Date(f.date),
                notes: (_b = f.notes) !== null && _b !== void 0 ? _b : null,
                receiptImage: (_c = f.receiptImage) !== null && _c !== void 0 ? _c : undefined,
                isDeleted: Boolean(f.isDeleted),
                createdAt: new Date(f.createdAt),
                updatedAt: new Date(f.updatedAt),
            });
        }), (d) => 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prisma_1.prisma.fuelLog.upsert({ where: { id: d.id }, create: d, update: d }));
    });
}
function migrateMaintenanceLogs(db) {
    return __awaiter(this, void 0, void 0, function* () {
        const docs = yield db.collection("maintenancelogs").find({}).toArray();
        yield upsertAll("maintenanceLog", docs.map((m) => {
            var _a, _b, _c, _d;
            return ({
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
                serviceCenter: (_a = m.serviceCenter) !== null && _a !== void 0 ? _a : null,
                partsReplaced: (_b = m.partsReplaced) !== null && _b !== void 0 ? _b : [],
                notes: (_c = m.notes) !== null && _c !== void 0 ? _c : null,
                serviceImage: (_d = m.serviceImage) !== null && _d !== void 0 ? _d : undefined,
                isDeleted: Boolean(m.isDeleted),
                createdAt: new Date(m.createdAt),
                updatedAt: new Date(m.updatedAt),
            });
        }), (d) => prisma_1.prisma.maintenanceLog.upsert({
            where: { id: d.id },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            create: d,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            update: d,
        }));
    });
}
function migrateMileageRecords(db) {
    return __awaiter(this, void 0, void 0, function* () {
        const docs = yield db.collection("mileagerecords").find({}).toArray();
        yield upsertAll("mileageRecord", docs.map((m) => ({
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
        })), (d) => prisma_1.prisma.mileageRecord.upsert({
            where: { id: d.id },
            create: d,
            update: d,
        }));
    });
}
function migrateBikeIssues(db) {
    return __awaiter(this, void 0, void 0, function* () {
        const docs = yield db.collection("bikeissues").find({}).toArray();
        yield upsertAll("bikeIssue", docs.map((i) => {
            var _a, _b;
            return ({
                id: oid(i._id),
                bikeId: oid(i.bike),
                title: i.title,
                description: (_a = i.description) !== null && _a !== void 0 ? _a : null,
                dateReported: new Date(i.dateReported),
                status: i.status,
                images: ((_b = i.images) !== null && _b !== void 0 ? _b : []).map((img) => (Object.assign(Object.assign({}, img), { _id: oid(img._id) }))),
                isDeleted: Boolean(i.isDeleted),
                createdAt: new Date(i.createdAt),
                updatedAt: new Date(i.updatedAt),
            });
        }), (d) => 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prisma_1.prisma.bikeIssue.upsert({ where: { id: d.id }, create: d, update: d }));
    });
}
function migrateBikeAccessories(db) {
    return __awaiter(this, void 0, void 0, function* () {
        const docs = yield db.collection("bikeaccessories").find({}).toArray();
        yield upsertAll("bikeAccessory", docs.map((a) => {
            var _a;
            return ({
                id: oid(a._id),
                bikeId: oid(a.bike),
                name: a.name,
                urgency: a.urgency,
                status: a.status,
                price: num(a.price),
                purchaseDate: a.purchaseDate ? new Date(a.purchaseDate) : null,
                productImage: (_a = a.productImage) !== null && _a !== void 0 ? _a : undefined,
                isDeleted: Boolean(a.isDeleted),
                createdAt: new Date(a.createdAt),
                updatedAt: new Date(a.updatedAt),
            });
        }), (d) => prisma_1.prisma.bikeAccessory.upsert({
            where: { id: d.id },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            create: d,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            update: d,
        }));
    });
}
function migrateBikeDocuments(db) {
    return __awaiter(this, void 0, void 0, function* () {
        const docs = yield db.collection("bikedocuments").find({}).toArray();
        yield upsertAll("bikeDocument", docs.map((doc) => {
            var _a, _b;
            return ({
                id: oid(doc._id),
                bikeId: oid(doc.bike),
                title: doc.title,
                description: (_a = doc.description) !== null && _a !== void 0 ? _a : null,
                expiryDate: doc.expiryDate ? new Date(doc.expiryDate) : null,
                files: ((_b = doc.files) !== null && _b !== void 0 ? _b : []).map((f) => (Object.assign(Object.assign({}, f), { _id: oid(f._id) }))),
                isDeleted: Boolean(doc.isDeleted),
                createdAt: new Date(doc.createdAt),
                updatedAt: new Date(doc.updatedAt),
            });
        }), (d) => 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prisma_1.prisma.bikeDocument.upsert({ where: { id: d.id }, create: d, update: d }));
    });
}
function migrateBikeManualChunks(db) {
    return __awaiter(this, void 0, void 0, function* () {
        const docs = yield db.collection("bikemanualchunks").find({}).toArray();
        yield upsertAll("bikeManualChunk", docs.map((c) => ({
            id: oid(c._id),
            bikeId: oid(c.bike),
            chunkIndex: Number(c.chunkIndex),
            chunkText: c.chunkText,
            createdAt: new Date(c.createdAt),
            updatedAt: new Date(c.updatedAt),
        })), (d) => prisma_1.prisma.bikeManualChunk.upsert({
            where: { id: d.id },
            create: d,
            update: d,
        }));
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("Connecting to MongoDB (source)...");
        yield mongoose_1.default.connect(config_1.default.mongo_database_url);
        const db = mongoose_1.default.connection.db;
        if (!db)
            throw new Error("Mongo connection has no db handle");
        console.log("Connected. Migrating in FK-safe order...");
        yield migrateUsers(db);
        yield migrateCatalogs(db);
        yield migrateBikes(db);
        yield migrateFuelLogs(db);
        yield migrateMaintenanceLogs(db);
        yield migrateMileageRecords(db);
        yield migrateBikeIssues(db);
        yield migrateBikeAccessories(db);
        yield migrateBikeDocuments(db);
        yield migrateBikeManualChunks(db);
        // ErrorLog historical rows are intentionally skipped (spec 36a's own default:
        // operational debris on a 30-day TTL, not user data). Re-enable here if desired.
        console.log(`\nDone. Migrated ${migratedCount} rows, ${failedCount} failures.`);
    });
}
main()
    .catch((e) => {
    console.error("Migration crashed:", e);
    process.exitCode = 1;
})
    .finally(() => __awaiter(void 0, void 0, void 0, function* () {
    yield mongoose_1.default.disconnect();
    yield prisma_1.prisma.$disconnect();
}));
