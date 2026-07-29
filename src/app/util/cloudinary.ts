import { v2 as cloudinary } from "cloudinary";
import config from "../config";

cloudinary.config({
  cloud_name: config.cloudinary_cloud_name,
  api_key: config.cloudinary_api_key,
  api_secret: config.cloudinary_api_secret,
});

// ! best-effort cleanup — a failed delete shouldn't block the caller's own delete/replace action
export const deleteCloudinaryImage = async (
  publicId: string,
  resourceType: "image" | "raw" = "image",
): Promise<void> => {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (error) {
    console.error(`Failed to delete Cloudinary image "${publicId}":`, error);
  }
};

// ! for non-image files (e.g. PDFs) that need the raw resource type and local buffer upload,
// ! unlike upload.ts's CloudinaryStorage which streams image files directly
export const uploadRawBuffer = (
  buffer: Buffer,
  originalName: string,
): Promise<{ url: string; publicId: string }> => {
  return new Promise((resolve, reject) => {
    const publicId =
      Math.random().toString(36).substring(2) + "-" + Date.now() + "-" + originalName;

    const uploadStream = cloudinary.uploader.upload_stream(
      { resource_type: "raw", public_id: publicId },
      (error, result) => {
        if (error || !result) {
          reject(error ?? new Error("Cloudinary raw upload failed"));
          return;
        }
        resolve({ url: result.secure_url, publicId: result.public_id });
      },
    );

    uploadStream.end(buffer);
  });
};

export { cloudinary };
