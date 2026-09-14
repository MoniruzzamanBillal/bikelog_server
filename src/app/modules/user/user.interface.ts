export type TUserRole = "admin" | "user";

export type TJwtPayload = {
  userId: string;
  userEmail: string;
  userRole: TUserRole;
};

export type TUser = {
  name: string;
  email: string;
  password: string;
};

export const UserRole = {
  admin: "admin",

  user: "user",
} as const;
