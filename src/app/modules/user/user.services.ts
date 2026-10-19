import argon2 from "argon2";
import { Prisma } from "@prisma/client";
import httpStatus from "http-status";
import Jwt from "jsonwebtoken";
import AppError from "../../Error/AppError";
import config from "../../config";
import { prisma } from "../../lib/prisma";
import { deleteCloudinaryImage } from "../../util/cloudinary";
import { generateObjectId } from "../../util/generateObjectId";
import {
  TUser,
  TJwtPayload,
  TRefreshPayload,
  TUserProfilePicture,
} from "./user.interface";

// every field except `password`, so a newly-added sensitive field never leaks by accident
const safeUserSelect = {
  id: true,
  name: true,
  email: true,
  // ! Spec 53 D8: this one line is what puts the profile picture on `/auth/me`,
  // ! `POST /auth/register` and `POST /auth/push-token` at once — purely additive, nothing
  // ! renamed or retyped, so no client is forced to change.
  profilePicture: true,
  isDeleted: true,
  userRole: true,
  expoPushToken: true,
  createdAt: true,
  updatedAt: true,
} as const;

// ! Spec 51 — the two token minters. Kept as the ONLY places either token is signed, so the
// ! sign-time and verify-time shapes cannot drift apart silently (the same reasoning spec 02
// ! used when it typed the login payload).
const signAccessToken = (user: {
  id: string;
  email: string;
  userRole: string;
}) => {
  const jwtPayload: TJwtPayload = {
    userId: user?.id,
    userEmail: user?.email,
    userRole: user?.userRole as TJwtPayload["userRole"],
    type: "access",
  };

  return Jwt.sign(jwtPayload, config.jwt_secret as string, {
    expiresIn: config.jwt_access_expires_in as Jwt.SignOptions["expiresIn"],
  });
};

// ! Signed with a DIFFERENT secret from the access token, which is not optional: under one
// ! shared secret an access token would verify here and could be replayed for a fresh access
// ! token forever (spec 51 §0 H4). The `type` claim is the second half of that defence.
const signRefreshToken = (user: { id: string }) => {
  const jwtPayload: TRefreshPayload = {
    userId: user?.id,
    type: "refresh",
  };

  return Jwt.sign(jwtPayload, config.jwt_refresh_secret as string, {
    expiresIn: config.jwt_refresh_expires_in as Jwt.SignOptions["expiresIn"],
  });
};

// ! for creating a user
const createUser = async (payload: TUser) => {
  try {
    const hashedPassword = await argon2.hash(payload.password);

    const result = await prisma.user.create({
      data: {
        id: generateObjectId(),
        name: payload.name,
        email: payload.email,
        password: hashedPassword,
      },
      select: safeUserSelect,
    });

    return { ...result, _id: result.id };
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new AppError(
        httpStatus.CONFLICT,
        "A user with this email already exists",
      );
    }
    throw error;
  }
};

// ! for login a user
type Tlogin = {
  email: string;
  password: string;
};
const loginFromDb = async (payload: Tlogin) => {
  const userData = await prisma.user.findUnique({
    where: { email: payload?.email },
  });

  // ! Spec 51 §0 H6: a soft-deleted user could log in — this query never looked at
  // ! `isDeleted`, so the flag did nothing for auth (the SQA report's DEF-07). Collapsed into
  // ! the same 404 as a missing user on purpose, so the response can't tell "deleted" from
  // ! "never existed". Checked in JS rather than in the `where` because `findUnique` only
  // ! accepts unique fields.
  if (!userData || userData?.isDeleted) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "User dont exist with this email !!!",
    );
  }

  const isPasswordMatch = await argon2.verify(
    userData?.password,
    payload?.password,
  );

  if (!isPasswordMatch) {
    throw new AppError(httpStatus.FORBIDDEN, "Password don't match !!");
  }

  // ! Spec 51: two tokens now. `token` on the wire stays the ACCESS token (see the controller)
  // ! so pre-spec-51 clients, which read `result.token` and know nothing about refreshing,
  // ! keep working untouched.
  return {
    accessToken: signAccessToken(userData),
    refreshToken: signRefreshToken(userData),
  };
};

// ! Spec 51 — exchanges a valid refresh token for a new access token. The refresh token is
// ! neither rotated nor echoed back: it stays the same until it expires, so there is nothing
// ! for the client to re-store. No token is stored server-side anywhere, by design — which is
// ! also why nothing here can revoke one (spec 51 §0 H3).
const refreshAccessToken = async (refreshToken: string) => {
  // ! One shared message for every failure cause — malformed, bad signature, expired, wrong
  // ! token type, unknown user, deleted user. The response must not let a caller probe which
  // ! it was, and globalErrorHandler skips logging this route's 401s entirely (§E.1), so this
  // ! string is also the only thing an operator ever sees for a refused refresh.
  const rejectRefresh = () =>
    new AppError(httpStatus.UNAUTHORIZED, "Invalid or expired refresh token");

  let decoded: TRefreshPayload;
  try {
    decoded = Jwt.verify(
      refreshToken,
      config.jwt_refresh_secret as string,
    ) as TRefreshPayload;
  } catch {
    throw rejectRefresh();
  }

  // ! H4's second half. Required (not optional like the access token's `type` — H8), because
  // ! no refresh token has ever been issued without it, so there is no legacy shape here.
  if (decoded?.type !== "refresh") {
    throw rejectRefresh();
  }

  // ! The one unavoidable DB read on this path, and what makes soft delete and role changes
  // ! actually take effect — the new access token is minted from this row, not from the
  // ! refresh token's claims. Don't "optimise" it away.
  const userData = await prisma.user.findUnique({
    where: { id: decoded?.userId },
    select: { id: true, email: true, userRole: true, isDeleted: true },
  });

  if (!userData || userData?.isDeleted) {
    throw rejectRefresh();
  }

  return { accessToken: signAccessToken(userData) };
};

