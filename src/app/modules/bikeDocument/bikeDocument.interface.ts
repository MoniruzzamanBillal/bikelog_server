import { TCloudinaryFile } from "../../interface/image.interface";

// ! _id is now always synthesized on add (generateObjectId()), never DB-assigned —
// ! Postgres/Prisma has no concept of a queryable sub-id inside a JSON blob
export type TBikeDocumentFile = TCloudinaryFile & { _id: string };

export type TBikeDocument = {
  title: string;
  description?: string | null;
  expiryDate?: Date | null;
};
