export type TUserRole = "admin" | "user";

export type TJwtPayload = {
  userId: string;
  userEmail: string;
  userRole: TUserRole;
  // ! Spec 51: minted as "access" on every new token, but OPTIONAL on purpose (its §0 H8).
  // ! Tokens issued before spec 51 carry no `type` claim at all, and up to 10 days' worth of
  // ! them can still be in use at deploy time — authCheck therefore treats a MISSING type as
  // ! an access token and rejects only an explicit mismatch. Once 10 days have passed since
  // ! the deploy this can be made required; see the tracker's Known Gaps.
  type?: "access";
};

// ! Spec 51a — what a CALLER presents, as opposed to what this server mints. `Jwt.verify`
// ! returns whatever JSON was signed, so `type` is an arbitrary string here, not the "access"
// ! literal above. The verify side has to be WIDER than the mint side precisely because its
// ! input is untrusted; narrowing happens via the runtime check in authCheck, after which the
// ! value can be assigned to `req.user` (TJwtPayload) soundly. Don't collapse the two types
// ! back together — widening TJwtPayload.type instead would advertise that a request can be
// ! authenticated by a refresh token, which is what spec 51 §0 H4 forbids.
export type TVerifiedTokenClaims = Omit<TJwtPayload, "type"> & {
  type?: string;
};

// ! Spec 51 — the refresh token's payload. Deliberately carries ONLY the user id: the new
// ! access token is minted from a freshly-read User row, not from these claims, so a role or
// ! email change propagates within one access-token lifetime and a soft delete takes effect
// ! at the next refresh. Keep it minimal — it lives on the client for 15 days.
export type TRefreshPayload = {
  userId: string;
  type: "refresh";
  iat?: number;
  exp?: number;
};

// ! Spec 53 — the shape stored in `User.profilePicture` (a `Json?` column). The same two
// ! keys as `BikeAccessory.productImage`, and the same shape the app's `TCloudinaryImage`
// ! already expects, which is why no client needed a new type for it.
export type TUserProfilePicture = {
  url: string;
  publicId: string;
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
