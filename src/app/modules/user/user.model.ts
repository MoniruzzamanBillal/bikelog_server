import argon2 from "argon2";
import { model, Schema } from "mongoose";
import { TUser, UserRole } from "./user.interface";

const userSchema = new Schema<TUser>(
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
  const user = this;

  if (user.isModified("password")) {
    user.password = await argon2.hash(user?.password);
  }

  next();
});

//
export const userModel = model<TUser>("User", userSchema);
