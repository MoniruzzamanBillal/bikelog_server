import argon2 from "argon2";
import { model, Schema } from "mongoose";
import { TUserRole, UserRole } from "./user.interface";

// Full Mongoose-document shape, kept separate from the Prisma-era `TUser`
// (create-payload only, see user.interface.ts) since this model must keep
// compiling until Phase 7 rewrites notification.service.ts's direct import.
export type TUserDocument = {
  name: string;
  email: string;
  password: string;
  isDeleted: boolean;
  userRole: TUserRole;
  expoPushToken?: string | null;
};

const userSchema = new Schema<TUserDocument>(
  {
    name: {
      type: String,
      required: [true, "user name is required "],
    },
    email: {
      type: String,
      required: [true, "user email is required "],
      unique: true,
    },
    password: {
      type: String,
      required: [true, "user password is required "],
    },
 
    isDeleted: {
      type: Boolean,
      default: false,
    },
    userRole: {
      type: String,
      default: UserRole.user,
    },
    expoPushToken: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// ! hash password before save
userSchema.pre("save", async function (next) {
  if (this.isModified("password")) {
    this.password = await argon2.hash(this.password);
  }

  next();
});

//
export const userModel = model<TUserDocument>("User", userSchema);
