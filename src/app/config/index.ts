import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), ".env") });

export default {
  node_env: process.env.NODE_ENV,
  port: process.env.PORT,
  database_url: process.env.DATABASE_URL,

  jwt_secret: process.env.JWT_ACCESS_SECRET,
  jwt_expires_in: process.env.JWT_EXPIRES_IN || "10d",
  openRouterApiKey: process.env.openRouterApiKey,
  cloudinary_cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  cloudinary_api_key: process.env.CLOUDINARY_API_KEY,
  cloudinary_api_secret: process.env.CLOUDINARY_API_SECRET,
  cronSecret: process.env.CRON_SECRET,
};
