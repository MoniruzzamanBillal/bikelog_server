"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.userServices = void 0;
const argon2_1 = __importDefault(require("argon2"));
const client_1 = require("@prisma/client");
const http_status_1 = __importDefault(require("http-status"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const AppError_1 = __importDefault(require("../../Error/AppError"));
const config_1 = __importDefault(require("../../config"));
const prisma_1 = require("../../lib/prisma");
const cloudinary_1 = require("../../util/cloudinary");
const generateObjectId_1 = require("../../util/generateObjectId");
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
};
// ! Spec 51 — the two token minters. Kept as the ONLY places either token is signed, so the
// ! sign-time and verify-time shapes cannot drift apart silently (the same reasoning spec 02
// ! used when it typed the login payload).
const signAccessToken = (user) => {
    const jwtPayload = {
        userId: user === null || user === void 0 ? void 0 : user.id,
        userEmail: user === null || user === void 0 ? void 0 : user.email,
        userRole: user === null || user === void 0 ? void 0 : user.userRole,
        type: "access",
    };
    return jsonwebtoken_1.default.sign(jwtPayload, config_1.default.jwt_secret, {
        expiresIn: config_1.default.jwt_access_expires_in,
    });
};
// ! Signed with a DIFFERENT secret from the access token, which is not optional: under one
// ! shared secret an access token would verify here and could be replayed for a fresh access
// ! token forever (spec 51 §0 H4). The `type` claim is the second half of that defence.
const signRefreshToken = (user) => {
    const jwtPayload = {
        userId: user === null || user === void 0 ? void 0 : user.id,
        type: "refresh",
    };
    return jsonwebtoken_1.default.sign(jwtPayload, config_1.default.jwt_refresh_secret, {
        expiresIn: config_1.default.jwt_refresh_expires_in,
    });
};
// ! for creating a user
const createUser = (payload) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const hashedPassword = yield argon2_1.default.hash(payload.password);
        const result = yield prisma_1.prisma.user.create({
            data: {
                id: (0, generateObjectId_1.generateObjectId)(),
                name: payload.name,
                email: payload.email,
                password: hashedPassword,
            },
            select: safeUserSelect,
        });
        return Object.assign(Object.assign({}, result), { _id: result.id });
    }
    catch (error) {
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002") {
            throw new AppError_1.default(http_status_1.default.CONFLICT, "A user with this email already exists");
        }
        throw error;
    }
});
const loginFromDb = (payload) => __awaiter(void 0, void 0, void 0, function* () {
    const userData = yield prisma_1.prisma.user.findUnique({
        where: { email: payload === null || payload === void 0 ? void 0 : payload.email },
    });
    // ! Spec 51 §0 H6: a soft-deleted user could log in — this query never looked at
    // ! `isDeleted`, so the flag did nothing for auth (the SQA report's DEF-07). Collapsed into
    // ! the same 404 as a missing user on purpose, so the response can't tell "deleted" from
    // ! "never existed". Checked in JS rather than in the `where` because `findUnique` only
    // ! accepts unique fields.
    if (!userData || (userData === null || userData === void 0 ? void 0 : userData.isDeleted)) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "User dont exist with this email !!!");
    }
    const isPasswordMatch = yield argon2_1.default.verify(userData === null || userData === void 0 ? void 0 : userData.password, payload === null || payload === void 0 ? void 0 : payload.password);
    if (!isPasswordMatch) {
        throw new AppError_1.default(http_status_1.default.FORBIDDEN, "Password don't match !!");
    }
    // ! Spec 51: two tokens now. `token` on the wire stays the ACCESS token (see the controller)
    // ! so pre-spec-51 clients, which read `result.token` and know nothing about refreshing,
    // ! keep working untouched.
    return {
        accessToken: signAccessToken(userData),
        refreshToken: signRefreshToken(userData),
    };
});
// ! Spec 51 — exchanges a valid refresh token for a new access token. The refresh token is
// ! neither rotated nor echoed back: it stays the same until it expires, so there is nothing
// ! for the client to re-store. No token is stored server-side anywhere, by design — which is
// ! also why nothing here can revoke one (spec 51 §0 H3).
const refreshAccessToken = (refreshToken) => __awaiter(void 0, void 0, void 0, function* () {
    // ! One shared message for every failure cause — malformed, bad signature, expired, wrong
    // ! token type, unknown user, deleted user. The response must not let a caller probe which
    // ! it was, and globalErrorHandler skips logging this route's 401s entirely (§E.1), so this
    // ! string is also the only thing an operator ever sees for a refused refresh.
    const rejectRefresh = () => new AppError_1.default(http_status_1.default.UNAUTHORIZED, "Invalid or expired refresh token");
    let decoded;
    try {
        decoded = jsonwebtoken_1.default.verify(refreshToken, config_1.default.jwt_refresh_secret);
    }
    catch (_a) {
        throw rejectRefresh();
    }
    // ! H4's second half. Required (not optional like the access token's `type` — H8), because
    // ! no refresh token has ever been issued without it, so there is no legacy shape here.
    if ((decoded === null || decoded === void 0 ? void 0 : decoded.type) !== "refresh") {
        throw rejectRefresh();
    }
    // ! The one unavoidable DB read on this path, and what makes soft delete and role changes
    // ! actually take effect — the new access token is minted from this row, not from the
    // ! refresh token's claims. Don't "optimise" it away.
    const userData = yield prisma_1.prisma.user.findUnique({
        where: { id: decoded === null || decoded === void 0 ? void 0 : decoded.userId },
        select: { id: true, email: true, userRole: true, isDeleted: true },
    });
    if (!userData || (userData === null || userData === void 0 ? void 0 : userData.isDeleted)) {
        throw rejectRefresh();
    }
    return { accessToken: signAccessToken(userData) };
});
const getMeFromDb = (userId) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: safeUserSelect,
    });
    if (!result) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "User not found");
    }
    return Object.assign(Object.assign({}, result), { _id: result.id });
});
// ! Spec 53 — for updating the logged-in user's own display name. Acts on the id from the
// ! JWT only; there is deliberately no user id in the route, so there is no IDOR surface.
const updateProfile = (userId, name) => __awaiter(void 0, void 0, void 0, function* () {
    const existing = yield prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, isDeleted: true },
    });
    if (!existing || (existing === null || existing === void 0 ? void 0 : existing.isDeleted)) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "User not found");
    }
    const result = yield prisma_1.prisma.user.update({
        where: { id: userId },
        // ! Already trimmed and non-empty by Zod (spec 53 H1) — never build this object with a
        // ! possibly-undefined name, since `name` is NOT NULL in the schema.
        data: { name },
        select: safeUserSelect,
    });
    return Object.assign(Object.assign({}, result), { _id: result.id });
});
// ! Spec 53 — for setting or replacing the logged-in user's profile picture.
const updateProfilePicture = (userId, file) => __awaiter(void 0, void 0, void 0, function* () {
    // ! multer leaves `req.file` undefined when no "image" part was parsed at all — without
    // ! this guard `file.path` below is a raw TypeError, i.e. a 500. A *wrong* field name never
    // ! reaches here: multer rejects it itself with its own MulterError (spec 53 H4).
    if (!file) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "Image file is required");
    }
    const existing = yield prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, isDeleted: true, profilePicture: true },
    });
    if (!existing || (existing === null || existing === void 0 ? void 0 : existing.isDeleted)) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "User not found");
    }
    const previous = existing === null || existing === void 0 ? void 0 : existing.profilePicture;
    const result = yield prisma_1.prisma.user.update({
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
    if (previous === null || previous === void 0 ? void 0 : previous.publicId) {
        yield (0, cloudinary_1.deleteCloudinaryImage)(previous.publicId);
    }
    return Object.assign(Object.assign({}, result), { _id: result.id });
});
// ! Spec 53 — for removing the logged-in user's profile picture.
const deleteProfilePicture = (userId) => __awaiter(void 0, void 0, void 0, function* () {
    const existing = yield prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, isDeleted: true, profilePicture: true },
    });
    if (!existing || (existing === null || existing === void 0 ? void 0 : existing.isDeleted)) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "User not found");
    }
    const previous = existing === null || existing === void 0 ? void 0 : existing.profilePicture;
    if (!previous) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Profile picture not found");
    }
    yield (0, cloudinary_1.deleteCloudinaryImage)(previous.publicId);
    const result = yield prisma_1.prisma.user.update({
        where: { id: userId },
        // ! `Prisma.JsonNull`, NOT a bare `null` — Prisma rejects `null` for a Json field, and
        // ! this is the same idiom `deleteBikeAccessoryImageFromDB` uses. It reads back as the JS
        // ! value `null`, so every `if (!previous)` guard above behaves identically (spec 53 H2).
        data: { profilePicture: client_1.Prisma.JsonNull },
        select: safeUserSelect,
    });
    return Object.assign(Object.assign({}, result), { _id: result.id });
});
// ! registers/updates this device's Expo push token, feeding the weekly-summary cron job
const updatePushToken = (userId, expoPushToken) => __awaiter(void 0, void 0, void 0, function* () {
    const existing = yield prisma_1.prisma.user.findUnique({ where: { id: userId } });
    if (!existing) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "User not found");
    }
    const result = yield prisma_1.prisma.user.update({
        where: { id: userId },
        data: { expoPushToken },
        select: safeUserSelect,
    });
    return Object.assign(Object.assign({}, result), { _id: result.id });
});
//
exports.userServices = {
    createUser,
    loginFromDb,
    refreshAccessToken,
    getMeFromDb,
    updateProfile,
    updateProfilePicture,
    deleteProfilePicture,
    updatePushToken,
};