const getMeFromDb = async (userId: string) => {
  const result = await prisma.user.findUnique({
    where: { id: userId },
    select: safeUserSelect,
  });

  if (!result) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  return { ...result, _id: result.id };
};

// ! Spec 53 — for updating the logged-in user's own display name. Acts on the id from the
// ! JWT only; there is deliberately no user id in the route, so there is no IDOR surface.
const updateProfile = async (userId: string, name: string) => {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isDeleted: true },
  });

  if (!existing || existing?.isDeleted) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  const result = await prisma.user.update({
    where: { id: userId },
    // ! Already trimmed and non-empty by Zod (spec 53 H1) — never build this object with a
    // ! possibly-undefined name, since `name` is NOT NULL in the schema.
    // !
    // ! Spec 55: this literal `{ name }` is the load-bearing half of "the rider cannot change
    // ! their own email". Do NOT widen it to a spread of the request body, and do not add an
    // ! `email` key — `email` is the login identifier (`loginFromDb` does
    // ! `findUnique({ where: { email } })`), it is `@unique`, and there is no mail sender in
    // ! this project, so a change could not be verified and a typo would be unrecoverable.
    // ! The schema refuses a submitted `email` with a 400; this is what makes the refusal
    // ! true rather than merely polite.
    data: { name },
    select: safeUserSelect,
  });

  return { ...result, _id: result.id };
};

// ! Spec 53 — for setting or replacing the logged-in user's profile picture.
const updateProfilePicture = async (
  userId: string,
  file: Express.Multer.File | undefined,
) => {
  // ! multer leaves `req.file` undefined when no "image" part was parsed at all — without
  // ! this guard `file.path` below is a raw TypeError, i.e. a 500. A *wrong* field name never
  // ! reaches here: multer rejects it itself with its own MulterError (spec 53 H4).
  if (!file) {
    throw new AppError(httpStatus.BAD_REQUEST, "Image file is required");
  }

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isDeleted: true, profilePicture: true },
  });

  if (!existing || existing?.isDeleted) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  const previous = existing?.profilePicture as TUserProfilePicture | null;

  const result = await prisma.user.update({
    where: { id: userId },
    // ! `file.path` is the Cloudinary secure URL and `file.filename` the public_id — that is
    // ! all CloudinaryStorage puts on `req.file` (it streams, so there are never local
    // ! bytes). Same pair `bikeAccessory`'s image upload stores.
    data: { profilePicture: { url: file.path, publicId: file.filename } },
    select: safeUserSelect,
  });

  // ! AFTER the write, not before (spec 53 D7). multer has already uploaded the new asset by
  // ! the time this function runs, so deleting the old one last means the row never points at
  // ! a deleted asset; the worst case is one orphaned asset, which is invisible to the user.
  // ! `bikeAccessory` deletes first — this is a deliberate improvement on it, not a slip.
  if (previous?.publicId) {
    await deleteCloudinaryImage(previous.publicId);
  }

  return { ...result, _id: result.id };
};

// ! Spec 53 — for removing the logged-in user's profile picture.
const deleteProfilePicture = async (userId: string) => {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isDeleted: true, profilePicture: true },
  });

  if (!existing || existing?.isDeleted) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  const previous = existing?.profilePicture as TUserProfilePicture | null;

  if (!previous) {
    throw new AppError(httpStatus.NOT_FOUND, "Profile picture not found");
  }

  await deleteCloudinaryImage(previous.publicId);

  const result = await prisma.user.update({
    where: { id: userId },
    // ! `Prisma.JsonNull`, NOT a bare `null` — Prisma rejects `null` for a Json field, and
    // ! this is the same idiom `deleteBikeAccessoryImageFromDB` uses. It reads back as the JS
    // ! value `null`, so every `if (!previous)` guard above behaves identically (spec 53 H2).
    data: { profilePicture: Prisma.JsonNull },
    select: safeUserSelect,
  });

  return { ...result, _id: result.id };
};

// ! registers/updates this device's Expo push token, feeding the weekly-summary cron job
const updatePushToken = async (userId: string, expoPushToken: string) => {
  const existing = await prisma.user.findUnique({ where: { id: userId } });

  if (!existing) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  const result = await prisma.user.update({
    where: { id: userId },
    data: { expoPushToken },
    select: safeUserSelect,
  });

  return { ...result, _id: result.id };
};

//
export const userServices = {
  createUser,
  loginFromDb,
  refreshAccessToken,
  getMeFromDb,
  updateProfile,
  updateProfilePicture,
  deleteProfilePicture,
  updatePushToken,
};
