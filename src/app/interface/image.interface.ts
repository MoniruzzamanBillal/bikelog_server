export type TCloudinaryImage = {
  url: string;
  publicId: string;
};

// ! superset of TCloudinaryImage for mixed image/PDF uploads — resourceType is needed so
// ! deleteCloudinaryImage(publicId, resourceType) can destroy a "raw" (PDF) asset correctly
export type TCloudinaryFile = TCloudinaryImage & {
  resourceType: "image" | "raw";
  originalName: string;
  mimeType: string;
};
