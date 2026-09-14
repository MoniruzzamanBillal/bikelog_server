"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config({ path: path_1.default.join(process.cwd(), ".env") });
exports.default = {
    node_env: process.env.NODE_ENV,
    port: process.env.PORT,
    // Postgres (Prisma) — the app's live DB connection, per the mongodb-to-postgres-migration-plan.md Phase 0 setup.
    database_url: process.env.DATABASE_URL,
    // MongoDB (Mongoose) — still the actual source of truth until the migration's Phase 8 cutover; kept under its
    // own var name (renamed from the old DATABASE_URL) so both DBs can be configured side by side during the migration.
    mongo_database_url: process.env.MONGO_DATABASE_URL,
    jwt_secret: process.env.JWT_ACCESS_SECRET,
    jwt_expires_in: process.env.JWT_EXPIRES_IN || "10d",
    openRouterApiKey: process.env.openRouterApiKey,
    cloudinary_cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    cloudinary_api_key: process.env.CLOUDINARY_API_KEY,
    cloudinary_api_secret: process.env.CLOUDINARY_API_SECRET,
    cronSecret: process.env.CRON_SECRET,
    expenseTrackerBaseUrl: process.env.EXPENSE_TRACKER_BASE_URL,
    expenseTrackerIntegrationKey: process.env.EXPENSE_TRACKER_INTEGRATION_KEY,
};
