import { TCloudinaryImage } from "../../interface/image.interface";

// ! _id is now always synthesized on add (generateObjectId()), never DB-assigned —
// ! Postgres/Prisma has no concept of a queryable sub-id inside a JSON blob
export type TBikeIssueImage = TCloudinaryImage & { _id: string };

export type TBikeIssue = {
  title: string;
  description?: string | null;
  dateReported?: Date;
};
