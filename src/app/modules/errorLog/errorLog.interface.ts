import { TerrorSource } from "../../interface/error";

export type TErrorLog = {
  status: number;
  message: string;
  errorName?: string;
  errorSources?: TerrorSource;
  stack?: string;
  method: string;
  path: string;
  userId?: string | null;
  userEmail?: string | null;
};
